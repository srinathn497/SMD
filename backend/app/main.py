import asyncio
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import logging

from app.config import settings
from app.database import AsyncSessionLocal, init_db
from app.api.v1 import market, signals, alerts, portfolio, ws, scan, trades, news, conviction, prediction_history, fundamentals, trade_ideas, smart_money, volume_history, signal_performance, income, option_trades
from app.services.alert_engine import check_all_alerts
from app.services.ml_predictor import ml_predictor
from app.services.intraday_predictor import intra_predictor
from app.services.market_data import market_data_service
from app.services.trade_service import check_trades_job
from app.services.scanner import DEFAULT_STOCKS, DEFAULT_CRYPTO
from app.services.conviction_scanner import run_conviction_scan

logger = logging.getLogger("main")
scheduler = AsyncIOScheduler()


async def retrain_all_job():
    """Nightly job: retrain LightGBM models for all default symbols + watchlist."""
    from sqlalchemy import select
    from app.models.watchlist import WatchlistItem

    symbols: list[tuple[str, str]] = []

    # Default scanner universe
    for sym, _ in DEFAULT_STOCKS:
        symbols.append((sym, "stock"))
    for sym, _ in DEFAULT_CRYPTO:
        symbols.append((sym, "crypto"))

    # User watchlist additions
    try:
        async with AsyncSessionLocal() as session:
            rows = (await session.execute(select(WatchlistItem))).scalars().all()
            for row in rows:
                if (row.symbol, row.asset_type) not in symbols:
                    symbols.append((row.symbol, row.asset_type))
    except Exception as e:
        logger.warning(f"Retrain: failed to load watchlist: {e}")

    logger.info(f"Auto-retrain starting for {len(symbols)} symbols")
    success = fail = 0
    for sym, atype in symbols:
        try:
            df = await market_data_service.get_ohlcv_df(sym, atype, "1d", period="3y")
            ml_predictor.train(sym, df, training_period="3y")
            success += 1
        except Exception as e:
            logger.warning(f"Retrain failed for {sym}: {e}")
            fail += 1
    logger.info(f"Auto-retrain complete — success: {success}, failed: {fail}")


async def conviction_scan_job():
    """Nightly job at 06:00: conviction scan for default universe + all pinned watchlist symbols."""
    from sqlalchemy import select
    from app.models.watchlist import WatchlistItem

    extra: list[tuple[str, str]] = []
    try:
        async with AsyncSessionLocal() as session:
            rows = (await session.execute(select(WatchlistItem))).scalars().all()
            for row in rows:
                atype = "crypto" if row.symbol.upper().endswith(("-USD", "-USDT")) else "stock"
                extra.append((row.symbol.upper(), atype))
    except Exception as e:
        logger.warning(f"Conviction scan: failed to load watchlist: {e}")

    await run_conviction_scan(extra=extra if extra else None)


async def signal_backtest_job():
    """Weekly job: backtest signal accuracy for default universe + all watchlist symbols."""
    from sqlalchemy import select
    from app.models.watchlist import WatchlistItem
    from app.services.signal_backtest_service import run_signal_backtest

    extra: list[tuple[str, str]] = []
    try:
        async with AsyncSessionLocal() as session:
            rows = (await session.execute(select(WatchlistItem))).scalars().all()
            for row in rows:
                atype = "crypto" if row.symbol.upper().endswith(("-USD", "-USDT")) else "stock"
                extra.append((row.symbol.upper(), atype))
    except Exception as e:
        logger.warning(f"Signal backtest: failed to load watchlist: {e}")

    await run_signal_backtest(extra=extra if extra else None)


async def resolve_prediction_logs_job(force: bool = False):
    """Resolve pending predictions. force=True attempts all pending rows regardless of date."""
    from app.services.prediction_log_service import resolve_predictions
    try:
        summary = await resolve_predictions(force=force)
        logger.info(f"[resolve_predictions] force={force} {summary}")
    except Exception as e:
        logger.warning(f"[resolve_predictions] job failed: {e}")


def _next_trading_day() -> "date":
    from datetime import date, timedelta
    d = date.today() + timedelta(days=1)
    while d.weekday() >= 5:   # 5=Sat, 6=Sun
        d += timedelta(days=1)
    return d


