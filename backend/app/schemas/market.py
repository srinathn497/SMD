from pydantic import BaseModel


class QuoteData(BaseModel):
    symbol: str
    asset_type: str
    price: float
    open: float
    high: float
    low: float
    prev_close: float
    change: float
    change_pct: float
    volume: float
    market_cap: float | None = None
    name: str = ""


class OHLCVBar(BaseModel):
    timestamp: int  # Unix ms
    open: float
    high: float
    low: float
    close: float
    volume: float


class HistoryResponse(BaseModel):
    symbol: str
    interval: str
    bars: list[OHLCVBar]


class SearchResult(BaseModel):
    symbol: str
    name: str
    asset_type: str
    exchange: str = ""
