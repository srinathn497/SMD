from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SignalPerformance(Base):
    __tablename__ = "signal_performance"

    signal_name:  Mapped[str]      = mapped_column(String(60), primary_key=True)
    win_count:    Mapped[int]      = mapped_column(Integer, default=0)
    loss_count:   Mapped[int]      = mapped_column(Integer, default=0)
    accuracy_pct: Mapped[float]    = mapped_column(Float, default=50.0)
    weight:       Mapped[float]    = mapped_column(Float, default=1.0)
    updated_at:   Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    @property
    def total_count(self) -> int:
        return self.win_count + self.loss_count
