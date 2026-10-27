"""
Prediction Log Service

Logs ML model predictions nightly and resolves them once actual prices
are available.

Log trigger  : conviction_scanner._scan_one(), populate_predictions() (tab open,
               "Generate now", 4:35 PM ET job)
Resolve job  : 07:00 + 16:30 ET + on tab open — marks CORRECT/WRONG/PUSH once the
               target session's bar is final
Window       : every row stores base_date (the completed bar price_at_log came
               from); it is graded on the Nth session after that, never on the
               wall-clock date it was generated
Deduplication: INSERT OR IGNORE on (symbol, horizon, logged_date) UniqueConstraint
"""
import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.database import AsyncSessionLocal
from app.models.prediction_log import PredictionLog

logger = logging.getLogger("prediction_log_service")

# Horizons tracked in the audit log
LOGGED_HORIZONS = ("1d", "1w")

# Completed trading sessions after base_date that each horizon is graded on.
HORIZON_BARS = {"1d": 1, "1w": 5}

# A stock's daily bar is treated as final this long after the 16:00 ET close —
# the consolidated closing print can lag the bell by a few minutes.
_ET = ZoneInfo("America/New_York")
_STOCK_BAR_FINAL_ET = (16, 15)


def is_bar_complete(bar_date: date, asset_type: str, now: datetime | None = None) -> bool:
    """
    True if the daily bar for `bar_date` is final. yfinance returns today's bar
    while the session is still trading, with the live price as its "close".
    Crypto bars roll over at UTC midnight.
    """
    now = now or datetime.now(timezone.utc)
    if asset_type == "crypto":
        return bar_date < now.astimezone(timezone.utc).date()
    now_et = now.astimezone(_ET)
    if bar_date < now_et.date():
        return True
    return bar_date == now_et.date() and (now_et.hour, now_et.minute) >= _STOCK_BAR_FINAL_ET


def completed_bars(df, asset_type: str, now: datetime | None = None):
    """Drop a trailing in-progress daily bar, if any."""
    if df.empty or is_bar_complete(df.index[-1].date(), asset_type, now):
        return df
    return df.iloc[:-1]


