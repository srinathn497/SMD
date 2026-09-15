"""
Signal Performance Service
==========================
Tracks per-signal win/loss counts and derives adaptive weights.

When a prediction resolves:
  - CORRECT → each signal that fired (passed=True) gets a win
  - WRONG   → each signal that fired gets a loss
  - PUSH    → ignored (too small a move to be informative)

Weight formula (applied once ≥ MIN_SAMPLES observations):
  weight = clamp(accuracy_pct / 50.0, 0.5, 2.0)
  - 50% accuracy  → 1.0  (neutral — no change)
  - 70% accuracy  → 1.4  (boosted)
  - 30% accuracy  → 0.6  (penalised)

Weights are cached in memory (refreshed every 30 min or after each update).
conviction.py reads weights synchronously via get_weight().
"""
import json
import logging
import time
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.database import AsyncSessionLocal
from app.models.signal_performance import SignalPerformance

logger = logging.getLogger("signal_performance")

MIN_SAMPLES = 10          # minimum observations before applying a custom weight
_CACHE_TTL  = 1800        # 30 min

_WEIGHT_CACHE: dict[str, float] = {}
_CACHE_LOADED_AT: float = 0.0


# ── Sync weight getter ────────────────────────────────────────────────────────

def get_weight(signal_name: str, symbol: str | None = None) -> float:
    """
    Synchronous lookup used inside conviction.py.
    Priority: per-stock weight → global weight → 1.0 (default).
    Per-stock key format: "AAPL::Technical"
    """
    if symbol:
        per_stock = _WEIGHT_CACHE.get(f"{symbol.upper()}::{signal_name}")
        if per_stock is not None:
            return per_stock
    return _WEIGHT_CACHE.get(signal_name, 1.0)


# ── Load / refresh ────────────────────────────────────────────────────────────

async def refresh_weights() -> None:
    """Reload global + per-stock signal weights from DB into the in-memory cache."""
    global _WEIGHT_CACHE, _CACHE_LOADED_AT
    try:
        new_cache: dict[str, float] = {}

        async with AsyncSessionLocal() as session:
            # Global weights (signal_performance)
            global_rows = (await session.execute(select(SignalPerformance))).scalars().all()
            for r in global_rows:
                new_cache[r.signal_name] = r.weight

            # Per-stock weights (signal_performance_stock) — key: "AAPL::Technical"
            from app.models.signal_performance_stock import SignalPerformanceStock
            stock_rows = (await session.execute(select(SignalPerformanceStock))).scalars().all()
            for r in stock_rows:
                if r.win_count + r.loss_count >= MIN_SAMPLES:
                    new_cache[f"{r.symbol}::{r.signal_name}"] = r.weight

        _WEIGHT_CACHE     = new_cache
        _CACHE_LOADED_AT  = time.time()
        global_n = sum(1 for k in new_cache if "::" not in k)
        stock_n  = sum(1 for k in new_cache if "::" in k)
        logger.info(f"[signal_perf] Loaded {global_n} global + {stock_n} per-stock weights")
    except Exception as exc:
        logger.warning(f"[signal_perf] refresh_weights failed: {exc}")


async def _ensure_weights_loaded() -> None:
    if time.time() - _CACHE_LOADED_AT > _CACHE_TTL:
        await refresh_weights()


# ── Core update ───────────────────────────────────────────────────────────────

def _compute_weight(win: int, loss: int) -> float:
    total = win + loss
    if total < MIN_SAMPLES:
        return 1.0
    accuracy = win / total * 100.0
    return max(0.5, min(2.0, accuracy / 50.0))


async def update_signal_outcomes(signals_json: str, outcome: str) -> None:
    """
    Update win/loss counts for every signal that fired (passed=True).
    Called by resolve_predictions for each CORRECT or WRONG resolution.
    PUSH rows are skipped — too small a move to be a meaningful signal.
    """
    if outcome not in ("CORRECT", "WRONG"):
        return

    try:
        signals = json.loads(signals_json)
    except Exception:
        return

    fired = [s["name"] for s in signals if s.get("passed")]
    if not fired:
        return

    now = datetime.utcnow()
    async with AsyncSessionLocal() as session:
        for name in fired:
            # Upsert row (create if new signal)
            stmt = (
                sqlite_insert(SignalPerformance)
                .values(
                    signal_name  = name,
                    win_count    = 1 if outcome == "CORRECT" else 0,
                    loss_count   = 1 if outcome == "WRONG"   else 0,
                    accuracy_pct = 100.0 if outcome == "CORRECT" else 0.0,
                    weight       = 1.0,
                    updated_at   = now,
                )
                .on_conflict_do_update(
                    index_elements=["signal_name"],
                    set_=dict(
                        win_count  = SignalPerformance.win_count  + (1 if outcome == "CORRECT" else 0),
                        loss_count = SignalPerformance.loss_count + (1 if outcome == "WRONG"   else 0),
                        updated_at = now,
                    ),
                )
            )
            await session.execute(stmt)

        await session.commit()

        # Recompute accuracy_pct and weight now that counts are updated
        rows = (
            await session.execute(
                select(SignalPerformance).where(SignalPerformance.signal_name.in_(fired))
            )
        ).scalars().all()
        for row in rows:
            row.accuracy_pct = (
                row.win_count / (row.win_count + row.loss_count) * 100.0
                if (row.win_count + row.loss_count) > 0 else 50.0
            )
            row.weight = _compute_weight(row.win_count, row.loss_count)
        await session.commit()

    # Invalidate memory cache so next conviction compute picks up new weights
    global _CACHE_LOADED_AT
    _CACHE_LOADED_AT = 0.0


# ── Query ─────────────────────────────────────────────────────────────────────

async def get_all_performance() -> list[dict]:
    """Return all signal performance rows sorted by accuracy desc."""
    await _ensure_weights_loaded()
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(select(SignalPerformance))).scalars().all()
    return [
        {
            "signal_name":  r.signal_name,
            "win_count":    r.win_count,
            "loss_count":   r.loss_count,
            "total_count":  r.win_count + r.loss_count,
            "accuracy_pct": round(r.accuracy_pct, 1),
            "weight":       round(r.weight, 2),
            "status": (
                "boosted"   if r.weight > 1.05 else
                "penalised" if r.weight < 0.95 else
                "learning"
            ),
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in sorted(rows, key=lambda x: x.accuracy_pct, reverse=True)
    ]
