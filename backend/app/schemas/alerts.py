from datetime import datetime

from pydantic import BaseModel


class AlertCreate(BaseModel):
    symbol: str
    asset_type: str = "stock"
    condition: str  # PRICE_ABOVE | PRICE_BELOW | RSI_OVERBOUGHT | RSI_OVERSOLD | SIGNAL_CHANGE
    threshold: float | None = None
    message: str = ""


class AlertOut(AlertCreate):
    id: int
    is_active: bool
    is_triggered: bool
    triggered_at: datetime | None
    triggered_price: float | None
    created_at: datetime

    class Config:
        from_attributes = True


class WatchlistItemCreate(BaseModel):
    symbol: str
    asset_type: str = "stock"
    display_name: str = ""


class WatchlistItemOut(WatchlistItemCreate):
    id: int
    added_at: datetime

    class Config:
        from_attributes = True
