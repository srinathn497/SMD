from datetime import datetime

from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Integer, Text, DateTime

from app.database import Base


class ConvictionCache(Base):
    __tablename__ = "conviction_cache"

    symbol: Mapped[str] = mapped_column(String, primary_key=True)
    asset_type: Mapped[str] = mapped_column(String, default="stock")
    score: Mapped[int] = mapped_column(Integer, default=0)
    max_score: Mapped[int] = mapped_column(Integer, default=7)
    label: Mapped[str] = mapped_column(String, default="NEUTRAL")
    direction: Mapped[str] = mapped_column(String, default="NEUTRAL")
    signals_json: Mapped[str] = mapped_column(Text, default="[]")
    # Plain DateTime (no timezone=True) stores naive UTC consistently in SQLite.
    # server_default/onupdate removed — we always set this explicitly in the scanner.
    computed_at = mapped_column(DateTime, default=datetime.utcnow, nullable=True)
