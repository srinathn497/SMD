"""
Market Context Service — shared utilities for both ML predictors.

Provides:
  - SECTOR_MAP          : stock → sector ETF mapping
  - get_market_df()     : fetch + cache daily OHLCV for any ticker (SPY, ^VIX, XLK…)
  - get_earnings_dates(): historical + upcoming earnings dates via yfinance
  - add_earnings_features(): compute days_to_next_earnings, days_since_earnings,
                             earnings_in_5d for any DataFrame with a DatetimeIndex

All fetches are cached in memory (30-min TTL) to avoid redundant downloads
during the same training run.
"""
import logging
import time
from datetime import date

import numpy as np
import pandas as pd
import yfinance as yf

logger = logging.getLogger("market_context")

# ── In-memory cache ─────────────────────────────────────────────────────────────
_MARKET_CACHE:        dict[str, tuple[float, pd.DataFrame]] = {}
_INTRADAY_CACHE:      dict[str, tuple[float, pd.DataFrame]] = {}
_EARN_CACHE:          dict[str, tuple[float, list]]          = {}
_FUNDAMENTALS_CACHE:  dict[str, tuple[float, dict]]          = {}
_CACHE_TTL = 1800   # 30 minutes

# ── Sector ETF map ───────────────────────────────────────────────────────────────
SECTOR_MAP: dict[str, str] = {
    # Technology
    "AAPL": "XLK", "MSFT": "XLK", "NVDA": "XLK", "AMD": "XLK",
    "CRWD": "XLK", "ZS":   "XLK", "QQQ":  "XLK",
    # Communication / Social
    "GOOGL": "XLC", "META": "XLC", "NFLX": "XLC",
    # Financials
    "JPM": "XLF", "GS": "XLF", "V": "XLF", "COIN": "XLF", "BRK-B": "XLF",
    # Healthcare
    "JNJ": "XLV", "UNH": "XLV",
    # Consumer Discretionary
    "AMZN": "XLY", "TSLA": "XLY", "DIS": "XLY",
    # Industrials
    "BA": "XLI",
    # Consumer Staples
    "WMT": "XLP",
    # Energy
    "XOM": "XLE",
    # Precious metals / commodities
    "GLD": "GLD",
}


def get_market_df(ticker: str, period: str = "3y") -> pd.DataFrame:
    """
    Fetch daily OHLCV for a market ticker (SPY, ^VIX, XLK…) with 30-min cache.
    Returns empty DataFrame on failure — callers fill missing columns with 0.
    """
    now = time.time()
    cached = _MARKET_CACHE.get(ticker)
    if cached is not None and now - cached[0] < _CACHE_TTL:
        return cached[1]

    try:
        raw = yf.download(ticker, period=period, auto_adjust=True, progress=False)
        if raw is None or not isinstance(raw, pd.DataFrame) or raw.empty:
            raise ValueError("empty response")
        # yfinance sometimes returns an all-NaN DataFrame for bad tickers (^VIX3M etc.)
        # Treat it as empty so callers get the neutral default rather than NaN columns.
        if raw.dropna(how="all").empty:
            raise ValueError("empty response (all NaN)")
        if isinstance(raw.columns, pd.MultiIndex):
            # yfinance 1.2+ can return MultiIndex with tickers at level 0
            # (e.g. [('XLK','Close'),...]) or OHLCV at level 0 (e.g. [('Close','XLK'),...]).
            # Always pick the level that contains OHLCV names.
            _price_names = {'open', 'high', 'low', 'close', 'volume', 'adj close'}
            l0 = {str(v).lower() for v in raw.columns.get_level_values(0)}
            if l0 & _price_names:
                raw.columns = raw.columns.get_level_values(0)
            else:
                raw.columns = raw.columns.get_level_values(1)
        raw.columns = [c.lower() for c in raw.columns]
        raw.index = pd.to_datetime(raw.index).tz_localize(None).normalize()
        # Remove any duplicate dates yfinance produces for some tickers (HYG, LQD, ^VIX3M, etc.)
        if raw.index.duplicated().any():
            raw = raw[~raw.index.duplicated(keep="last")]
        _MARKET_CACHE[ticker] = (now, raw)
        logger.info(f"Fetched {len(raw)} days of market context for {ticker}")
        return raw
    except Exception as exc:
        logger.warning(f"Market context fetch failed for {ticker}: {exc}")
        empty = pd.DataFrame()
        _MARKET_CACHE[ticker] = (now, empty)
        return empty


