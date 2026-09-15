"""
Smart Money Service

Combines two signals to detect institutional/large-player activity:
  1. Options flow  — put/call ratios, IV skew, max pain (from options_service)
  2. Volume surge  — today's volume vs 20-day average, VWAP position

Score range: -4 (strong distribution) to +4 (strong accumulation)
Signals: STRONG_BUY | BUY | NEUTRAL | SELL | STRONG_SELL

Results cached 5 minutes per symbol. Options data underneath has its own 30-min cache.
"""
import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import yfinance as yf

from app.services.options_service import get_options_flow

logger = logging.getLogger("smart_money_service")

_cache: dict[str, tuple[float, object]] = {}
_CACHE_TTL = 5 * 60  # 5 minutes

SIGNAL_ORDER = ["STRONG_BUY", "BUY", "NEUTRAL", "SELL", "STRONG_SELL"]


@dataclass
class SmartMoneyResult:
    symbol: str
    asset_type: str
    price: float
    signal: str              # STRONG_BUY | BUY | NEUTRAL | SELL | STRONG_SELL
    signal_score: int        # -4 to +4

    # Options (None for crypto or thin markets)
    put_call_vol_ratio: float | None
    put_call_oi_ratio: float | None
    atm_iv_pct: float | None
    iv_skew_pct: float | None
    max_pain_strike: float | None
    max_pain_distance_pct: float | None
    options_bias: str        # BULLISH | BEARISH | NEUTRAL | N/A
    expiration: str | None

    # Volume
    volume_today: int
    volume_avg_20d: int
    volume_surge_ratio: float
    vwap: float
    above_vwap: bool
    volume_bias: str         # ACCUMULATION | DISTRIBUTION | NEUTRAL

    scanned_at: str          # ISO timestamp


def _score_to_signal(score: int) -> str:
    if score >= 3:
        return "STRONG_BUY"
    if score >= 1:
        return "BUY"
    if score <= -3:
        return "STRONG_SELL"
    if score <= -1:
        return "SELL"
    return "NEUTRAL"


def _options_bias(pc_vol: float | None) -> str:
    if pc_vol is None:
        return "N/A"
    if pc_vol < 0.7:
        return "BULLISH"
    if pc_vol > 1.5:
        return "BEARISH"
    return "NEUTRAL"


def _volume_bias(surge: float, above_vwap: bool) -> str:
    if surge < 1.5:
        return "NEUTRAL"
    return "ACCUMULATION" if above_vwap else "DISTRIBUTION"


def get_smart_money(symbol: str, asset_type: str = "stock") -> SmartMoneyResult | None:
    """
    Synchronous — call via asyncio.to_thread from async contexts.
    Returns None on any fetch failure.
    """
    sym = symbol.upper()

    # Check cache
    cached = _cache.get(sym)
    if cached is not None:
        ts, data = cached
        if time.time() - ts < _CACHE_TTL:
            return data

    try:
        ticker = yf.Ticker(sym)

        # ── Intraday volume + VWAP ────────────────────────────────────────
        intraday = ticker.history(period="1d", interval="1m")
        if intraday.empty:
            logger.debug(f"[{sym}] No intraday data")
            _cache[sym] = (time.time(), None)
            return None

        intraday = intraday[~intraday.index.duplicated(keep="last")]
        vol_sum = float(intraday["Volume"].sum())
        volume_today = int(vol_sum)
        current_price = float(intraday["Close"].iloc[-1])

        if vol_sum > 0:
            vwap = float((intraday["Close"] * intraday["Volume"]).sum() / vol_sum)
        else:
            vwap = current_price
        above_vwap = current_price > vwap

        # 20-day average volume
        daily = ticker.history(period="30d", interval="1d")
        daily = daily[~daily.index.duplicated(keep="last")]
        volume_avg_20d = int(daily["Volume"].tail(20).mean()) if not daily.empty else 1
        surge_ratio = round(volume_today / max(volume_avg_20d, 1), 2)

        # ── Options flow (stocks only) ────────────────────────────────────
        opts = None
        if asset_type != "crypto":
            opts = get_options_flow(sym)

        # ── Score ─────────────────────────────────────────────────────────
        score = 0

        if opts is not None:
            # P/C volume ratio
            if opts.put_call_vol_ratio < 0.7:
                score += 1   # call sweep — bullish
            elif opts.put_call_vol_ratio > 1.5:
                score -= 1   # put sweep — bearish

            # IV skew (put IV − call IV): negative = unusual call demand
            if opts.iv_skew_pct < -5:
                score += 1
            elif opts.iv_skew_pct > 10:
                score -= 1

            # Max pain gravity
            if opts.max_pain_distance_pct > 2:
                score += 1   # max pain above price → upward pull
            elif opts.max_pain_distance_pct < -2:
                score -= 1

        # Volume + VWAP
        if surge_ratio >= 2.0:
            score += 1 if above_vwap else -1

        signal = _score_to_signal(score)

        result = SmartMoneyResult(
            symbol               = sym,
            asset_type           = asset_type,
            price                = round(current_price, 6 if current_price < 1 else 4),
            signal               = signal,
            signal_score         = score,
            put_call_vol_ratio   = round(opts.put_call_vol_ratio, 3)   if opts else None,
            put_call_oi_ratio    = round(opts.put_call_oi_ratio, 3)    if opts else None,
            atm_iv_pct           = opts.atm_iv_pct                     if opts else None,
            iv_skew_pct          = opts.iv_skew_pct                    if opts else None,
            max_pain_strike      = opts.max_pain_strike                 if opts else None,
            max_pain_distance_pct= opts.max_pain_distance_pct          if opts else None,
            options_bias         = _options_bias(opts.put_call_vol_ratio if opts else None),
            expiration           = opts.expiration                      if opts else None,
            volume_today         = volume_today,
            volume_avg_20d       = volume_avg_20d,
            volume_surge_ratio   = surge_ratio,
            vwap                 = round(vwap, 4),
            above_vwap           = above_vwap,
            volume_bias          = _volume_bias(surge_ratio, above_vwap),
            scanned_at           = datetime.now(timezone.utc).isoformat(),
        )

        logger.debug(
            f"[{sym}] signal={signal}({score}) surge={surge_ratio:.1f}x "
            f"vwap={'above' if above_vwap else 'below'} "
            f"pc_vol={opts.put_call_vol_ratio:.2f}" if opts else f"[{sym}] signal={signal}({score}) surge={surge_ratio:.1f}x"
        )
        _cache[sym] = (time.time(), result)
        return result

    except Exception as e:
        logger.warning(f"[{sym}] Smart money scan failed: {e}")
        _cache[sym] = (time.time(), None)
        return None


async def scan_smart_money(
    symbols: list[tuple[str, str]],
) -> list[SmartMoneyResult]:
    """
    Concurrent scan across all symbols. Returns sorted by signal strength
    (STRONG_BUY first, STRONG_SELL last, NEUTRAL in middle).
    """
    tasks = [
        asyncio.to_thread(get_smart_money, sym, atype)
        for sym, atype in symbols
    ]
    raw = await asyncio.gather(*tasks, return_exceptions=True)

    results = [r for r in raw if isinstance(r, SmartMoneyResult)]

    results.sort(key=lambda r: SIGNAL_ORDER.index(r.signal))
    return results
