from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Query
from pydantic import BaseModel

from app.services.prediction_log_service import (
    get_history,
    get_accuracy_summary,
    populate_predictions,
)

router = APIRouter(prefix="/prediction-history", tags=["Prediction History"])

# ── Populate status guard ───────────────────────────────────────────────────
_populate_running: bool = False
_next_day_populate_running: bool = False


async def _run_populate_bg(sym_list: list[str]) -> None:
    global _populate_running
    _populate_running = True
    try:
        await populate_predictions(sym_list)
    finally:
        _populate_running = False


def _next_trading_day() -> date:
    from datetime import timedelta
    d = date.today() + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


async def _run_next_day_populate_bg(sym_list: list[str]) -> None:
    global _next_day_populate_running
    _next_day_populate_running = True
    try:
        await populate_predictions(sym_list, logged_date=_next_trading_day())
    finally:
        _next_day_populate_running = False


class PredictionLogOut(BaseModel):
    id:               int
    symbol:           str
    asset_type:       str
    horizon:          str
    logged_date:      date
    direction:        str
    confidence_pct:   float
    is_calibrated:    bool
    price_at_log:     float
    resolve_at_date:  date | None
    resolved:         bool
    outcome:          str | None
    actual_move_pct:  float | None
    price_at_resolve: float | None

    class Config:
        from_attributes = True


class HorizonAccuracyOut(BaseModel):
    total:        int = 0
    correct:      int = 0
    wrong:        int = 0
    accuracy_pct: float | None = None


class DirectionAccuracyOut(BaseModel):
    total:        int = 0
    correct:      int = 0
    accuracy_pct: float | None = None


class SymbolAccuracyOut(BaseModel):
    total:           int = 0
    correct:         int = 0
    wrong:           int = 0
    accuracy_pct:    float | None = None
    hc_total:        int = 0
    hc_correct:      int = 0
    hc_accuracy_pct: float | None = None


class AccuracySummaryOut(BaseModel):
    total:           int
    correct:         int
    wrong:           int
    push:            int
    accuracy_pct:    float | None
    hc_correct:      int = 0
    hc_total:        int = 0
    hc_accuracy_pct: float | None = None
    by_horizon:      dict[str, HorizonAccuracyOut] = {}
    by_direction:    dict[str, DirectionAccuracyOut] = {}
    by_symbol:       dict[str, SymbolAccuracyOut] = {}


@router.get("", response_model=list[PredictionLogOut])
async def list_history(
    symbols: str  = Query("", description="Comma-separated symbols, blank = all"),
    horizon: str | None = Query(None, description="1d | 1w"),
    limit:   int  = Query(100, ge=1, le=500),
    offset:  int  = Query(0,   ge=0),
    resolved_only: bool = Query(False),
):
    """
    Return prediction log rows, newest first.
    Pass ?symbols=AAPL,NVDA to filter; omit for all symbols.
    """
    sym_list = [s.strip() for s in symbols.split(",") if s.strip()] if symbols else None
    rows = await get_history(
        symbols=sym_list,
        horizon=horizon,
        limit=limit,
        offset=offset,
        resolved_only=resolved_only,
    )
    return rows


@router.get("/accuracy", response_model=AccuracySummaryOut)
async def get_accuracy(
    symbols: str  = Query("", description="Comma-separated symbols, blank = aggregate"),
    horizon: str | None = Query(None),
):
    """
    Accuracy stats for resolved predictions.
    No symbols = aggregate across all.
    """
    sym_list = [s.strip() for s in symbols.split(",") if s.strip()] if symbols else None
    return await get_accuracy_summary(symbols=sym_list, horizon=horizon)


@router.post("/populate")
async def start_populate(
    background_tasks: BackgroundTasks,
    symbols: str = Query("", description="Comma-separated symbols; blank = all 50 defaults"),
):
    """
    On-demand: log today's 1d + 1w ML predictions for each symbol.
    Runs in the background; poll /populate-status to check progress.
    Blank symbols = full default universe (all 50 stocks + crypto).
    """
    global _populate_running
    if _populate_running:
        return {"status": "already_running"}
    sym_list = [s.strip() for s in symbols.split(",") if s.strip()] if symbols else []
    if not sym_list:
        from app.services.scanner import DEFAULT_STOCKS, DEFAULT_CRYPTO
        sym_list = [s for s, _ in DEFAULT_STOCKS] + [s for s, _ in DEFAULT_CRYPTO]
    background_tasks.add_task(_run_populate_bg, sym_list)
    return {"status": "started", "count": len(sym_list)}


@router.get("/populate-status")
async def get_populate_status():
    """Returns {running: true/false} so the frontend can poll and know when to refresh."""
    return {"running": _populate_running or _next_day_populate_running}


@router.post("/populate-next-day")
async def start_next_day_populate(
    background_tasks: BackgroundTasks,
    symbols: str = Query("", description="Comma-separated symbols; blank = all defaults + watchlist"),
):
    """
    On-demand: log tomorrow's 1d + 1w ML predictions using today's close as the base price.
    Idempotent — rows already logged for tomorrow are silently skipped.
    """
    global _next_day_populate_running
    if _next_day_populate_running:
        return {"status": "already_running"}
    sym_list = [s.strip() for s in symbols.split(",") if s.strip()] if symbols else []
    if not sym_list:
        from app.services.scanner import DEFAULT_STOCKS, DEFAULT_CRYPTO
        from sqlalchemy import select
        from app.models.watchlist import WatchlistItem
        from app.database import AsyncSessionLocal
        sym_list = [s for s, _ in DEFAULT_STOCKS] + [s for s, _ in DEFAULT_CRYPTO]
        try:
            async with AsyncSessionLocal() as session:
                rows = (await session.execute(select(WatchlistItem))).scalars().all()
                for row in rows:
                    sym = row.symbol.upper()
                    if sym not in sym_list:
                        sym_list.append(sym)
        except Exception:
            pass
    background_tasks.add_task(_run_next_day_populate_bg, sym_list)
    return {"status": "started", "logged_date": str(_next_trading_day()), "count": len(sym_list)}


@router.post("/resolve")
async def trigger_resolve():
    """
    On-demand: attempt to resolve ALL pending predictions.
    Rows without enough trading-day data yet are silently skipped.
    This is what the frontend calls when the History tab opens.
    """
    from app.services.prediction_log_service import resolve_predictions
    counts = await resolve_predictions(force=True)
    return counts
