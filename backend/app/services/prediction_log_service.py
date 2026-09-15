"""
Prediction Log Service

Logs ML model predictions nightly and resolves them once actual prices
are available.

Log trigger  : called from conviction_scanner._scan_one() during the 06:00 scan
Resolve job  : runs at 07:00 daily — fetches latest close and marks CORRECT/WRONG/PUSH
Deduplication: INSERT OR IGNORE on (symbol, horizon, logged_date) UniqueConstraint
"""
import asyncio
import logging
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.database import AsyncSessionLocal
from app.models.prediction_log import PredictionLog

logger = logging.getLogger("prediction_log_service")

# Horizons tracked in the audit log
LOGGED_HORIZONS = ("1d", "1w")

# Calendar days until resolve_at_date.
# 1d = 0: prediction logged at 6 AM uses yesterday's close as base, verifies against
#         today's close (same calendar day). The 4:30 PM EOD job handles this.
# 1w = 5: verifies against the 5th trading day after the logged date.
HORIZON_CALENDAR_DAYS = {"1d": 0, "1w": 5}

# Treat as PUSH (not CORRECT / WRONG) if actual move < this %.
# 0.3% is inside the bid-ask spread on most stocks — not a tradeable move.
# 0.5% is the minimum meaningful price change worth counting as CORRECT/WRONG.
PUSH_THRESHOLD_PCT = 0.5

# Minimum ML confidence to log a prediction.
# Below this the model has weak signal — logging coin-flips pollutes accuracy stats.
MIN_LOG_CONFIDENCE = 58.0


async def log_prediction(
    symbol: str,
    asset_type: str,
    horizon: str,
    direction: str,
    confidence_pct: float,
    is_calibrated: bool,
    price_at_log: float,
    logged_date: date | None = None,
    signals_json: str | None = None,
) -> bool:
    """
    Insert one prediction row. Silently ignores duplicates (same symbol+horizon+date).
    signals_json — snapshot of conviction signals at log time (for weight learning).
    Returns True if the row was newly inserted.
    """
    today = logged_date or date.today()
    cal_days = HORIZON_CALENDAR_DAYS.get(horizon, 2)

    async with AsyncSessionLocal() as session:
        stmt = (
            sqlite_insert(PredictionLog)
            .values(
                symbol          = symbol.upper(),
                asset_type      = asset_type,
                horizon         = horizon,
                logged_date     = today,
                direction       = direction,
                confidence_pct  = round(confidence_pct, 2),
                is_calibrated   = is_calibrated,
                price_at_log    = round(price_at_log, 6),
                resolve_at_date = today + timedelta(days=cal_days),
                resolved        = False,
                signals_json    = signals_json,
            )
            .on_conflict_do_nothing(
                index_elements=["symbol", "horizon", "logged_date"]
            )
        )
        result = await session.execute(stmt)
        await session.commit()
        inserted = result.rowcount > 0
        if inserted:
            logger.debug(f"[pred_log] Logged {symbol}/{horizon} {direction} {confidence_pct:.1f}%")
        return inserted