def get_intraday_df(ticker: str, interval: str = "15m", period: str = "60d") -> pd.DataFrame:
    """
    Fetch intraday OHLCV (15m, 1h, etc.) with 30-min cache.
    yfinance 15m data covers the last 60 days max.
    Returns empty DataFrame on failure — callers fill missing columns with 0.
    """
    cache_key = f"{ticker}_{interval}"
    now = time.time()
    cached = _INTRADAY_CACHE.get(cache_key)
    if cached is not None and now - cached[0] < _CACHE_TTL:
        return cached[1]

    try:
        raw = yf.download(ticker, period=period, interval=interval,
                          auto_adjust=True, progress=False)
        if raw is None or raw.empty:
            raise ValueError("empty response")
        if isinstance(raw.columns, pd.MultiIndex):
            _price_names = {'open', 'high', 'low', 'close', 'volume', 'adj close'}
            l0 = {str(v).lower() for v in raw.columns.get_level_values(0)}
            raw.columns = raw.columns.get_level_values(0 if l0 & _price_names else 1)
        raw.columns = [c.lower() for c in raw.columns]
        raw.index = pd.to_datetime(raw.index)
        if raw.index.duplicated().any():
            raw = raw[~raw.index.duplicated(keep="last")]
        _INTRADAY_CACHE[cache_key] = (now, raw)
        logger.info(f"Fetched {len(raw)} intraday {interval} bars for {ticker}")
        return raw
    except Exception as exc:
        logger.warning(f"Intraday fetch failed for {ticker} ({interval}): {exc}")
        empty = pd.DataFrame()
        _INTRADAY_CACHE[cache_key] = (now, empty)
        return empty


def get_earnings_dates(symbol: str) -> list[date]:
    """
    Return historical + upcoming earnings dates for a stock symbol via yfinance.
    Returns empty list for crypto or on any fetch failure.
    Cached for 30 minutes.
    """
    # Crypto symbols never have earnings
    if symbol.upper().endswith(("-USD", "-USDT", ".V")):
        return []

    now = time.time()
    cached = _EARN_CACHE.get(symbol.upper())
    if cached is not None and now - cached[0] < _CACHE_TTL:
        return cached[1]

    try:
        ticker = yf.Ticker(symbol)
        earn_df = ticker.earnings_dates
        if earn_df is None or earn_df.empty:
            _EARN_CACHE[symbol.upper()] = (now, [])
            return []

        dates: list[date] = []
        for ts in earn_df.index:
            try:
                d = pd.Timestamp(ts)
                if d.tzinfo is not None:
                    d = d.tz_localize(None)
                dates.append(d.date())
            except Exception:
                continue

        dates = sorted(set(dates))
        _EARN_CACHE[symbol.upper()] = (now, dates)
        logger.info(f"Fetched {len(dates)} earnings dates for {symbol}")
        return dates
    except Exception as exc:
        logger.warning(f"Earnings fetch failed for {symbol}: {exc}")
        _EARN_CACHE[symbol.upper()] = (now, [])
        return []


def get_macro_features(stock_dates: pd.DatetimeIndex) -> dict:
    """
    Fetch 4 macro features aligned to stock_dates:
      yield_curve      — 10Y−13W Treasury spread (inversion = recession risk)
      dxy_ret_5d       — US Dollar Index 5-day return
      credit_spread    — HYG 5d ret − LQD 5d ret (risk-on vs risk-off)
      vix_term_structure — VIX / VIX3M ratio (>1=near-term panic, <1=calm)
    Returns zero/neutral arrays on any fetch failure (never raises).
    """
    n = len(stock_dates)
    result: dict = {
        "yield_curve":       np.zeros(n),
        "dxy_ret_5d":        np.zeros(n),
        "credit_spread":     np.zeros(n),
        "vix_term_structure": np.ones(n),   # 1.0 = neutral ratio
    }
    def _safe_close(ticker: str) -> pd.Series:
        """Return the 'close' Series for a market ticker, deduped and aligned to stock_dates."""
        df = get_market_df(ticker)
        if df.empty or "close" not in df.columns:
            raise ValueError(f"no close data for {ticker}")
        s = df["close"]
        if s.index.duplicated().any():
            s = s[~s.index.duplicated(keep="last")]
        return s.reindex(stock_dates, method="ffill")

    try:
        tnx = _safe_close("^TNX")
        irx = _safe_close("^IRX")
        result["yield_curve"] = (tnx - irx).fillna(0.0).values
    except Exception as exc:
        logger.warning(f"yield_curve macro feature: {exc}")
    try:
        dxy = _safe_close("DX-Y.NYB")
        result["dxy_ret_5d"] = dxy.pct_change(5).fillna(0.0).values
    except Exception as exc:
        logger.warning(f"dxy_ret_5d macro feature: {exc}")
    try:
        hyg = _safe_close("HYG")
        lqd = _safe_close("LQD")
        result["credit_spread"] = (hyg.pct_change(5) - lqd.pct_change(5)).fillna(0.0).values
    except Exception as exc:
        logger.warning(f"credit_spread macro feature: {exc}")
    try:
        vix   = _safe_close("^VIX")
        vix3m = _safe_close("^VIX3M")
        result["vix_term_structure"] = (vix / (vix3m + 1e-9)).fillna(1.0).values
    except Exception as exc:
        logger.warning(f"vix_term_structure macro feature: {exc}")
    return result


