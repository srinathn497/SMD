"""
Market data service — yfinance 1.2+ (handles Yahoo Finance cookies/crumbs internally).
All blocking I/O runs in a thread pool via asyncio.to_thread.
Global semaphore limits concurrent Yahoo Finance requests to avoid 429s.
"""
import asyncio
import logging
import time

import pandas as pd
import yfinance as yf

from app.schemas.market import HistoryResponse, OHLCVBar, QuoteData, SearchResult

logger = logging.getLogger("market_data")

# Max concurrent yfinance calls — controls Yahoo Finance request rate
_YF_SEM = asyncio.Semaphore(5)

# yfinance interval → (yf_interval, yf_period)
INTERVAL_MAP: dict[str, tuple[str, str]] = {
    "1m":  ("1m",  "7d"),
    "5m":  ("5m",  "60d"),
    "15m": ("15m", "60d"),
    "30m": ("30m", "60d"),
    "1h":  ("1h",  "730d"),
    "4h":  ("1h",  "730d"),   # yfinance has no 4h — use 1h
    "1d":  ("1d",  "2y"),
    "1wk": ("1wk", "5y"),
}

CRYPTO_MAP: dict[str, str] = {
    "BTC-USD":  "Bitcoin",
    "ETH-USD":  "Ethereum",
    "SOL-USD":  "Solana",
    "BNB-USD":  "BNB",
    "XRP-USD":  "XRP",
    "ADA-USD":  "Cardano",
    "DOGE-USD": "Dogecoin",
    "AVAX-USD": "Avalanche",
    "DOT-USD":  "Polkadot",
    "LINK-USD": "Chainlink",
}

POPULAR_STOCKS: list[tuple[str, str]] = [
    ("AAPL",  "Apple Inc."),     ("MSFT",  "Microsoft"),
    ("NVDA",  "NVIDIA"),         ("GOOGL", "Alphabet"),
    ("AMZN",  "Amazon"),         ("META",  "Meta"),
    ("TSLA",  "Tesla"),          ("BRK-B", "Berkshire"),
    ("JPM",   "JPMorgan"),       ("V",     "Visa"),
    ("UNH",   "UnitedHealth"),   ("XOM",   "ExxonMobil"),
    ("JNJ",   "Johnson & Johnson"), ("WMT", "Walmart"),
    ("NFLX",  "Netflix"),        ("AMD",   "AMD"),
    ("DIS",   "Disney"),         ("BA",    "Boeing"),
    ("GS",    "Goldman Sachs"),  ("COIN",  "Coinbase"),
]


def _sync_get_history(symbol: str, interval: str, period: str) -> list[OHLCVBar]:
    """Blocking: fetch OHLCV history via yfinance."""
    yf_interval, yf_period = INTERVAL_MAP.get(interval, ("1d", "2y"))
    if period:
        yf_period = period

    ticker = yf.Ticker(symbol.upper())
    df = ticker.history(period=yf_period, interval=yf_interval, auto_adjust=True)

    if df.empty:
        raise ValueError(f"No data returned for {symbol}")

    bars = []
    for ts, row in df.iterrows():
        o = row.get("Open")
        h = row.get("High")
        l = row.get("Low")
        c = row.get("Close")
        v = row.get("Volume", 0)
        if any(x is None or (isinstance(x, float) and pd.isna(x)) for x in [o, h, l, c]):
            continue
        if c == 0:
            continue
        # Convert pandas Timestamp → unix ms
        ts_ms = int(ts.timestamp() * 1000)
        bars.append(OHLCVBar(
            timestamp=ts_ms,
            open=round(float(o), 6),
            high=round(float(h), 6),
            low=round(float(l), 6),
            close=round(float(c), 6),
            volume=round(float(v or 0), 2),
        ))
    return bars


def _sync_get_quote(symbol: str, asset_type: str) -> QuoteData:
    """Blocking: fetch current quote via yfinance."""
    ticker = yf.Ticker(symbol.upper())

    # fast_info raises TypeError/'NoneType' errors in yfinance 1.2.0 when data
    # hasn't been loaded yet.  Fall back to the last history bar on any failure.
    price = prev_close = open_ = high_ = low_ = vol = 0.0
    try:
        fi = ticker.fast_info
        price      = float(fi.last_price      or 0)
        prev_close = float(fi.previous_close  or price)
        open_      = float(fi.open            or price)
        high_      = float(fi.day_high        or price)
        low_       = float(fi.day_low         or price)
        vol        = float(fi.last_volume     or 0)
    except Exception:
        df_fb = ticker.history(period="5d", interval="1d", auto_adjust=True)
        if df_fb.empty:
            raise ValueError(f"No quote data for {symbol}")
        price      = float(df_fb["Close"].iloc[-1])
        prev_close = float(df_fb["Close"].iloc[-2]) if len(df_fb) > 1 else price
        open_      = float(df_fb["Open"].iloc[-1])
        high_      = float(df_fb["High"].iloc[-1])
        low_       = float(df_fb["Low"].iloc[-1])
        vol        = float(df_fb["Volume"].iloc[-1])

    change     = price - prev_close
    change_pct = (change / prev_close * 100) if prev_close else 0.0

    # Name: fast_info doesn't have it; fall back to known maps
    name = CRYPTO_MAP.get(symbol.upper()) or symbol.upper()
    for sym, n in POPULAR_STOCKS:
        if sym == symbol.upper():
            name = n
            break

    return QuoteData(
        symbol=symbol.upper(),
        asset_type=asset_type,
        price=round(price, 6),
        open=round(open_, 6),
        high=round(high_, 6),
        low=round(low_, 6),
        prev_close=round(prev_close, 6),
        change=round(change, 6),
        change_pct=round(change_pct, 2),
        volume=round(vol, 2),
        market_cap=None,
        name=name,
    )