def next_session(d: date, asset_type: str) -> date:
    """Next trading session after `d`. Stocks skip weekends (not exchange holidays)."""
    n = d + timedelta(days=1)
    if asset_type != "crypto":
        while n.weekday() >= 5:
            n += timedelta(days=1)
    return n

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
    base_date: date,
    signals_json: str | None = None,
    regime: str | None = None,
    raw_confidence_pct: float | None = None,
    no_edge: bool = False,
    model_version: int | None = None,
) -> bool:
    """
    Insert one prediction row. Silently ignores duplicates (same symbol+horizon+date).
    base_date — date of the completed daily bar `price_at_log` is the close of.
      The call is graded on the Nth session after it (HORIZON_BARS), and is
      labelled (logged_date) with the first session after it — so the window is
      the same no matter what time of day the prediction was generated.
    signals_json — snapshot of conviction signals at log time (for weight learning).
    regime / raw_confidence_pct — context at log time, for future regime-conditional
    meta-calibration (see meta_calibration_service.py). Optional — older callers that
    don't pass them just log NULL.
    no_edge — the model didn't beat a naive baseline in walk-forward; such calls
      (and NEUTRAL ones) aren't logged, so the track record only grades real calls.
    Returns True if the row was newly inserted.
    """
    if no_edge or direction not in ("UP", "DOWN"):
        logger.debug(f"[pred_log] {symbol}/{horizon}: {direction}, no_edge={no_edge} — not logged")
        return False
    logged_date = next_session(base_date, asset_type)
    # Lookahead guard: if the target session is already over (stale price data),
    # the outcome is known — logging it would inflate accuracy.
    if is_bar_complete(logged_date, asset_type):
        logger.debug(f"[pred_log] {symbol}/{horizon}: base {base_date} is stale — not logged")
        return False
    resolve_at_date = logged_date
    for _ in range(HORIZON_BARS.get(horizon, 1) - 1):
        resolve_at_date = next_session(resolve_at_date, asset_type)

    async with AsyncSessionLocal() as session:
        stmt = (
            sqlite_insert(PredictionLog)
            .values(
                symbol          = symbol.upper(),
                asset_type      = asset_type,
                horizon         = horizon,
                logged_date     = logged_date,
                base_date       = base_date,
                direction       = direction,
                confidence_pct  = round(confidence_pct, 2),
                is_calibrated   = is_calibrated,
                price_at_log    = round(price_at_log, 6),
                resolve_at_date = resolve_at_date,
                resolved        = False,
                signals_json    = signals_json,
                regime          = regime,
                raw_confidence_pct = round(raw_confidence_pct, 2) if raw_confidence_pct is not None else None,
                model_version   = model_version,
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
      - 1d: the 1st completed session after base_date
      - 1w: the 5th completed session after base_date
    Legacy rows (no base_date) keep their original logged_date-relative rule.
    An in-progress bar is never used as a target — the row waits until it's final.

    force=False (nightly job): only attempt rows whose resolve_at_date <= today.
    force=True  (on-demand):   attempt ALL pending rows; rows without enough
                               trading-day data are silently skipped.
    """
    import pandas as pd
    from app.services.market_data import market_data_service

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
            df = completed_bars(df, atype)
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

                    if row.base_date is not None:
                        n_bars = HORIZON_BARS.get(row.horizon, 1)
                        df_after = df_dates[df_dates.index > pd.Timestamp(row.base_date)]
                        if len(df_after) < n_bars:
                            continue
                        target_close = float(df_after.iloc[n_bars - 1]["close"])
                    # Legacy rows:
                    # 1d: verify against the close ON logged_date (scan runs at 6 AM
                    #     using yesterday's close as base; today's close is the target).
                    # 1w: verify against the 5th trading day AFTER logged_date.
                    elif row.horizon == "1d":
                        df_target = df_dates[df_dates.index >= logged_ts]
                        if df_target.empty:
                            logger.debug(
                                f"[pred_log] {sym}/1d logged {row.logged_date}: "
                                f"no bar on/after log date yet — skip"
                            )
                            continue
                        target_close = float(df_target.iloc[0]["close"])
                    else:  # legacy 1w
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

    # Refit the ML meta-calibrator from the updated resolution history.
    # Cheap (isotonic regression on a few thousand points) — safe to do every batch.
    if counts["resolved"] > 0:
        from app.services.meta_calibration_service import refresh_meta_calibrators
        try:
            await refresh_meta_calibrators()
        except Exception as e:
            logger.warning(f"[pred_log] meta-calibrator refresh failed: {e}")

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
    bypass_gates_for: set[str] | None = None,
) -> int:
    """
    Immediately log 1d and 1w ML predictions for each symbol.
    Applies three gates before logging:
      1. Conviction gate — NEUTRAL/WEAK labels are skipped (low-signal noise)
      2. Confidence floor — predictions < MIN_LOG_CONFIDENCE are skipped
      3. VIX regime gate — stocks are skipped when VIX > 30 (panic regime,
                           model was not trained on tail events)
    Symbols in `bypass_gates_for` (the user's watchlist) skip gates 1 and 2 —
    a deliberately curated watchlist should get a tracked call even at low
    conviction/confidence. Gate 3 (VIX) and the NEUTRAL-direction skip still
    apply to everyone — there's no directional call to grade either way.
    predict() scores the last *completed* daily bar, so a call made after the
    close is for the next session and a call made pre-market or mid-session is
    for the current one. Skips any (symbol, horizon, logged_date) that already exists.
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
            bypass = sym.upper() in (bypass_gates_for or set())
            try:
                # VIX gate: skip stocks during market panic — applies to everyone
                if atype == "stock" and current_vix > 30:
                    return 0

                # Conviction gate: query cached conviction label
                # Skip NEUTRAL/WEAK — these are low-signal predictions
                # (bypassed for watchlist symbols — the user wants those tracked regardless)
                if not bypass:
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

                # Never train inline from a bulk logging run — stale models wait
                # for Refresh Models (same rule as the conviction scan)
                if _mlp.needs_retrain(sym, "3y"):
                    logger.debug(f"[populate] {sym}: model needs refresh — skipped")
                    return 0

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
                        # (bypassed for watchlist symbols)
                        if not bypass and ml_res.confidence_pct < MIN_LOG_CONFIDENCE:
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
                            base_date=ml_res.as_of_date,
                            regime=ml_res.regime,
                            raw_confidence_pct=ml_res.raw_confidence_pct,
                            no_edge=ml_res.no_edge,
                            model_version=ml_res.model_version,
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
    logger.info(f"[populate] Done: {total} new rows for {len(symbols)} symbols")
    return total


# Confidence buckets for the "does 70% mean 70%?" check
_CONF_BUCKETS = ((50, 55), (55, 60), (60, 70), (70, 101))


def _non_overlapping(rows: list) -> tuple[list, int]:
    """
    Weekly calls made on consecutive days overlap (Mon→Mon and Tue→Tue share 4
    sessions), so ten of them are mostly one bet. Per symbol, keep a 1W call only
    if it was made on/after the previous kept call's grading day. 1D is untouched.
    Returns (rows, number of 1W calls dropped).
    """
    keep, dropped = [], 0
    last_end: dict[str, date] = {}
    for r in sorted(rows, key=lambda r: (r.base_date or r.logged_date)):
        if r.horizon == "1w":
            start = r.base_date or r.logged_date
            prev = last_end.get(r.symbol)
            if prev is not None and start < prev:
                dropped += 1
                continue
            last_end[r.symbol] = r.resolve_at_date
        keep.append(r)
    return keep, dropped


async def get_accuracy_summary(
    symbols: list[str] | None = None,
    horizon: str | None = None,
) -> dict:
    """
    Compute accuracy over all graded rows (VOID legacy rows excluded).
    PUSH rows are excluded from the accuracy denominator; overlapping 1W calls
    are counted once (see _non_overlapping).
    Returns overall stats plus per-horizon and per-direction breakdowns, the
    sample's size and date span, what "always UP" would have scored on the same
    calls, and hit rate per confidence bucket.
    High-confidence subset (>=58%) matches the new MIN_LOG_CONFIDENCE floor.
    """
    rows = await get_history(symbols=symbols, horizon=horizon, resolved_only=True, limit=10_000)
    rows = [r for r in rows if r.outcome != "VOID"]
    rows, overlap_dropped = _non_overlapping(rows)
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

    # Sample size + span, and the naive "always UP" score on the same calls
    days = sorted({r.base_date or r.logged_date for r in decisive})
    ups  = sum(1 for r in decisive if (r.actual_move_pct or 0) > 0)
    baseline_up_pct = round(ups / n_dec * 100, 1) if n_dec > 0 else None

    buckets = []
    for lo, hi in _CONF_BUCKETS:
        sub = [r for r in decisive if lo <= r.confidence_pct < hi]
        if sub:
            c = sum(1 for r in sub if r.outcome == "CORRECT")
            buckets.append({
                "label":    f"{lo}–{hi}%" if hi <= 100 else f"{lo}%+",
                "total":    len(sub),
                "avg_conf": round(sum(r.confidence_pct for r in sub) / len(sub), 1),
                "hit_pct":  round(c / len(sub) * 100, 1),
            })

    return {
        "total":            total,
        "correct":          correct,
        "wrong":            wrong,
        "push":             push,
        "accuracy_pct":     accuracy_pct,
        "hc_correct":       hc_correct,
        "hc_total":         hc_decisive,
        "hc_accuracy_pct":  hc_accuracy_pct,
        "log_days":         len(days),
        "first_date":       days[0].isoformat() if days else None,
        "last_date":        days[-1].isoformat() if days else None,
        "baseline_up_pct":  baseline_up_pct,
        "overlap_dropped":  overlap_dropped,
        "confidence_buckets": buckets,
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
