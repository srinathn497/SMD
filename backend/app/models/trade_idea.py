from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TradeIdea(Base):
    __tablename__ = "trade_ideas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trade_date: Mapped[str] = mapped_column(String(10), index=True)   # YYYY-MM-DD
    rank: Mapped[int] = mapped_column(Integer, default=1)

    symbol: Mapped[str] = mapped_column(String(20))
    asset_type: Mapped[str] = mapped_column(String(10), default="stock")
    direction: Mapped[str] = mapped_column(String(4))                  # BUY | SELL

    # Live price when generated
    price: Mapped[float] = mapped_column(Float, default=0.0)

    # Entry zone (±0.3% around price)
    entry_low: Mapped[float] = mapped_column(Float, default=0.0)
    entry_high: Mapped[float] = mapped_column(Float, default=0.0)

    # Levels
    stop_loss: Mapped[float] = mapped_column(Float, default=0.0)
    target1: Mapped[float] = mapped_column(Float, default=0.0)        # 1.5× ATR
    target2: Mapped[float] = mapped_column(Float, default=0.0)        # 2.5× ATR
    risk_reward: Mapped[float] = mapped_column(Float, default=0.0)    # based on target2

    # Conviction
    conviction_score: Mapped[int] = mapped_column(Integer, default=0)
    conviction_max: Mapped[int] = mapped_column(Integer, default=17)
    conviction_label: Mapped[str] = mapped_column(String(20), default="NEUTRAL")

    # Narrative
    thesis: Mapped[str] = mapped_column(Text, default="")
    key_signals_json: Mapped[str] = mapped_column(Text, default="[]")  # JSON list of top 3 signal names
    invalidation: Mapped[str] = mapped_column(Text, default="")
    time_horizon: Mapped[str] = mapped_column(String(20), default="SWING_3_7D")

    # Position sizing (1% risk on a $10,000 account)
    risk_per_share: Mapped[float] = mapped_column(Float, default=0.0)
    position_size_1pct: Mapped[int] = mapped_column(Integer, default=0)

    generated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