def add_earnings_features(
    df: pd.DataFrame,
    earnings_dates: list[date],
    bar_dates: pd.DatetimeIndex,
) -> pd.DataFrame:
    """
    Compute earnings proximity features and attach them to df.

    Features added:
      days_to_next_earnings  — trading days until next earnings (capped at 30)
      days_since_earnings    — calendar days since last earnings (capped at 90)
      earnings_in_5d         — binary: earnings within next 5 calendar days

    All default to their cap values when no earnings data is available,
    which makes the model treat the bar as "no earnings risk."
    """
    DEFAULT_NEXT = 30.0
    DEFAULT_SINCE = 90.0

    if not earnings_dates:
        df["days_to_next_earnings"] = DEFAULT_NEXT
        df["days_since_earnings"]   = DEFAULT_SINCE
        df["earnings_in_5d"]        = 0.0
        return df

    # Normalise to date objects for comparison
    earn_set = sorted(set(earnings_dates))

    days_to_arr   = np.full(len(bar_dates), DEFAULT_NEXT)
    days_since_arr = np.full(len(bar_dates), DEFAULT_SINCE)

    for i, ts in enumerate(bar_dates):
        dt = pd.Timestamp(ts).normalize().date()

        # Nearest upcoming earnings date
        future = [e for e in earn_set if e >= dt]
        if future:
            days_to_arr[i] = min((future[0] - dt).days, DEFAULT_NEXT)

        # Most recent past earnings date
        past = [e for e in earn_set if e < dt]
        if past:
            days_since_arr[i] = min((dt - past[-1]).days, DEFAULT_SINCE)

    df["days_to_next_earnings"] = days_to_arr
    df["days_since_earnings"]   = days_since_arr
    df["earnings_in_5d"]        = (days_to_arr <= 5).astype(float)
    return df


def get_fundamentals(symbol: str, stock_dates: pd.DatetimeIndex) -> dict:
    """
    Return two fundamental features aligned to stock_dates:
      eps_surprise_pct    — (actual − estimate) / |estimate|, clipped ±2, forward-filled quarterly
      revenue_growth_yoy  — YoY quarterly revenue growth clipped [−1, 5], forward-filled

    Both default to 0.0 for crypto or on any fetch failure.
    Cached 30 min per symbol.
    """
    n = len(stock_dates)
    result = {
        "eps_surprise_pct":   np.zeros(n),
        "revenue_growth_yoy": np.zeros(n),
    }

    if symbol.upper().endswith(("-USD", "-USDT", ".V")):
        return result

    now = time.time()
    cached = _FUNDAMENTALS_CACHE.get(symbol.upper())
    if cached is not None and now - cached[0] < _CACHE_TTL:
        fund_data = cached[1]
    else:
        fund_data: dict = {}
        try:
            ticker = yf.Ticker(symbol)

            # ── EPS surprise from earnings history ────────────────────────────
            earn_df = ticker.earnings_dates
            if earn_df is not None and not earn_df.empty:
                past = earn_df.dropna(subset=["Reported EPS", "EPS Estimate"])
                if not past.empty:
                    eps_a   = past["Reported EPS"].astype(float)
                    eps_e   = past["EPS Estimate"].astype(float)
                    surprise = (eps_a - eps_e) / (eps_e.abs() + 1e-9)
                    surprise = surprise.clip(-2.0, 2.0)
                    idx = pd.to_datetime(past.index)
                    if idx.tz is not None:
                        idx = idx.tz_convert("UTC").tz_localize(None).normalize()
                    else:
                        idx = idx.normalize()
                    fund_data["eps_surprise"] = pd.Series(
                        surprise.values, index=idx
                    ).sort_index()

            # ── Revenue growth YoY from quarterly income statement ─────────────
            qis = ticker.quarterly_income_stmt
            if qis is not None and not qis.empty:
                rev_row = None
                for label in ("Total Revenue", "Revenue"):
                    if label in qis.index:
                        rev_row = qis.loc[label]
                        break
                if rev_row is not None:
                    rev = rev_row.astype(float).dropna().sort_index()
                    rev_yoy = rev.pct_change(4).clip(-1.0, 5.0)
                    idx = pd.to_datetime(rev_yoy.index)
                    if idx.tz is not None:
                        idx = idx.tz_convert("UTC").tz_localize(None).normalize()
                    else:
                        idx = idx.normalize()
                    fund_data["revenue_growth"] = pd.Series(
                        rev_yoy.values, index=idx
                    ).sort_index()

        except Exception as exc:
            logger.warning(f"Fundamentals fetch failed for {symbol}: {exc}")

        _FUNDAMENTALS_CACHE[symbol.upper()] = (now, fund_data)

    def _align(series: pd.Series) -> np.ndarray:
        """Forward-fill a sparse quarterly series onto daily stock_dates."""
        combined = series.reindex(stock_dates.union(series.index).sort_values()).ffill()
        return combined.reindex(stock_dates).fillna(0.0).values

    if "eps_surprise" in fund_data and not fund_data["eps_surprise"].empty:
        result["eps_surprise_pct"] = _align(fund_data["eps_surprise"])

    if "revenue_growth" in fund_data and not fund_data["revenue_growth"].empty:
        result["revenue_growth_yoy"] = _align(fund_data["revenue_growth"])

    return result
