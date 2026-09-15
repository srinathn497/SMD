"""
Manual model-refresh job
========================
Retrains stale / old-schema daily ML bundles as a background task with bounded
concurrency, so the conviction scan never has to retrain models inline.

Why this exists
---------------
The machine is off overnight, so the 02:00 nightly retrain cron rarely runs.
Bundles then go stale for weeks, and the next conviction scan tries to retrain
the whole universe inside its own timeout window — which it can't finish, so it
saves nothing (see conviction_scanner.run_conviction_scan).

Workflow: user clicks "Refresh Models" after a long gap → this grinds through
every stale symbol in the background → then "Scan" is fast because every
predict() call hits a fresh bundle.

Public API
----------
run_model_refresh(extra=None, force=False)  — async, background task
get_refresh_status()                        — dict, live progress
"""
import asyncio
import logging
import time

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.watchlist import WatchlistItem
from app.services.market_data import market_data_service
from app.services.ml_predictor import ml_predictor
from app.services.scanner import DEFAULT_STOCKS, DEFAULT_CRYPTO

logger = logging.getLogger("model_refresh")

# Full training is CPU- and RAM-heavy (LGBM+XGB × 3 horizons + walk-forward +
# prune-and-refit).  The box is RAM-constrained — keep concurrency low.
_CONCURRENCY = 2
# Hard ceiling per symbol.  A cold retrain can legitimately take several
# minutes; this only guards against a genuinely hung train.
_PER_SYMBOL_TIMEOUT = 900   # 15 min

_state: dict = {
    "running":     False,
    "total":       0,
    "trained":     0,   # actually retrained
    "skipped":     0,   # already fresh
    "failed":      0,
    "current":     None,
    "started_at":  None,
    "finished_at": None,
    "last_error":  None,
}


def get_refresh_status() -> dict:
    return dict(_state)


def _progress() -> int:
    return _state["trained"] + _state["skipped"] + _state["failed"]


async def _refresh_one(symbol: str, asset_type: str, sem: asyncio.Semaphore, force: bool) -> None:
    async with sem:
        _state["current"] = symbol
        try:
            if not force and not ml_predictor.needs_retrain(symbol, "3y"):
                _state["skipped"] += 1
                logger.debug(f"[model_refresh] {symbol}: already fresh")
                return

            df = await market_data_service.get_ohlcv_df(symbol, asset_type, "1d", period="3y")
            await asyncio.wait_for(
                asyncio.to_thread(ml_predictor.train, symbol, df, "3y"),
                timeout=_PER_SYMBOL_TIMEOUT,
            )
            _state["trained"] += 1
            logger.info(
                f"[model_refresh] {symbol} retrained "
                f"({_progress()}/{_state['total']})"
            )
        except asyncio.TimeoutError:
            _state["failed"] += 1
            _state["last_error"] = f"{symbol}: timeout after {_PER_SYMBOL_TIMEOUT}s"
            logger.warning(f"[model_refresh] {symbol} timed out after {_PER_SYMBOL_TIMEOUT}s")
        except Exception as e:
            _state["failed"] += 1
            _state["last_error"] = f"{symbol}: {type(e).__name__}: {e}"
            logger.warning(f"[model_refresh] {symbol} failed: {type(e).__name__}: {e}")


async def run_model_refresh(
    extra: list[tuple[str, str]] | None = None,
    force: bool = False,
) -> dict:
    """
    Retrain every stale daily bundle in the default universe + watchlist
    (+ any `extra`).  `force=True` retrains everything regardless of staleness.
    Overlap-guarded; returns the final status dict.
    """
    if _state["running"]:
        logger.info("[model_refresh] already running — skipping")
        return get_refresh_status()

    # ── Build universe ───────────────────────────────────────────────────────
    universe: list[tuple[str, str]] = [(s, "stock") for s, _ in DEFAULT_STOCKS]
    universe += [(s, "crypto") for s, _ in DEFAULT_CRYPTO]

    try:
        async with AsyncSessionLocal() as session:
            rows = (await session.execute(select(WatchlistItem))).scalars().all()
        for row in rows:
            key = (row.symbol.upper(), row.asset_type)
            if key not in universe:
                universe.append(key)
    except Exception as e:
        logger.warning(f"[model_refresh] watchlist load failed: {e}")

    if extra:
        for key in extra:
            if key not in universe:
                universe.append(key)

    _state.update(
        running=True, total=len(universe),
        trained=0, skipped=0, failed=0,
        current=None, started_at=time.time(), finished_at=None, last_error=None,
    )
    logger.info(f"[model_refresh] starting for {len(universe)} symbols (force={force})")

    try:
        sem = asyncio.Semaphore(_CONCURRENCY)
        await asyncio.gather(
            *(_refresh_one(sym, atype, sem, force) for sym, atype in universe),
            return_exceptions=True,
        )
    finally:
        _state.update(running=False, current=None, finished_at=time.time())

    logger.info(
        f"[model_refresh] done — {_state['trained']} retrained, "
        f"{_state['skipped']} already fresh, {_state['failed']} failed"
    )
    return get_refresh_status()
