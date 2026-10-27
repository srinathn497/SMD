"""
Volume History Service

Identifies historical volume spike days (≥2× 20-day average) for a symbol
and computes subsequent price returns (+1d, +3d, +5d) to show how the price
behaved after large institutional volume events.
"""
import asyncio
import logging
import time
from dataclasses import dataclass, field

logger = logging.getLogger("volume_history_service")

SURGE_THRESHOLD = 2.0
ROLLING_WINDOW  = 20
_CACHE: dict[str, tuple[float, object]] = {}
_CACHE_TTL = 3600  # 1 hour — daily bars don't change intraday


@dataclass
class SpikeEvent:
    date: str
    price_open: float
    price_high: float
    price_low: float
    price_close: float
    vwap_approx: float      # (High + Low + Close) / 3 — best estimate of avg institutional entry
    surge_ratio: float
    day_direction: str      # BULLISH | BEARISH
    ret_1d: float | None    # % change 1 trading day later
    ret_3d: float | None
    ret_5d: float | None


@dataclass
class VolumeHistoryResult:
    symbol: str
    total_spikes: int
    avg_surge_ratio: float
    bullish_spikes: int
    bullish_avg_ret_5d: float | None
    bullish_win_rate: float | None      # % of bullish spikes where price was up 5d later
    bearish_spikes: int
    bearish_avg_ret_5d: float | None
    bearish_win_rate: float | None
    events: list[SpikeEvent]


def _compute(symbol: str) -> "VolumeHistoryResult | None":
    import yfinance as yf

    try:
        df = yf.Ticker(symbol).history(period="1y", interval="1d")
        if df is None or len(df) < ROLLING_WINDOW + 6:
            return None

        df = df[~df.index.duplicated(keep="last")]
        df["vol_avg_20d"] = df["Volume"].rolling(ROLLING_WINDOW).mean()
        df["surge"]       = df["Volume"] / df["vol_avg_20d"]

        spike_mask = df["surge"] >= SURGE_THRESHOLD
        events: list[SpikeEvent] = []

        for idx in df[spike_mask].index:
            pos = df.index.get_loc(idx)
            row = df.loc[idx]
            close0 = float(row["Close"])

            def ret_at(offset, c0=close0, p=pos):
                if p + offset >= len(df):
                    return None
                return round((float(df.iloc[p + offset]["Close"]) - c0) / c0 * 100, 2)

            high  = float(row["High"])
            low   = float(row["Low"])
            open_ = float(row["Open"])
            vwap  = round((high + low + close0) / 3, 4)

            direction = "BULLISH" if close0 >= open_ else "BEARISH"
            events.append(SpikeEvent(
                date=idx.strftime("%Y-%m-%d"),
                price_open=round(open_, 4),
                price_high=round(high, 4),
                price_low=round(low, 4),
                price_close=round(close0, 4),
                vwap_approx=vwap,
                surge_ratio=round(float(row["surge"]), 2),
                day_direction=direction,
                ret_1d=ret_at(1),
                ret_3d=ret_at(3),
                ret_5d=ret_at(5),
            ))

        events.sort(key=lambda e: e.date, reverse=True)

        def stats(evts):
            rets = [e.ret_5d for e in evts if e.ret_5d is not None]
            if not rets:
                return None, None
            avg = round(sum(rets) / len(rets), 2)
            win_rate = round(sum(1 for r in rets if r > 0) / len(rets) * 100, 1)
            return avg, win_rate

        bullish = [e for e in events if e.day_direction == "BULLISH"]
        bearish = [e for e in events if e.day_direction == "BEARISH"]
        b_avg, b_wr = stats(bullish)
        s_avg, s_wr = stats(bearish)
        surges = [e.surge_ratio for e in events]

        return VolumeHistoryResult(
            symbol=symbol,
            total_spikes=len(events),
            avg_surge_ratio=round(sum(surges) / len(surges), 2) if surges else 0.0,
            bullish_spikes=len(bullish),
            bullish_avg_ret_5d=b_avg,
            bullish_win_rate=b_wr,
            bearish_spikes=len(bearish),
            bearish_avg_ret_5d=s_avg,
            bearish_win_rate=s_wr,
            events=events,
        )
    except Exception as e:
        logger.warning("volume_history failed for %s: %s", symbol, e)
        return None


# ── Last 24 hours, hour by hour ───────────────────────────────────────────────
# Regular-session hourly volume vs the usual volume for that same hour, split into
# buying / selling, plus the price move of pre-market / after-hours. Yahoo returns
# extended-hours 1h bars with prices but zero volume (verified 2026-10-16 on
# AVGO/NVDA/AAPL at 1m/5m/15m/1h), so those sessions are reported as price-only.
# Stock bars are rebuilt from cleaned 1m bars and crypto bars come from Coinbase —
# see volume_flow_service for why (Yahoo's fake prints / zero-volume crypto hours).

