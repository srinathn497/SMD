"""
Volume Flow — buying vs selling

Stocks (estimate): Yahoo 1-minute bars. Each minute's volume is split by where
it closed in its range — (close − low) / (high − low), 0.5 when flat — so a
minute closing at its high counts as all buying.

Since 2026-10-16 Yahoo's intraday volume carries fake prints: single minutes
190–550× a typical minute, often with no price move (NVDA 92M shares at 15:51
vs a ~0.2M median), so hourly sums ran 4–6× the daily total. Minutes above
20× their session's median are dropped (09:30 open and 15:59 close are exempt —
the auctions are genuinely large). Verified on NVDA/AAPL/AVGO/KO over 5 days:
the 1m sum returns to 0.66–0.80× daily, the pre-Oct-16 norm being ~0.75.

Crypto (exact): Coinbase Exchange public trades. The raw `side` is the MAKER's
side (verified 2026-10-23: upticks were 256 "sell" vs 102 "buy"), so a "sell"
print is an aggressive buyer. Hourly bars use Coinbase 1m candles with the
same close-in-range estimate as stocks.
"""
import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import timedelta

import pandas as pd

logger = logging.getLogger("volume_flow_service")

WINDOWS        = [5, 10, 15, 20, 30, 60]
FAKE_MULT      = 20      # minute volume > 20× session median → fake print
_EXEMPT_MIN    = {9 * 60 + 30, 15 * 60 + 59}
_REG_OPEN_MIN  = 9 * 60 + 30
_REG_CLOSE_MIN = 16 * 60
_PACE_SESSIONS = 5       # usual pace = same clock window, prior 5 sessions
_USUAL_SESSIONS = 20
_FLOW_TTL      = 60
_TRADE_PAGES   = 60      # 1000 trades/page; BTC ≈ 2 min/page → ~30 pages for an hour
NY = "America/New_York"


def buy_share(o_h_l_c: pd.DataFrame) -> pd.Series:
    """Fraction of each bar's volume counted as buying: where it closed in its range."""
    rng = o_h_l_c["High"] - o_h_l_c["Low"]
    return ((o_h_l_c["Close"] - o_h_l_c["Low"]) / rng.where(rng > 0)).fillna(0.5).clip(0, 1)


# ── Stocks: cleaned Yahoo 1-minute bars ───────────────────────────────────────

_HIST_CACHE: dict[str, tuple[str, pd.DataFrame]] = {}   # symbol → (ET date, prior-days 1m)
_RECENT_CACHE: dict[str, tuple[float, pd.DataFrame]] = {}
_lock = threading.Lock()


def _yf_1m(symbol: str, **kw) -> pd.DataFrame:
    import yfinance as yf
    df = yf.Ticker(symbol).history(interval="1m", prepost=False, auto_adjust=True, **kw)
    if df is None or df.empty:
        return pd.DataFrame()
    df.index = df.index.tz_convert(NY)
    return df[["Open", "High", "Low", "Close", "Volume"]]


def _raw_minutes(symbol: str) -> pd.DataFrame:
    """~20 sessions of regular-hours 1m bars. Yahoo allows 7 days per 1m request
    and 30 days back, so prior days come in 4 chunks cached for the day; the
    latest session is refetched every minute."""
    now = pd.Timestamp.now(tz=NY)
    today = now.normalize()
    key = today.strftime("%Y-%m-%d")
    with _lock:
        hist = _HIST_CACHE.get(symbol)
        recent = _RECENT_CACHE.get(symbol)
    if not hist or hist[0] != key:
        parts = [_yf_1m(symbol, start=today - timedelta(days=d), end=today - timedelta(days=d - 7))
                 for d in (28, 21, 14, 7)]
        hist = (key, pd.concat([p for p in parts if not p.empty]) if any(not p.empty for p in parts) else pd.DataFrame())
        with _lock:
            _HIST_CACHE[symbol] = hist
    if not recent or time.time() - recent[0] > _FLOW_TTL:
        recent = (time.time(), _yf_1m(symbol, period="1d"))
        with _lock:
            _RECENT_CACHE[symbol] = recent

    df = pd.concat([d for d in (hist[1], recent[1]) if not d.empty]) if not (hist[1].empty and recent[1].empty) else pd.DataFrame()
    if df.empty:
        return df
    df = df[~df.index.duplicated(keep="last")].sort_index()
    mins = df.index.hour * 60 + df.index.minute
    df = df[(mins >= _REG_OPEN_MIN) & (mins < _REG_CLOSE_MIN)]
    # The in-progress minute has volume 0 until it closes
    if len(df) and df.index[-1] + pd.Timedelta(minutes=1) > now:
        df = df.iloc[:-1]
    return df


