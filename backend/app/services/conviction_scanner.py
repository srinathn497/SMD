"""
Conviction Scanner
==================
Pre-computes conviction scores for the full default symbol universe and
persists results to the `conviction_cache` SQLite table.

Public API
----------
run_conviction_scan(extra=[])  — async, runs a full scan with Semaphore(5)
is_scan_running()              — bool, whether a scan is in progress
"""
import asyncio
import json
import logging
from datetime import datetime

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.conviction_cache import ConvictionCache
from app.services.conviction import compute_conviction
from app.services.scanner import DEFAULT_STOCKS, DEFAULT_CRYPTO

logger = logging.getLogger("conviction_scanner")

# Overlap guard — prevents two concurrent scans
_scan_running: bool = False


def is_scan_running() -> bool:
    return _scan_running


# Maximum seconds to wait for a single symbol before giving up
_SYMBOL_TIMEOUT = 150
# Maximum seconds for the entire scan (5 minutes)
_SCAN_TIMEOUT = 300


async def _scan_one(symbol: str, asset_type: str, sem: asyncio.Semaphore) -> ConvictionCache | None:
    """
    Compute conviction for one symbol, guarded by a semaphore slot and a
    per-symbol timeout.  Returns None on any error or timeout.
    Also logs 1d and 1w ML predictions to the prediction_log table.
    """
    async with sem:
        try:
            # allow_training=False — a bulk scan must never retrain inline.
            # Stale-model symbols get their ML signal skipped; run the manual
            # "Refresh Models" job first to warm the universe.
            result = await asyncio.wait_for(
                compute_conviction(symbol, asset_type, allow_training=False),
                timeout=_SYMBOL_TIMEOUT,
            )

            # ── Log ML predictions for history tracking ────────────────────
            # Only log if the model bundle is already current — never trigger a
            # retrain here. Retraining is a CPU-intensive thread that cannot
            # be cancelled by asyncio timeouts and would pile up across all
            # symbols, causing multi-minute hangs.
            try:
                from app.services.market_data import market_data_service as _mds
                from app.services.ml_predictor import ml_predictor as _mlp
                from app.services.prediction_log_service import log_prediction, LOGGED_HORIZONS

                if _mlp.needs_retrain(symbol, "3y"):
                    logger.debug(f"[conviction_scanner] {symbol}: model stale/missing — skipping pred_log")
                else:
                    df_1d = await asyncio.wait_for(
                        _mds.get_ohlcv_df(symbol, asset_type, "1d", period="3y"),
                        timeout=20,
                    )
                    # Conviction gate: only log MODERATE+ predictions.
                    # NEUTRAL/WEAK have too much noise — they pollute accuracy stats.
                    if result.label in ("NEUTRAL", "WEAK"):
                        logger.debug(
                            f"[conviction_scanner] {symbol}: skipping pred_log "
                            f"— conviction {result.label} ({result.score}/{result.max_score})"
                        )
                    else:
                        # Snapshot conviction signals for the self-learning feedback loop
                        signals_snapshot = json.dumps(result.signals) if result.signals else None
                        for hz in LOGGED_HORIZONS:
                            try:
                                ml_res = await asyncio.to_thread(
                                    _mlp.predict, symbol, df_1d, "3y", horizon=hz
                                )
                                await log_prediction(
                                    symbol        = symbol,
                                    asset_type    = asset_type,
                                    horizon       = hz,
                                    direction     = ml_res.direction,
                                    confidence_pct= ml_res.confidence_pct,
                                    is_calibrated = ml_res.is_calibrated,
                                    price_at_log  = ml_res.current_price,
                                    signals_json  = signals_snapshot,
                                )
                            except Exception as e_hz:
                                logger.debug(f"[conviction_scanner] pred_log {symbol}/{hz}: {e_hz}")
            except Exception as e_log:
                logger.debug(f"[conviction_scanner] pred_log fetch failed for {symbol}: {e_log}")

            return ConvictionCache(
                symbol=result.symbol,
                asset_type=asset_type,
                score=result.score,
                max_score=result.max_score,
                label=result.label,
                direction=result.direction,
                signals_json=json.dumps(result.signals),
                computed_at=datetime.utcnow(),
            )
        except asyncio.TimeoutError:
            logger.warning(f"[conviction_scanner] {symbol} timed out after {_SYMBOL_TIMEOUT}s — skipped")
            return None
        except Exception as e:
            logger.warning(f"[conviction_scanner] {symbol} failed: {e}")
            return None


async def run_conviction_scan(extra: list[tuple[str, str]] | None = None) -> int:
    """
    Scan the full default universe (+ any extra symbols) and upsert results
    into conviction_cache.

    Each symbol is limited to _SYMBOL_TIMEOUT seconds; the whole scan is
    limited to _SCAN_TIMEOUT seconds.  Either limit hit → partial results
    saved, _scan_running reset to False.

    Returns number of symbols successfully scored and saved.
    """
    global _scan_running
    if _scan_running:
        logger.info("[conviction_scanner] Scan already in progress — skipping")
        return 0

    _scan_running = True
    try:
        # Build universe
        universe: list[tuple[str, str]] = []
        for sym, _ in DEFAULT_STOCKS:
            universe.append((sym, "stock"))
        for sym, _ in DEFAULT_CRYPTO:
            universe.append((sym, "crypto"))
        if extra:
            for sym, atype in extra:
                if (sym, atype) not in universe:
                    universe.append((sym, atype))

        logger.info(
            f"[conviction_scanner] Starting scan for {len(universe)} symbols "
            f"(per-symbol timeout={_SYMBOL_TIMEOUT}s, total timeout={_SCAN_TIMEOUT}s)"
        )

        sem = asyncio.Semaphore(3)
        tasks = [asyncio.create_task(_scan_one(sym, atype, sem)) for sym, atype in universe]

        # Overall scan deadline. asyncio.wait (unlike wait_for(gather(...))) keeps
        # the results of everything that finished — a timeout no longer discards
        # the whole scan, it just cancels the stragglers and saves the rest.
        done, pending = await asyncio.wait(tasks, timeout=_SCAN_TIMEOUT)
        if pending:
            logger.warning(
                f"[conviction_scanner] {len(pending)}/{len(tasks)} symbols unfinished "
                f"after {_SCAN_TIMEOUT}s — cancelling stragglers, saving {len(done)} completed"
            )
            for t in pending:
                t.cancel()

        rows = []
        for t in done:
            try:
                rows.append(t.result())
            except Exception as e:
                logger.debug(f"[conviction_scanner] task raised: {e}")

        # Filter out None / exceptions before touching the DB
        valid_rows = [r for r in rows if r is not None and not isinstance(r, BaseException)]

        if not valid_rows:
            logger.info("[conviction_scanner] No valid rows to save — skipping DB write")
            return 0

        # Upsert into DB
        saved = 0
        now = datetime.utcnow()   # naive UTC — consistent with SQLite + model
        async with AsyncSessionLocal() as session:
            for row in valid_rows:
                merged = await session.merge(row)
                # Always re-assign computed_at so SQLAlchemy marks it dirty
                # and emits an UPDATE even if score/direction are unchanged.
                merged.computed_at = now
                saved += 1
            await session.commit()

        logger.info(f"[conviction_scanner] Scan complete — {saved}/{len(universe)} saved")
        return saved

    finally:
        _scan_running = False
