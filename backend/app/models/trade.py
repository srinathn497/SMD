from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    asset_type: Mapped[str] = mapped_column(String(10), default="stock")   # stock | crypto
    direction: Mapped[str] = mapped_column(String(4), nullable=False)       # BUY | SELL
    entry_price: Mapped[float] = mapped_column(Float, nullable=False)
    take_profit: Mapped[float] = mapped_column(Float, nullable=False)
    stop_loss: Mapped[float] = mapped_column(Float, nullable=False)
    quantity: Mapped[float] = mapped_column(Float, default=1.0)
    status: Mapped[str] = mapped_column(String(10), default="OPEN")        # OPEN | HIT_TP | HIT_SL | CLOSED
    signal: Mapped[str] = mapped_column(String(20), default="")            # e.g. STRONG BUY
    top_reason: Mapped[str] = mapped_column(String(500), default="")
    open_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    close_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    close_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    pnl: Mapped[float | None] = mapped_column(Float, nullable=True)
    pnl_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
