from datetime import datetime

from pydantic import BaseModel


class TransactionCreate(BaseModel):
    symbol: str
    asset_type: str = "stock"
    side: str  # BUY | SELL
    quantity: float
    price: float
    fees: float = 0.0
    notes: str = ""
    traded_at: datetime


class TransactionOut(TransactionCreate):
    id: int
    total: float
    created_at: datetime

    class Config:
        from_attributes = True


class HoldingOut(BaseModel):
    id: int
    symbol: str
    asset_type: str
    quantity: float
    avg_buy_price: float
    total_invested: float
    current_price: float
    current_value: float
    unrealized_pnl: float
    unrealized_pnl_pct: float

    class Config:
        from_attributes = True


class AccountSummary(BaseModel):
    total_invested: float
    current_value: float
    total_pnl: float
    total_pnl_pct: float
    realized_pnl: float
    holdings_count: int
