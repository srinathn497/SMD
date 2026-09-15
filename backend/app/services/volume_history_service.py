"""
Volume History Service

Identifies historical volume spike days (≥2× 20-day average) for a symbol
and computes subsequent price returns (+1d, +3d, +5d) to show how the price
behaved after large institutional volume events.
"""
import asyncio
import logging
import time
from dataclasses import dataclass

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


async def get_volume_history(symbol: str) -> "VolumeHistoryResult | None":
    cached = _CACHE.get(symbol)
    if cached and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]
    result = await asyncio.to_thread(_compute, symbol)
    if result:
        _CACHE[symbol] = (time.time(), result)
    return result