async def resolve_predictions(force: bool = False) -> dict:
    """
    Resolve pending predictions by checking the close price on the exact
    target trading day:
      - 1d: the 1st trading day after logged_date  (March 27 close for a March 26 log)
      - 1w: the 5th trading day after logged_date

    force=False (nightly job): only attempt rows whose resolve_at_date <= today.
    force=True  (on-demand):   attempt ALL pending rows; rows without enough
                               trading-day data are silently skipped.
    """
    import pandas as pd
    from app.services.market_data import market_data_service

    # How many trading bars to skip forward for each horizon
    HORIZON_BARS = {"1d": 1, "1w": 5}

    today = date.today()
    counts = {"resolved": 0, "correct": 0, "wrong": 0, "push": 0}

    async with AsyncSessionLocal() as session:
        stmt = select(PredictionLog).where(PredictionLog.resolved == False)
        if not force:
            stmt = stmt.where(PredictionLog.resolve_at_date <= today)
        rows = (await session.execute(stmt)).scalars().all()

    if not rows:
        logger.info("[pred_log] resolve_predictions: nothing pending")
        return counts

    # Group by symbol to batch the price fetches
    sym_map: dict[tuple[str, str], list[PredictionLog]] = {}
    for row in rows:
        sym_map.setdefault((row.symbol, row.asset_type), []).append(row)

    now_utc = datetime.utcnow()
    # Collect (signals_json, outcome) pairs to update AFTER prediction_log commits.
    # update_signal_outcomes opens its own session — calling it inside an open
    # prediction_log session causes "database is locked" in SQLite.
    pending_signal_updates: list[tuple[str, str]] = []

    for (sym, atype), log_rows in sym_map.items():
        try:
            # Fetch enough history to cover the furthest prediction target date
            df = await market_data_service.get_ohlcv_df(sym, atype, "1d", period="30d")
            if df.empty:
                continue

            # Strip timezone and normalise to midnight so plain date comparisons work
            df_dates = df.copy()
            idx = df_dates.index
            if idx.tz is not None:
                idx = idx.tz_convert("UTC").tz_localize(None)
            df_dates.index = idx.normalize()

            async with AsyncSessionLocal() as session:
                for row in log_rows:
                    logged_ts = pd.Timestamp(row.logged_date)

                    # 1d: verify against the close ON logged_date (scan runs at 6 AM
                    #     using yesterday's close as base; today's close is the target).
                    # 1w: verify against the 5th trading day AFTER logged_date.
                    if row.horizon == "1d":
                        df_target = df_dates[df_dates.index >= logged_ts]
                        if df_target.empty:
                            logger.debug(
                                f"[pred_log] {sym}/1d logged {row.logged_date}: "
                                f"no bar on/after log date yet — skip"
                            )
                            continue
                        target_close = float(df_target.iloc[0]["close"])
                    else:
                        n_bars = HORIZON_BARS.get(row.horizon, 5)
                        df_after = df_dates[df_dates.index > logged_ts]
                        if len(df_after) < n_bars:
                            logger.debug(
                                f"[pred_log] {sym}/{row.horizon} logged {row.logged_date}: "
                                f"only {len(df_after)} bars after log date, need {n_bars} — skip"
                            )
                            continue
                        target_close = float(df_after.iloc[n_bars - 1]["close"])
                    move_pct = (target_close - row.price_at_log) / row.price_at_log * 100

                    if abs(move_pct) < PUSH_THRESHOLD_PCT:
                        outcome = "PUSH"
                    elif (row.direction == "UP" and move_pct > 0) or (row.direction == "DOWN" and move_pct < 0):
                        outcome = "CORRECT"
                    else:
                        outcome = "WRONG"

                    row.resolved         = True
                    row.outcome          = outcome
                    row.actual_move_pct  = round(move_pct, 4)
                    row.price_at_resolve = round(target_close, 6)
                    row.resolved_at      = now_utc

                    await session.merge(row)
                    counts["resolved"] += 1
                    counts[outcome.lower()] += 1

                    if row.signals_json and outcome in ("CORRECT", "WRONG"):
                        pending_signal_updates.append((row.signals_json, outcome))

                await session.commit()

        except Exception as e:
            logger.warning(f"[pred_log] resolve failed for {sym}: {e}")

    # Update signal performance after all prediction_log sessions are closed
    if pending_signal_updates:
        from app.services.signal_performance_service import update_signal_outcomes
        for signals_json, outcome in pending_signal_updates:
            try:
                await update_signal_outcomes(signals_json, outcome)
            except Exception as e:
                logger.warning(f"[pred_log] signal outcome update failed: {e}")

    logger.info(f"[pred_log] resolve complete: {counts}")
    return counts