_24H_CACHE: dict[str, tuple[float, object]] = {}
_24H_TTL         = 300   # 5 min — the current hour keeps growing
_USUAL_SESSIONS  = 20
_REG_OPEN_MIN    = 9 * 60 + 30
_REG_CLOSE_MIN   = 16 * 60


@dataclass
class HourBar:
    start: str            # ISO timestamp in the market's timezone
    minutes: int          # 60, or 30 for the 15:30 stock bar
    volume: int
    usual: int | None     # median volume of this bar time over prior sessions (pro-rated if partial)
    ratio: float | None   # volume / usual
    open: float
    close: float
    partial: bool         # hour still in progress
    buy_volume: int | None = None   # estimated buying share of `volume` (None = no split)


@dataclass
class ExtSession:
    session: str          # PRE | AFTER
    start: str
    end: str
    open: float
    close: float
    change_pct: float


@dataclass
class Volume24hResult:
    symbol: str
    is_crypto: bool
    timezone: str
    window_start: str
    window_end: str
    total_volume: int
    usual_volume: int | None
    ratio: float | None
    label: str            # QUIET | NORMAL | BUSY | VERY_BUSY | UNKNOWN
    spike_start: str | None
    spike_ratio: float | None
    bars: list[HourBar]
    sessions: list[ExtSession]
    data_warning: str | None = None
    removed: list[dict] = field(default_factory=list)   # fake prints dropped (time, volume)
    source: str = "Yahoo 1h bars"


def _activity_label(ratio: float | None) -> str:
    if ratio is None:
        return "UNKNOWN"
    if ratio < 0.7:
        return "QUIET"
    if ratio < 1.3:
        return "NORMAL"
    if ratio < 2.0:
        return "BUSY"
    return "VERY_BUSY"


