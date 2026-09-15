from datetime import datetime

from pydantic import BaseModel


class TradeCreate(BaseModel):
    symbol: str
    asset_type: str = "stock"
    direction: str              # BUY | SELL
    entry_price: float
    take_profit: float
    stop_loss: float
    quantity: float = 1.0
    signal: str = ""
    top_reason: str = ""


class TradeOut(TradeCreate):
    id: int
    status: str
    open_at: datetime
    close_at: datetime | None = None
    close_price: float | None = None
    pnl: float | None = None
    pnl_pct: float | None = None

    class Config:
        from_attributes = True


class TradeCloseRequest(BaseModel):
    close_price: float | None = None   # None → use current market price


class TradeStats(BaseModel):
    total_trades: int
    open_count: int
    closed_count: int
    win_count: int
    loss_count: int
    win_rate_pct: float
    total_pnl: float
    best_trade_pnl: float | None
    worst_trade_pnl: float | None