async def get_history(
    symbols: list[str] | None = None,
    horizon: str | None = None,
    limit: int = 100,
    offset: int = 0,
    resolved_only: bool = False,
) -> list[PredictionLog]:
    """Fetch prediction log rows, newest first. Pass symbols=[] to get all."""
    async with AsyncSessionLocal() as session:
        stmt = select(PredictionLog)
        if symbols:
            upper = [s.upper() for s in symbols]
            stmt = stmt.where(PredictionLog.symbol.in_(upper))
        if horizon:
            stmt = stmt.where(PredictionLog.horizon == horizon)
        if resolved_only:
            stmt = stmt.where(PredictionLog.resolved == True)
        stmt = stmt.order_by(
            PredictionLog.logged_date.desc(),
            PredictionLog.symbol,
        ).offset(offset).limit(limit)
        return (await session.execute(stmt)).scalars().all()


async def populate_predictions(
    symbols: list[str],
    concurrency: int = 3,
    logged_date: date | None = None,
) -> int:
    """
    Immediately log 1d and 1w ML predictions for each symbol.
    Applies three gates before logging:
      1. Conviction gate — NEUTRAL/WEAK labels are skipped (low-signal noise)
      2. Confidence floor — predictions < MIN_LOG_CONFIDENCE are skipped
      3. VIX regime gate — stocks are skipped when VIX > 30 (panic regime,
                           model was not trained on tail events)
    Skips any (symbol, horizon, date) that already exists for logged_date.
    Returns count of newly inserted rows.
    """
    from app.services.market_data import market_data_service as _mds
    from app.services.ml_predictor import ml_predictor as _mlp
    from app.services.market_context import get_market_df as _get_mdf
    from app.models.conviction_cache import ConvictionCache as _Conv

    def _asset_type(sym: str) -> str:
        return "crypto" if sym.upper().endswith(("-USD", "-USDT")) else "stock"

    # ── VIX regime gate — fetch once, shared across all _one() calls ───────────
    vix_df = await asyncio.to_thread(_get_mdf, "^VIX")
    current_vix = float(vix_df["close"].iloc[-1]) if not vix_df.empty else 0.0
    if current_vix > 30:
        logger.warning(
            f"[populate] VIX {current_vix:.1f} > 30 — stock predictions will be skipped "
            f"(panic regime; model not trained on tail events)"
        )

    sem = asyncio.Semaphore(concurrency)

    async def _one(sym: str) -> int:
        async with sem:
            atype = _asset_type(sym)
            inserted = 0
            try:
                # VIX gate: skip stocks during market panic
                if atype == "stock" and current_vix > 30:
                    return 0

                # Conviction gate: query cached conviction label
                # Skip NEUTRAL/WEAK — these are low-signal predictions
                try:
                    async with AsyncSessionLocal() as _s:
                        conv = await _s.get(_Conv, sym.upper())
                    if conv is not None and conv.label in ("NEUTRAL", "WEAK"):
                        logger.debug(
                            f"[populate] {sym}: skipping — conviction {conv.label} "
                            f"({conv.score}/{conv.max_score})"
                        )
                        return 0
                except Exception:
                    pass  # conviction data unavailable — fall through and log

                df_1d = await asyncio.wait_for(
                    _mds.get_ohlcv_df(sym, atype, "1d", period="3y"),
                    timeout=25,
                )
                for hz in LOGGED_HORIZONS:
                    try:
                        ml_res = await asyncio.to_thread(
                            _mlp.predict, sym, df_1d, "3y", horizon=hz
                        )
                        # Skip NEUTRAL — no directional signal worth tracking
                        if ml_res.direction not in ("UP", "DOWN"):
                            logger.debug(f"[populate] {sym}/{hz}: skipping — direction {ml_res.direction}")
                            continue
                        # Skip low-confidence predictions — they're noise, not signal
                        if ml_res.confidence_pct < MIN_LOG_CONFIDENCE:
                            logger.debug(
                                f"[populate] {sym}/{hz}: skipping — confidence "
                                f"{ml_res.confidence_pct:.1f}% < {MIN_LOG_CONFIDENCE}%"
                            )
                            continue
                        ok = await log_prediction(
                            symbol=sym,
                            asset_type=atype,
                            horizon=hz,
                            direction=ml_res.direction,
                            confidence_pct=ml_res.confidence_pct,
                            is_calibrated=ml_res.is_calibrated,
                            price_at_log=ml_res.current_price,
                            logged_date=logged_date,
                        )
                        if ok:
                            inserted += 1
                    except Exception as e:
                        logger.debug(f"[populate] {sym}/{hz}: {e}")
            except Exception as e:
                logger.warning(f"[populate] {sym}: {e}")
            return inserted

    results = await asyncio.gather(*[_one(sym) for sym in symbols], return_exceptions=True)
    total = sum(r for r in results if isinstance(r, int))
    logger.info(f"[populate] Done: {total} new rows for {len(symbols)} symbols (logged_date={logged_date or 'today'})")
    return total


