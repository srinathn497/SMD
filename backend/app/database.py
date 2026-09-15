from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

# Resolve DATABASE_URL to an absolute path so it works regardless of the
# working directory (uvicorn --reload restarts workers from unpredictable CWDs).
_db_url = settings.DATABASE_URL
if _db_url.startswith("sqlite") and "///" in _db_url:
    _prefix, _rel = _db_url.split("///", 1)
    if not _rel.startswith("/"):
        _abs = (Path(__file__).parent.parent / _rel).resolve()
        _db_url = f"{_prefix}///{_abs}"

engine = create_async_engine(_db_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        from app.models import alert, portfolio, watchlist, trade, conviction_cache, prediction_log, trade_idea, signal_performance, signal_performance_stock, option_trade  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
        # WAL mode: concurrent reads don't block writes; more resilient under load
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        # Don't wait forever if another writer holds the lock
        await conn.execute(text("PRAGMA busy_timeout=5000"))
        # Schema migrations — ADD COLUMN is idempotent via try/except
        for stmt in (
            "ALTER TABLE prediction_log ADD COLUMN signals_json TEXT",
            "ALTER TABLE option_trades ADD COLUMN trade_side TEXT DEFAULT 'LONG'",
        ):
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass  # column already exists
