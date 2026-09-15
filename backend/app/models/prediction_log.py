from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PredictionLog(Base):
    __tablename__ = "prediction_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Identity — unique per symbol+horizon+day
    symbol:      Mapped[str]  = mapped_column(String(20), nullable=False, index=True)
    asset_type:  Mapped[str]  = mapped_column(String(10), default="stock")
    horizon:     Mapped[str]  = mapped_column(String(5),  nullable=False)   # "1d" | "1w"
    logged_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    # Prediction captured at log time
    direction:      Mapped[str]   = mapped_column(String(4),  nullable=False)  # UP | DOWN
    confidence_pct: Mapped[float] = mapped_column(Float, nullable=False)
    is_calibrated:  Mapped[bool]  = mapped_column(Boolean, default=False)
    price_at_log:   Mapped[float] = mapped_column(Float, nullable=False)

    # Conviction signal snapshot at prediction time — used for signal weight learning
    signals_json: Mapped[str | None] = mapped_column(String, nullable=True)

    # Resolution — filled by nightly resolve job
    resolve_at_date:  Mapped[date | None]     = mapped_column(Date,     nullable=True)
    resolved:         Mapped[bool]            = mapped_column(Boolean,  default=False, index=True)
    outcome:          Mapped[str | None]      = mapped_column(String(8), nullable=True)  # CORRECT|WRONG|PUSH
    actual_move_pct:  Mapped[float | None]    = mapped_column(Float,    nullable=True)
    price_at_resolve: Mapped[float | None]    = mapped_column(Float,    nullable=True)
    resolved_at:      Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("symbol", "horizon", "logged_date", name="uq_pred_log"),
    )