async def get_accuracy_summary(
    symbols: list[str] | None = None,
    horizon: str | None = None,
) -> dict:
    """
    Compute accuracy over all resolved rows.
    PUSH rows are excluded from the accuracy denominator.
    Returns overall stats plus per-horizon and per-direction breakdowns.
    High-confidence subset (>=58%) matches the new MIN_LOG_CONFIDENCE floor.
    """
    rows = await get_history(symbols=symbols, horizon=horizon, resolved_only=True, limit=10_000)
    total    = len(rows)
    decisive = [r for r in rows if r.outcome in ("CORRECT", "WRONG")]
    correct  = sum(1 for r in decisive if r.outcome == "CORRECT")
    wrong    = sum(1 for r in decisive if r.outcome == "WRONG")
    push     = sum(1 for r in rows if r.outcome == "PUSH")
    n_dec    = len(decisive)
    accuracy_pct = round(correct / n_dec * 100, 1) if n_dec > 0 else None

    # High-confidence subset — threshold aligns with MIN_LOG_CONFIDENCE
    hc_rows = [r for r in decisive if r.confidence_pct >= MIN_LOG_CONFIDENCE]
    hc_correct  = sum(1 for r in hc_rows if r.outcome == "CORRECT")
    hc_decisive = len(hc_rows)
    hc_accuracy_pct = round(hc_correct / hc_decisive * 100, 1) if hc_decisive > 0 else None

    def _hz_stats(hz: str) -> dict:
        sub = [r for r in decisive if r.horizon == hz]
        c = sum(1 for r in sub if r.outcome == "CORRECT")
        n = len(sub)
        return {"total": n, "correct": c, "wrong": n - c, "accuracy_pct": round(c / n * 100, 1) if n > 0 else None}

    def _dir_stats(d: str) -> dict:
        sub = [r for r in decisive if r.direction == d]
        c = sum(1 for r in sub if r.outcome == "CORRECT")
        n = len(sub)
        return {"total": n, "correct": c, "accuracy_pct": round(c / n * 100, 1) if n > 0 else None}

    def _sym_stats(sym: str) -> dict:
        sub  = [r for r in decisive if r.symbol == sym]
        c    = sum(1 for r in sub if r.outcome == "CORRECT")
        n    = len(sub)
        hc   = [r for r in sub if r.confidence_pct >= MIN_LOG_CONFIDENCE]
        hc_c = sum(1 for r in hc if r.outcome == "CORRECT")
        hc_n = len(hc)
        return {
            "total":           n,
            "correct":         c,
            "wrong":           n - c,
            "accuracy_pct":    round(c    / n    * 100, 1) if n    > 0 else None,
            "hc_total":        hc_n,
            "hc_correct":      hc_c,
            "hc_accuracy_pct": round(hc_c / hc_n * 100, 1) if hc_n > 0 else None,
        }

    symbols_seen = sorted(set(r.symbol for r in decisive))

    return {
        "total":            total,
        "correct":          correct,
        "wrong":            wrong,
        "push":             push,
        "accuracy_pct":     accuracy_pct,
        "hc_correct":       hc_correct,
        "hc_total":         hc_decisive,
        "hc_accuracy_pct":  hc_accuracy_pct,
        "by_horizon": {
            "1d": _hz_stats("1d"),
            "1w": _hz_stats("1w"),
        },
        "by_direction": {
            "UP":   _dir_stats("UP"),
            "DOWN": _dir_stats("DOWN"),
        },
        "by_symbol": { sym: _sym_stats(sym) for sym in symbols_seen },
    }
