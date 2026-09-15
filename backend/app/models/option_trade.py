from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OptionTrade(Base):
    __tablename__ = "option_trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Contract identity
    symbol: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    option_type: Mapped[str] = mapped_column(String(4), nullable=False)    # CALL | PUT
    strike: Mapped[float] = mapped_column(Float, nullable=False)
    expiration: Mapped[str] = mapped_column(String(10), nullable=False)     # YYYY-MM-DD
    conviction: Mapped[str] = mapped_column(String(20), default="")

    # Entry
    ask_at_entry: Mapped[float] = mapped_column(Float, nullable=False)      # per share
    cost_per_contract: Mapped[float] = mapped_column(Float, nullable=False) # ask × 100
    quantity: Mapped[int] = mapped_column(Integer, default=1)               # # contracts
    stock_price_at_entry: Mapped[float] = mapped_column(Float, nullable=False)

    # Trade plan (from scanner)
    profit_target: Mapped[float] = mapped_column(Float, nullable=False)     # per share
    stop_loss_opt: Mapped[float] = mapped_column(Float, nullable=False)     # per share
    time_stop_date: Mapped[str] = mapped_column(String(10), nullable=False)
    breakeven_price: Mapped[float] = mapped_column(Float, nullable=False)

    # Greeks at entry
    delta: Mapped[float] = mapped_column(Float, default=0.0)
    theta_per_day: Mapped[float] = mapped_column(Float, default=0.0)
    iv_pct: Mapped[float] = mapped_column(Float, default=0.0)

    # Lifecycle
    status: Mapped[str] = mapped_column(String(10), default="OPEN")        # OPEN | CLOSED | EXPIRED
    entry_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    close_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    close_price: Mapped[float | None] = mapped_column(Float, nullable=True) # per share at close
    pnl: Mapped[float | None] = mapped_column(Float, nullable=True)
    pnl_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    trade_side: Mapped[str] = mapped_column(String(5), default="LONG")   # LONG | SHORT
