from datetime import datetime

from pydantic import BaseModel


class OptionTradeCreate(BaseModel):
    symbol: str
    option_type: str          # CALL | PUT
    strike: float
    expiration: str           # YYYY-MM-DD
    conviction: str = ""

    ask_at_entry: float
    cost_per_contract: float
    quantity: int = 1
    stock_price_at_entry: float

    profit_target: float
    stop_loss_opt: float
    time_stop_date: str
    breakeven_price: float

    delta: float = 0.0
    theta_per_day: float = 0.0
    iv_pct: float = 0.0
    notes: str | None = None
    trade_side: str = "LONG"   # LONG | SHORT


class OptionTradeOut(OptionTradeCreate):
    id: int
    status: str
    entry_at: datetime
    close_at: datetime | None = None
    close_price: float | None = None
    pnl: float | None = None
    pnl_pct: float | None = None

    class Config:
        from_attributes = True


class OptionTradeCloseRequest(BaseModel):
    close_price: float   # option price per share at close