def clean_minutes(symbol: str) -> tuple[pd.DataFrame, list[dict]]:
    """Regular-session 1m bars with fake prints removed, plus buy volume.
    Returns (frame with columns Open/High/Low/Close/Volume/buy/day/tod, removed list)."""
    df = _raw_minutes(symbol)
    if df.empty:
        return df, []
    df = df.copy()
    df["day"] = df.index.date
    df["tod"] = df.index.hour * 60 + df.index.minute
    med = df[df["Volume"] > 0].groupby("day")["Volume"].median()
    limit = df["day"].map(med).fillna(0) * FAKE_MULT
    fake = (df["Volume"] > limit) & (limit > 0) & ~df["tod"].isin(_EXEMPT_MIN)
    removed = [{"time": ts.isoformat(), "volume": int(v)} for ts, v in df.loc[fake, "Volume"].items()]
    df = df[~fake]
    df["buy"] = df["Volume"] * buy_share(df)
    return df, removed


def stock_hour_bars(symbol: str, window_start: pd.Timestamp, now: pd.Timestamp) -> tuple[list[dict], list[dict], pd.DataFrame]:
    """Hourly bars (09:30, 10:30 … 15:30) rebuilt from cleaned 1m bars, with the
    usual volume for each bar time over the prior 20 sessions."""
    df, removed = clean_minutes(symbol)
    if df.empty:
        return [], [], df
    # Hour buckets anchored on the 09:30 open; 15:30 bucket is 30 min long
    df["key"] = ((df["tod"] - _REG_OPEN_MIN) // 60) * 60 + _REG_OPEN_MIN
    sums = df.groupby(["day", "key"]).agg(volume=("Volume", "sum"), buy=("buy", "sum"),
                                          open=("Open", "first"), close=("Close", "last"))
    bars = []
    for (day, key), row in sums.iterrows():
        start = pd.Timestamp(day, tz=NY) + pd.Timedelta(minutes=int(key))
        if start < window_start:
            continue
        length = min(60, _REG_CLOSE_MIN - int(key))
        prior = sums.xs(key, level="key")
        prior = prior[prior.index < day]["volume"].tail(_USUAL_SESSIONS)
        usual = float(prior.median()) if len(prior) else None
        elapsed = (now - start).total_seconds() / 60
        partial = elapsed < length
        if partial and usual is not None:
            usual *= max(elapsed, 1) / length
        bars.append({"start": start, "minutes": length, "volume": int(row["volume"]), "buy": int(row["buy"]),
                     "usual": usual, "open": float(row["open"]), "close": float(row["close"]), "partial": partial})
    removed = [r for r in removed if pd.Timestamp(r["time"]) >= window_start]
    return bars, removed, df


# ── Crypto: Coinbase Exchange ─────────────────────────────────────────────────

_cb = None
_cb_lock = threading.Lock()
_CB_MISSING: set[str] = set()
_TRADES: dict[str, deque] = {}     # product → deque[(ts_ms, trade_id, usd, taker_buy)] oldest→newest


def _coinbase():
    global _cb
    if _cb is None:
        import ccxt
        _cb = ccxt.coinbaseexchange({"enableRateLimit": True, "timeout": 10000})
    return _cb


def coinbase_product(symbol: str) -> str | None:
    base = symbol.upper().split("-")[0].split("/")[0]
    product = f"{base}-USD"
    return None if product in _CB_MISSING else product


def _trade_rows(raw: list[dict]) -> list[tuple]:
    out = []
    for t in raw:
        ts = int(pd.Timestamp(t["time"]).value // 1_000_000)
        usd = float(t["size"]) * float(t["price"])
        out.append((ts, int(t["trade_id"]), usd, t["side"] == "sell"))   # maker sold → taker bought
    return out


def _refresh_trades(product: str, since_ms: int) -> deque:
    """Keep the last hour of trades per product. First call pages back an hour;
    later calls only page until they reach the newest trade already held."""
    ex = _coinbase()
    held = _TRADES.get(product) or deque()
    newest = held[-1][1] if held else None
    fresh: list[tuple] = []
    after = None
    for _ in range(_TRADE_PAGES):
        params = {"id": product, "limit": 1000}
        if after:
            params["after"] = after
        raw = ex.publicGetProductsIdTrades(params)
        if not raw:
            break
        rows = _trade_rows(raw)
        if newest is not None:
            rows = [r for r in rows if r[1] > newest]
        fresh.extend(rows)
        oldest = rows[-1] if rows else None
        if oldest is None or oldest[0] < since_ms or (newest is not None and len(rows) < len(raw)):
            break
        after = raw[-1]["trade_id"]
    fresh.sort(key=lambda r: r[1])
    held.extend(fresh)
    while held and held[0][0] < since_ms:
        held.popleft()
    _TRADES[product] = held
    return held


def _cb_candles(product: str, timeframe: str, since: pd.Timestamp, until: pd.Timestamp) -> pd.DataFrame:
    """Coinbase candles (≤300 per request) as a UTC-indexed frame, volume in USD."""
    ex = _coinbase()
    step = {"1m": 60_000, "1h": 3_600_000}[timeframe]
    t, end, rows = int(since.value // 1_000_000), int(until.value // 1_000_000), []
    while t < end:
        chunk = ex.fetch_ohlcv(product, timeframe, since=t, limit=300)
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < 300:     # reached the present — asking past it errors ("Start cannot be in the future")
            break
        t = max(t + step, chunk[-1][0] + step)
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=["ts", "Open", "High", "Low", "Close", "base"]).drop_duplicates("ts")
    df.index = pd.to_datetime(df["ts"], unit="ms", utc=True)
    df["Volume"] = df["base"] * df["Close"]
    return df.sort_index()


_HOURLY_CACHE: dict[str, tuple[float, pd.DataFrame]] = {}


def _cb_hourly(product: str, now: pd.Timestamp) -> pd.DataFrame:
    """20+ days of 1h candles for the "usual" baselines — cached 30 min."""
    cached = _HOURLY_CACHE.get(product)
    if cached and time.time() - cached[0] < 1800:
        return cached[1]
    df = _cb_candles(product, "1h", now - pd.Timedelta(days=_USUAL_SESSIONS + 2), now)
    _HOURLY_CACHE[product] = (time.time(), df)
    return df


def crypto_hour_bars(symbol: str, window_start: pd.Timestamp, now: pd.Timestamp) -> list[dict] | None:
    """24 hourly bars from Coinbase: volume + estimated buy split from 1m candles,
    usual = median of the same UTC hour over the prior 20 days of 1h candles."""
    product = coinbase_product(symbol)
    if not product:
        return None
    first_hour = window_start.ceil("h")    # 23 full hours + the current one
    try:
        with _cb_lock:
            hourly = _cb_hourly(product, now).copy()
            minute = _cb_candles(product, "1m", first_hour, now)
    except Exception as e:
        _mark_missing(product, e)
        logger.warning("coinbase candles failed for %s: %s", product, e)
        return None
    if minute.empty:
        return None
    minute["buy"] = minute["Volume"] * buy_share(minute)
    hourly["key"] = hourly.index.strftime("%H:%M")
    groups = minute.groupby(minute.index.floor("h"))
    bars = []
    for start, g in groups:
        prior = hourly[(hourly["key"] == start.strftime("%H:%M")) & (hourly.index < start.normalize())]["Volume"]
        usual = float(prior.tail(_USUAL_SESSIONS).median()) if len(prior) else None
        elapsed = (now - start).total_seconds() / 60
        partial = elapsed < 60
        if partial and usual is not None:
            usual *= max(elapsed, 1) / 60
        bars.append({"start": start, "minutes": 60, "volume": int(g["Volume"].sum()), "buy": int(g["buy"].sum()),
                     "usual": usual, "open": float(g["Open"].iloc[0]), "close": float(g["Close"].iloc[-1]),
                     "partial": partial})
    return bars


def _mark_missing(product: str, exc: Exception) -> None:
    import ccxt
    # Unknown product: candles raise BadSymbol, raw trades raise OrderNotFound ("NotFound")
    if isinstance(exc, (ccxt.BadSymbol, ccxt.OrderNotFound)):
        _CB_MISSING.add(product)


# ── Right-now windows ─────────────────────────────────────────────────────────

@dataclass
class FlowWindow:
    minutes: int
    volume: int
    buy_volume: int
    buy_pct: float | None
    usual: int | None
    pace: float | None     # volume / usual for the same window


@dataclass
class FlowResult:
    symbol: str
    is_crypto: bool
    exact: bool            # True = counted from trades, False = estimated from bars
    source: str
    as_of: str             # end of the latest complete minute
    live: bool             # False when the market is closed (windows = end of last session)
    windows: list[FlowWindow] = field(default_factory=list)
    removed: int = 0       # fake prints dropped inside the last hour


def _window(minutes: int, vol: float, buy: float, usual: float | None) -> FlowWindow:
    return FlowWindow(
        minutes=minutes, volume=int(vol), buy_volume=int(buy),
        buy_pct=round(float(buy) / float(vol) * 100, 1) if vol > 0 else None,
        usual=int(usual) if usual else None,
        pace=round(float(vol) / usual, 2) if usual else None,
    )


def _stock_flow(symbol: str) -> FlowResult | None:
    df, removed = clean_minutes(symbol)
    if df.empty:
        return None
    now = pd.Timestamp.now(tz=NY)
    anchor = df.index[-1] + pd.Timedelta(minutes=1)
    live = anchor.date() == now.date() and now.hour * 60 + now.minute < _REG_CLOSE_MIN
    day, end_tod = anchor.date(), anchor.hour * 60 + anchor.minute
    today = df[df["day"] == day]
    prior_days = sorted(d for d in df["day"].unique() if d < day)[-_PACE_SESSIONS:]
    prior = df[df["day"].isin(prior_days)]
    windows = []
    for w in WINDOWS:
        cur = today[today["tod"] >= end_tod - w]
        past = prior[(prior["tod"] >= end_tod - w) & (prior["tod"] < end_tod)].groupby("day")["Volume"].sum()
        usual = float(past.median()) if len(past) else None
        windows.append(_window(w, cur["Volume"].sum(), cur["buy"].sum(), usual))
    hour_ago = anchor - pd.Timedelta(minutes=60)
    return FlowResult(
        symbol=symbol, is_crypto=False, exact=False, source="Yahoo 1-min bars",
        as_of=anchor.isoformat(), live=live, windows=windows,
        removed=sum(1 for r in removed if pd.Timestamp(r["time"]) >= hour_ago),
    )


def _crypto_flow(symbol: str) -> FlowResult | None:
    product = coinbase_product(symbol)
    if not product:
        return None
    now = pd.Timestamp.now(tz="UTC")
    since_ms = int((now - pd.Timedelta(minutes=60)).value // 1_000_000)
    try:
        with _cb_lock:
            trades = list(_refresh_trades(product, since_ms))
            hourly = _cb_hourly(product, now)
    except Exception as e:
        _mark_missing(product, e)
        logger.warning("coinbase trades failed for %s: %s", product, e)
        return None
    if not trades:
        return None
    # Usual pace: median volume of this UTC hour over the prior 20 days, pro-rated to the window
    hour = now.floor("h")
    same = hourly[(hourly.index.hour == hour.hour) & (hourly.index < hour)]["Volume"].tail(_USUAL_SESSIONS)
    per_min = float(same.median()) / 60 if len(same) else None
    now_ms = int(now.value // 1_000_000)
    windows = []
    for w in WINDOWS:
        cut = now_ms - w * 60_000
        rows = [t for t in trades if t[0] >= cut]
        vol = sum(t[2] for t in rows)
        buy = sum(t[2] for t in rows if t[3])
        windows.append(_window(w, vol, buy, per_min * w if per_min else None))
    return FlowResult(
        symbol=symbol, is_crypto=True, exact=True, source="Coinbase trades",
        as_of=now.isoformat(), live=True, windows=windows,
    )


_FLOW_CACHE: dict[str, tuple[float, FlowResult]] = {}


def compute_flow(symbol: str, is_crypto: bool) -> FlowResult | None:
    cached = _FLOW_CACHE.get(symbol)
    if cached and time.time() - cached[0] < _FLOW_TTL:
        return cached[1]
    try:
        result = _crypto_flow(symbol) if is_crypto else _stock_flow(symbol)
    except Exception as e:
        logger.warning("volume flow failed for %s: %s", symbol, e)
        return None
    if result:
        _FLOW_CACHE[symbol] = (time.time(), result)
    return result
