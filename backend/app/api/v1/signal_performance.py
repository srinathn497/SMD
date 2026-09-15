from fastapi import APIRouter, Query

from app.services.signal_performance_service import get_all_performance
from app.services.signal_backtest_service import is_backtest_running

router = APIRouter(prefix="/signal-intelligence", tags=["Signal Intelligence"])


@router.get("/performance")
async def get_signal_performance(symbol: str | None = Query(default=None)):
    """
    Returns signal performance data.
    - No symbol: global win/loss stats from live resolved predictions
    - ?symbol=AAPL: per-stock backtested weights for that symbol
    """
    from sqlalchemy import select
    from app.database import AsyncSessionLocal

    global_data = await get_all_performance()

    per_stock = []
    if symbol:
        from app.models.signal_performance_stock import SignalPerformanceStock
        async with AsyncSessionLocal() as session:
            rows = (
                await session.execute(
                    select(SignalPerformanceStock)
                    .where(SignalPerformanceStock.symbol == symbol.upper())
                )
            ).scalars().all()
        per_stock = [
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
                "backtested_at": r.backtested_at.isoformat() if r.backtested_at else None,
            }
            for r in sorted(rows, key=lambda x: x.accuracy_pct, reverse=True)
        ]

    total_resolved = sum(r["total_count"] for r in global_data) // 2
    return {
        "global_signals":    global_data,
        "per_stock_signals": per_stock,
        "symbol":            symbol.upper() if symbol else None,
        "total_resolved":    total_resolved,
        "learning_active":   any(r["total_count"] >= 10 for r in global_data),
        "backtest_running":  is_backtest_running(),
    }


@router.get("/backtest-status")
async def backtest_status():
    from app.services.signal_backtest_service import should_run_backtest
    return {
        "running": is_backtest_running(),
        "needs_run": await should_run_backtest(),
    }


@router.post("/trigger-backtest")
async def trigger_backtest(symbol: str | None = Query(default=None)):
    """
    Manually trigger a backtest run.
    - No symbol: runs the full universe (default + watchlist) in the background.
    - ?symbol=ZS: runs only that one symbol immediately and returns the result.
    """
    import asyncio
    from app.services.signal_backtest_service import run_signal_backtest, _backtest_one, is_backtest_running

    if symbol:
        sym = symbol.upper()
        atype = "crypto" if sym.endswith(("-USD", "-USDT")) else "stock"
        if is_backtest_running():
            return {"status": "skipped", "reason": "Full backtest already running"}
        sem = asyncio.Semaphore(1)
        evals = await _backtest_one(sym, atype, sem)
        from app.services.signal_performance_service import refresh_weights
        await refresh_weights()
        return {"status": "done", "symbol": sym, "evaluations": evals}

    # Full run (default + watchlist) in background
    if is_backtest_running():
        return {"status": "already_running"}

    async def _run_full():
        from sqlalchemy import select
        from app.database import AsyncSessionLocal
        from app.models.watchlist import WatchlistItem
        extra: list[tuple[str, str]] = []
        try:
            async with AsyncSessionLocal() as session:
                rows = (await session.execute(select(WatchlistItem))).scalars().all()
                for row in rows:
                    atype = "crypto" if row.symbol.upper().endswith(("-USD", "-USDT")) else "stock"
                    extra.append((row.symbol.upper(), atype))
        except Exception:
            pass
        await run_signal_backtest(extra=extra if extra else None)

    asyncio.create_task(_run_full())
    return {"status": "started", "message": "Full backtest running in background"}