async def populate_next_day_predictions_job():
    """Post-close job at 4:35 PM ET (Mon–Fri): log next-trading-day predictions using today's close."""
    from sqlalchemy import select
    from app.models.watchlist import WatchlistItem
    from app.services.prediction_log_service import populate_predictions

    tomorrow = _next_trading_day()
    symbols = [sym for sym, _ in DEFAULT_STOCKS + DEFAULT_CRYPTO]

    try:
        async with AsyncSessionLocal() as session:
            rows = (await session.execute(select(WatchlistItem))).scalars().all()
            for row in rows:
                sym = row.symbol.upper()
                if sym not in symbols:
                    symbols.append(sym)
    except Exception as e:
        logger.warning(f"Next-day populate: failed to load watchlist: {e}")

    logger.info(f"[next_day_populate] Logging predictions for {tomorrow} ({len(symbols)} symbols)")
    count = await populate_predictions(symbols, logged_date=tomorrow)
    logger.info(f"[next_day_populate] Done: {count} new rows for {tomorrow}")


async def retrain_intraday_job():
    """Nightly job at 02:30: retrain 15m LightGBM models for all watched symbols."""
    from sqlalchemy import select
    from app.models.watchlist import WatchlistItem

    symbols: list[tuple[str, str]] = []
    for sym, _ in DEFAULT_STOCKS:
        symbols.append((sym, "stock"))
    for sym, _ in DEFAULT_CRYPTO:
        symbols.append((sym, "crypto"))

    try:
        async with AsyncSessionLocal() as session:
            rows = (await session.execute(select(WatchlistItem))).scalars().all()
            for row in rows:
                if (row.symbol, row.asset_type) not in symbols:
                    symbols.append((row.symbol, row.asset_type))
    except Exception as e:
        logger.warning(f"Intraday retrain: failed to load watchlist: {e}")

    logger.info(f"Intraday auto-retrain starting for {len(symbols)} symbols")
    success = fail = 0
    for sym, atype in symbols:
        try:
            df_15m = await market_data_service.get_ohlcv_df(sym, atype, "15m", period="60d")
            df_1d  = await market_data_service.get_ohlcv_df(sym, atype, "1d",  period="3mo")
            intra_predictor.train(sym, df_15m, df_1d, atype)
            success += 1
        except Exception as e:
            logger.warning(f"Intraday retrain failed for {sym}: {e}")
            fail += 1
    logger.info(f"Intraday retrain complete — success: {success}, failed: {fail}")


