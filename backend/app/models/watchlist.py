from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WatchlistItem(Base):
    __tablename__ = "watchlist"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    asset_type: Mapped[str] = mapped_column(String(10), default="stock")
    display_name: Mapped[str] = mapped_column(String(100), default="")
    added_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