def _compute_24h(symbol: str, is_crypto: bool) -> "Volume24hResult | None":
    import pandas as pd
    import yfinance as yf

    tz = "UTC" if is_crypto else "America/New_York"
    try:
        df = yf.Ticker(symbol).history(period="1mo", interval="1h", prepost=not is_crypto, auto_adjust=True)
        if df is None or df.empty:
            return None
        df = df[~df.index.duplicated(keep="last")]
        df.index = df.index.tz_convert(tz)

        start_min = df.index.hour * 60 + df.index.minute
        df["regular"] = True if is_crypto else (start_min >= _REG_OPEN_MIN) & (start_min < _REG_CLOSE_MIN)
        # The 15:30 bar ends at the 16:00 close
        df["minutes"] = [30 if (not is_crypto and m == _REG_CLOSE_MIN - 30) else 60 for m in start_min]
        df["key"] = df.index.strftime("%H:%M")
        df["day"] = df.index.date

        now = pd.Timestamp.now(tz=tz)
        last_end = df.index[-1] + pd.Timedelta(minutes=int(df["minutes"].iloc[-1]))
        # Anchor to the latest data so a weekend shows Friday instead of nothing
        window_end = min(now, last_end)
        window_start = window_end - pd.Timedelta(hours=24)
        win = df[df.index >= window_start]

        from app.services import volume_flow_service as flow

        built, removed, minutes, source = None, [], None, "Yahoo 1h bars"
        if is_crypto:
            # Coinbase hourly data runs to "now"; Yahoo's crypto hours are often 0
            cb_end = now
            built = flow.crypto_hour_bars(symbol, cb_end - pd.Timedelta(hours=24), cb_end)
            if built:
                window_end, window_start, source = cb_end, cb_end - pd.Timedelta(hours=24), "Coinbase"
        else:
            built, removed, minutes = flow.stock_hour_bars(symbol, window_start, now)
            source = "Yahoo 1m bars (cleaned)"

        bars: list[HourBar] = []
        if built:
            for b in built:
                usual = b["usual"]
                bars.append(HourBar(
                    start=b["start"].tz_convert(tz).isoformat(),
                    minutes=b["minutes"],
                    volume=b["volume"],
                    usual=int(usual) if usual else None,
                    ratio=round(b["volume"] / usual, 2) if usual else None,
                    open=round(b["open"], 4),
                    close=round(b["close"], 4),
                    partial=b["partial"],
                    buy_volume=b["buy"],
                ))
        else:
            source = "Yahoo 1h bars"
            for ts, row in win[win["regular"]].iterrows():
                prior = df[(df["key"] == row["key"]) & (df["day"] < row["day"]) & df["regular"] & (df["Volume"] > 0)]
                usual = float(prior["Volume"].tail(_USUAL_SESSIONS).median()) if len(prior) else None
                length = int(row["minutes"])
                elapsed = (now - ts).total_seconds() / 60
                partial = elapsed < length
                if partial and usual is not None:
                    usual *= max(elapsed, 1) / length
                vol = int(row["Volume"])
                bars.append(HourBar(
                    start=ts.isoformat(),
                    minutes=length,
                    volume=vol,
                    usual=int(usual) if usual else None,
                    ratio=round(vol / usual, 2) if usual else None,
                    open=round(float(row["Open"]), 4),
                    close=round(float(row["Close"]), 4),
                    partial=partial,
                ))

        sessions: list[ExtSession] = []
        if not is_crypto:
            ext = win[~win["regular"]]
            kind = ["PRE" if (t.hour * 60 + t.minute) < _REG_OPEN_MIN else "AFTER" for t in ext.index]
            for (_, sess), grp in ext.groupby([ext["day"], pd.Series(kind, index=ext.index)], sort=True):
                o, c = float(grp["Open"].iloc[0]), float(grp["Close"].iloc[-1])
                # Pre-market's last bar is 09:00 but the session ends at the 09:30 open
                end = grp.index[-1] + pd.Timedelta(hours=1)
                if sess == "PRE":
                    end = min(end, grp.index[-1].normalize() + pd.Timedelta(minutes=_REG_OPEN_MIN))
                sessions.append(ExtSession(
                    session=sess,
                    start=grp.index[0].isoformat(),
                    end=end.isoformat(),
                    open=round(o, 4),
                    close=round(c, 4),
                    change_pct=round((c / o - 1) * 100, 2) if o else 0.0,
                ))
            sessions.sort(key=lambda s: s.start)

        total = sum(b.volume for b in bars)
        with_usual = [b for b in bars if b.usual]
        usual_total = sum(b.usual for b in with_usual) if with_usual else None
        ratio = round(sum(b.volume for b in with_usual) / usual_total, 2) if usual_total else None
        complete = [b for b in with_usual if not b.partial]
        spike = max(complete, key=lambda b: b.ratio) if complete else None

        # Sanity check: intraday bars normally sum to *less* than Yahoo's daily
        # volume (~75%). Since 2026-10-16 the raw bars ran 4–6× daily; the fake-print
        # filter fixes that, so only warn if the cleaned sum is still far above it.
        data_warning = None
        zero = sum(1 for b in bars if b.volume == 0)
        if is_crypto and source != "Coinbase" and bars and zero / len(bars) > 0.2:
            # Yahoo's hourly crypto bars are often 0 with the volume lumped into a later bar
            data_warning = f"{zero} of {len(bars)} hours have no volume in Yahoo's data, so hourly figures are unreliable."
        elif not is_crypto:
            try:
                daily_vol = float(yf.Ticker(symbol).fast_info.last_volume or 0)
                if minutes is not None and not minutes.empty:
                    last_day = minutes["day"].iloc[-1]
                    hourly_sum = float(minutes[minutes["day"] == last_day]["Volume"].sum())
                else:
                    last_day = df.index[-1].date()
                    hourly_sum = float(df[(df["day"] == last_day) & df["regular"]]["Volume"].sum())
                if daily_vol > 0 and hourly_sum > daily_vol * 1.25:
                    data_warning = (
                        f"Yahoo's intraday volume for {last_day:%b %-d} ({hourly_sum / 1e6:,.1f}M) is far above "
                        f"its own daily total ({daily_vol / 1e6:,.1f}M), so today's figures are likely wrong."
                    )
            except Exception:
                pass

        return Volume24hResult(
            symbol=symbol,
            is_crypto=is_crypto,
            timezone=tz,
            window_start=window_start.isoformat(),
            window_end=window_end.isoformat(),
            total_volume=total,
            usual_volume=usual_total,
            ratio=ratio,
            label=_activity_label(ratio),
            spike_start=spike.start if spike else None,
            spike_ratio=spike.ratio if spike else None,
            bars=bars,
            sessions=sessions,
            data_warning=data_warning,
            removed=removed,
            source=source,
        )
    except Exception as e:
        logger.warning("volume_24h failed for %s: %s", symbol, e)
        return None


async def get_volume_24h(symbol: str, is_crypto: bool) -> "Volume24hResult | None":
    cached = _24H_CACHE.get(symbol)
    if cached and time.time() - cached[0] < _24H_TTL:
        return cached[1]
    result = await asyncio.to_thread(_compute_24h, symbol, is_crypto)
    if result:
        _24H_CACHE[symbol] = (time.time(), result)
    return result


async def get_volume_history(symbol: str) -> "VolumeHistoryResult | None":
    cached = _CACHE.get(symbol)
    if cached and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]
    result = await asyncio.to_thread(_compute, symbol)
    if result:
        _CACHE[symbol] = (time.time(), result)
    return result