def _sync_get_df(symbol: str, interval: str = "1d", period: str = "2y") -> pd.DataFrame:
    """Blocking: return raw OHLCV DataFrame for technical analysis."""
    yf_interval, yf_period = INTERVAL_MAP.get(interval, ("1d", "2y"))
    if period:          # caller can override the default period from INTERVAL_MAP
        yf_period = period
    ticker = yf.Ticker(symbol.upper())
    df = ticker.history(period=yf_period, interval=yf_interval, auto_adjust=True)
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        raise ValueError(f"No data for {symbol}")
    # yfinance 1.2+ can return MultiIndex columns for some tickers — flatten to single level
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    # Remove duplicate dates (Yahoo Finance occasionally returns duplicate rows)
    if df.index.duplicated().any():
        df = df[~df.index.duplicated(keep="last")]
    df = df.rename(columns={
        "Open": "open", "High": "high", "Low": "low",
        "Close": "close", "Volume": "volume"
    })
    return df[["open", "high", "low", "close", "volume"]].dropna()


def _sync_get_scan_data(symbol: str, asset_type: str) -> tuple[pd.DataFrame, float, float]:
    """
    Single yfinance call for the scanner.
    Returns (ohlcv_df, price, change_pct) — no second quote call needed.
    """
    ticker = yf.Ticker(symbol.upper())
    df = ticker.history(period="1y", interval="1d", auto_adjust=True, timeout=15)
    if df.empty:
        raise ValueError(f"No data for {symbol}")

    df = df.rename(columns={
        "Open": "open", "High": "high", "Low": "low",
        "Close": "close", "Volume": "volume"
    })[["open", "high", "low", "close", "volume"]].dropna()

    # Derive current price and change from the last two rows
    price = float(df["close"].iloc[-1])
    prev_close = float(df["close"].iloc[-2]) if len(df) > 1 else price
    change_pct = ((price - prev_close) / prev_close * 100) if prev_close else 0.0

    return df, round(price, 6), round(change_pct, 2)


class MarketDataService:

    # ── Quotes ────────────────────────────────────────────────────────────
    async def get_quote(self, symbol: str, asset_type: str = "stock") -> QuoteData:
        async with _YF_SEM:
            return await asyncio.to_thread(_sync_get_quote, symbol, asset_type)

    # ── History ───────────────────────────────────────────────────────────
    async def get_history(
        self,
        symbol: str,
        asset_type: str = "stock",
        interval: str = "1d",
        period: str | None = None,
    ) -> HistoryResponse:
        async with _YF_SEM:
            bars = await asyncio.to_thread(
                _sync_get_history, symbol, interval, period or ""
            )
        return HistoryResponse(symbol=symbol, interval=interval, bars=bars)

    # ── Combined scan data (1 call instead of 2) ─────────────────────────
    async def get_scan_data(
        self, symbol: str, asset_type: str = "stock"
    ) -> tuple[pd.DataFrame, float, float]:
        """Returns (ohlcv_df, price, change_pct) in a single yfinance fetch."""
        async with _YF_SEM:
            return await asyncio.to_thread(_sync_get_scan_data, symbol, asset_type)

    # ── Raw DataFrame ─────────────────────────────────────────────────────
    async def get_ohlcv_df(
        self,
        symbol: str,
        asset_type: str = "stock",
        interval: str = "1d",
        period: str = "2y",
    ) -> pd.DataFrame:
        async with _YF_SEM:
            return await asyncio.to_thread(_sync_get_df, symbol, interval, period)

    # ── Search ────────────────────────────────────────────────────────────
    async def search_symbols(self, query: str) -> list[SearchResult]:
        results: list[SearchResult] = []
        q = query.upper().strip()

        for sym, name in CRYPTO_MAP.items():
            base = sym.replace("-USD", "")
            if q in base or q in name.upper():
                results.append(SearchResult(
                    symbol=sym, name=name, asset_type="crypto", exchange="Yahoo Finance"
                ))

        for sym, name in POPULAR_STOCKS:
            if q in sym or q in name.upper():
                results.append(SearchResult(
                    symbol=sym, name=name, asset_type="stock", exchange="US"
                ))

        if not results:
            # Try fetching the symbol directly
            try:
                async with _YF_SEM:
                    fi = await asyncio.to_thread(lambda: yf.Ticker(q).fast_info)
                price = float(fi.last_price or 0)
                if price > 0:
                    results.append(SearchResult(
                        symbol=q,
                        name=q,
                        asset_type="stock",
                        exchange="",
                    ))
            except Exception:
                pass

        return results[:20]


market_data_service = MarketDataService()