async def startup_catchup():
    """
    Runs once on startup to recover from missed nightly jobs.
    Checks whether the conviction cache and trade ideas are stale (e.g. machine was
    off overnight) and fires catch-up tasks in the background so startup stays fast.
    """
    from datetime import date, datetime, timezone
    from sqlalchemy import select, func
    from app.models.trade_idea import TradeIdea
    from app.models.conviction_cache import ConvictionCache
    from app.services.trade_idea_service import generate_trade_ideas

    today_str = date.today().isoformat()
    now_utc   = datetime.now(timezone.utc)
    STALE_HOURS = 20   # conviction cache older than this → needs a fresh scan

    # ── Conviction cache staleness ───────────────────────────────────────────
    cache_stale = True
    try:
        async with AsyncSessionLocal() as session:
            latest = (
                await session.execute(select(func.max(ConvictionCache.computed_at)))
            ).scalar()
        if latest is not None:
            age_h = (now_utc.replace(tzinfo=None) - latest).total_seconds() / 3600
            cache_stale = age_h > STALE_HOURS
            logger.info(f"[startup] Conviction cache age: {age_h:.1f}h (stale={cache_stale})")
    except Exception as exc:
        logger.warning(f"[startup] Could not check conviction cache: {exc}")

    # ── Trade ideas for today ────────────────────────────────────────────────
    ideas_missing = True
    try:
        async with AsyncSessionLocal() as session:
            row = (
                await session.execute(
                    select(TradeIdea).where(TradeIdea.trade_date == today_str).limit(1)
                )
            ).scalars().first()
        ideas_missing = row is None
        logger.info(f"[startup] Trade ideas for today: {'missing' if ideas_missing else 'present'}")
    except Exception as exc:
        logger.warning(f"[startup] Could not check trade ideas: {exc}")

    # ── Resolve any pending predictions (fast, DB-only) ─────────────────────
    asyncio.create_task(resolve_prediction_logs_job())

    async def _catchup():
        await asyncio.sleep(30)          # let the rest of the app finish starting up
        if cache_stale:
            # Deliberately NOT auto-run — this machine is off overnight, so a
            # startup scan would fire on every boot, often against a stale model
            # universe (every ML signal skipped) while burning CPU. The user
            # triggers "Refresh Models" then "Scan" manually from the
            # Recommendations tab instead.
            logger.warning(
                "[startup] Conviction cache is stale — run 'Refresh Models' then "
                "'Scan' on the Recommendations tab to rebuild it."
            )
        if ideas_missing:
            logger.info("[startup] Generating catch-up trade ideas...")
            await generate_trade_ideas()
        # Per-stock signal backtest — always check regardless of cache/ideas state
        from app.services.signal_backtest_service import should_run_backtest
        if await should_run_backtest():
            logger.info("[startup] Running per-stock signal backtest...")
            await signal_backtest_job()
        elif not cache_stale and not ideas_missing:
            logger.info("[startup] All nightly data current, backtest up to date — no catch-up needed")

    asyncio.create_task(_catchup())


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()

    # Alert checks every 60s
    scheduler.add_job(
        check_all_alerts,
        "interval",
        seconds=settings.ALERT_CHECK_INTERVAL_SECONDS,
        id="alert_check",
    )
    # Trade TP/SL checks every 30 minutes
    scheduler.add_job(check_trades_job, "interval", minutes=30, id="trade_check")
    # Nightly ML retrain at 02:00 (daily model) and 02:30 (15m intraday model)
    scheduler.add_job(retrain_all_job,      "cron", hour=2, minute=0,  id="ml_retrain")
    scheduler.add_job(retrain_intraday_job, "cron", hour=2, minute=30, id="ml_retrain_15m")
    # Conviction leaderboard scan: 06:00 daily (before US market open)
    # Also logs 1d/1w ML predictions to prediction_log table (default universe + watchlist)
    scheduler.add_job(
        lambda: asyncio.create_task(conviction_scan_job()),
        "cron", hour=6, minute=0, id="conviction_scan",
    )
    # Trade ideas generation: 06:30 daily (after conviction scan completes)
    from app.services.trade_idea_service import generate_trade_ideas
    scheduler.add_job(
        lambda: asyncio.create_task(generate_trade_ideas()),
        "cron", hour=6, minute=30, id="trade_ideas",
    )
    # Resolve pending predictions:
    # 07:00 AM — catches any data that settled overnight
    # 16:30 ET — force-resolves all pending after market close (data always available)
    scheduler.add_job(
        lambda: asyncio.create_task(resolve_prediction_logs_job()),
        "cron", hour=7, minute=0, id="resolve_predictions_am",
    )
    scheduler.add_job(
        lambda: asyncio.create_task(resolve_prediction_logs_job(force=True)),
        "cron", hour=16, minute=30, timezone="America/New_York",
        id="resolve_predictions_eod",
    )
    # Log next-trading-day predictions at 4:35 PM ET (weekdays only)
    scheduler.add_job(
        lambda: asyncio.create_task(populate_next_day_predictions_job()),
        "cron", hour=16, minute=35, day_of_week="mon-fri",
        timezone="America/New_York",
        id="populate_next_day",
    )
    # Weekly per-stock signal backtest: Sunday 03:00 (after ML retrain settles)
    scheduler.add_job(
        lambda: asyncio.create_task(signal_backtest_job()),
        "cron", day_of_week="sun", hour=3, minute=0,
        id="signal_backtest_weekly",
    )
    scheduler.start()

    # Pre-load signal weights into memory so first conviction compute is fast
    from app.services.signal_performance_service import refresh_weights
    asyncio.create_task(refresh_weights())

    # Catch up any jobs missed while the machine was off overnight
    asyncio.create_task(startup_catchup())

    yield

    # Shutdown
    scheduler.shutdown(wait=False)


app = FastAPI(
    title="SMD — Share Market Dashboard",
    description="Live market analysis, signals, ML predictions, alerts & portfolio tracking",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(market.router, prefix="/api/v1")
app.include_router(signals.router, prefix="/api/v1")
app.include_router(alerts.router, prefix="/api/v1")
app.include_router(portfolio.router, prefix="/api/v1")
app.include_router(ws.router)
app.include_router(scan.router, prefix="/api/v1")
app.include_router(trades.router, prefix="/api/v1")
app.include_router(news.router, prefix="/api/v1")
app.include_router(conviction.router, prefix="/api/v1")
app.include_router(prediction_history.router, prefix="/api/v1")
app.include_router(fundamentals.router, prefix="/api/v1")
app.include_router(trade_ideas.router, prefix="/api/v1")
app.include_router(smart_money.router, prefix="/api/v1")
app.include_router(volume_history.router, prefix="/api/v1")
app.include_router(signal_performance.router, prefix="/api/v1")
app.include_router(income.router, prefix="/api/v1")
app.include_router(option_trades.router, prefix="/api/v1")


@app.get("/", tags=["Health"])
async def root():
    return {"status": "ok", "app": "SMD Share Market Dashboard", "docs": "/docs"}
