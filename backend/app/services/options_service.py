"""
Options Flow Service

Fetches the nearest-expiry options chain via yfinance and computes:
  - put_call_oi_ratio    — total put OI / total call OI
  - put_call_vol_ratio   — today's put volume / today's call volume
  - atm_iv_pct           — ATM implied volatility (annualised %)
  - iv_skew_pct          — ATM put IV − ATM call IV in pp (positive = fear premium)
  - max_pain_strike      — strike that minimises total OI-weighted loss to option holders
  - max_pain_distance_pct — (max_pain − current_price) / current_price × 100

Results are cached in-memory for 30 minutes per symbol.
Crypto symbols (ending in -USD / -USDT) return None immediately.
Symbols with total OI < 1000 return None (thin market = unreliable data).
"""
import logging
import time
from dataclasses import dataclass

import numpy as np
import pandas as pd
import yfinance as yf

logger = logging.getLogger("options_service")

# 30-minute in-memory cache  {symbol: (timestamp, data_or_None)}
_cache: dict[str, tuple[float, object]] = {}
_CACHE_TTL = 30 * 60  # seconds


@dataclass
class OptionsFlowData:
    symbol: str
    put_call_oi_ratio: float
    put_call_vol_ratio: float
    atm_iv_pct: float            # e.g. 32.5 = 32.5% annualised IV
    iv_skew_pct: float           # put IV − call IV in pp; positive = fear premium
    max_pain_strike: float
    max_pain_distance_pct: float  # positive = max pain above price (bullish pull)
    expiration: str               # nearest expiry date used


def _compute_max_pain(calls: pd.DataFrame, puts: pd.DataFrame) -> float:
    """
    Vectorised max-pain computation.
    For each candidate strike S:
      pain(S) = Σ_calls max(0, S − strike_i) × OI_i
              + Σ_puts  max(0, strike_i − S) × OI_i
    Returns the strike that minimises total pain.
    """
    strikes = np.sort(
        np.union1d(calls["strike"].values, puts["strike"].values)
    )
    if len(strikes) == 0:
        return float("nan")

    call_strikes = calls["strike"].values
    call_oi      = calls["openInterest"].fillna(0).values
    put_strikes  = puts["strike"].values
    put_oi       = puts["openInterest"].fillna(0).values

    # Vectorised pain for every candidate strike
    # strikes[:, None] shape (S, 1) − call_strikes (1, C) → (S, C)
    call_pain = np.maximum(0, strikes[:, None] - call_strikes[None, :]) * call_oi[None, :]
    put_pain  = np.maximum(0, put_strikes[None, :]  - strikes[:, None]) * put_oi[None, :]

    total_pain = call_pain.sum(axis=1) + put_pain.sum(axis=1)
    return float(strikes[np.argmin(total_pain)])


def get_options_flow(symbol: str) -> OptionsFlowData | None:
    """
    Fetch and compute options flow metrics for a stock symbol.
    Returns None for crypto, thin markets, or any fetch error.
    """
    sym_upper = symbol.upper()

    # Crypto has no listed options
    if sym_upper.endswith("-USD") or sym_upper.endswith("-USDT"):
        return None

    # Check cache
    cached = _cache.get(sym_upper)
    if cached is not None:
        ts, data = cached
        if time.time() - ts < _CACHE_TTL:
            return data

    try:
        ticker = yf.Ticker(sym_upper)

        # Get current price via recent history (avoids fast_info race conditions)
        hist = ticker.history(period="2d")
        if hist.empty:
            logger.debug(f"[{sym_upper}] No price history — skipping options")
            _cache[sym_upper] = (time.time(), None)
            return None
        current_price = float(hist["Close"].iloc[-1])

        # Get available expirations
        expirations = ticker.options
        if not expirations:
            logger.debug(f"[{sym_upper}] No options expirations found")
            _cache[sym_upper] = (time.time(), None)
            return None

        # Use nearest monthly expiry (3rd Friday of each month).
        # Monthly contracts have deeper liquidity and better reflect institutional positioning.
        # Falls back to nearest available if no monthly found within 60 days.
        from datetime import date, timedelta
        def _third_friday(year: int, month: int) -> date:
            d = date(year, month, 1)
            fridays = [d + timedelta(days=i) for i in range(31)
                       if (d + timedelta(days=i)).month == month
                       and (d + timedelta(days=i)).weekday() == 4]
            return fridays[2] if len(fridays) >= 3 else fridays[-1]

        today = date.today()
        candidates = []
        for month_offset in range(3):
            m = (today.month - 1 + month_offset) % 12 + 1
            y = today.year + ((today.month - 1 + month_offset) // 12)
            candidates.append(_third_friday(y, m))

        chosen_exp = expirations[0]  # fallback: nearest weekly
        for tf in candidates:
            tf_str = tf.strftime("%Y-%m-%d")
            if tf_str in expirations and tf >= today:
                chosen_exp = tf_str
                break
        chain = ticker.option_chain(chosen_exp)
        calls: pd.DataFrame = chain.calls.copy()
        puts:  pd.DataFrame = chain.puts.copy()

        # Guard: thin market
        total_oi = (
            calls["openInterest"].fillna(0).sum()
            + puts["openInterest"].fillna(0).sum()
        )
        if total_oi < 1000:
            logger.debug(f"[{sym_upper}] Thin options market (total OI={total_oi:.0f}) — skipping")
            _cache[sym_upper] = (time.time(), None)
            return None

        # ── Put/Call ratios ────────────────────────────────────────────────
        call_oi_total  = float(calls["openInterest"].fillna(0).sum())
        put_oi_total   = float(puts["openInterest"].fillna(0).sum())
        call_vol_total = float(calls["volume"].fillna(0).sum())
        put_vol_total  = float(puts["volume"].fillna(0).sum())

        pc_oi_ratio  = put_oi_total  / (call_oi_total  + 1e-9)
        pc_vol_ratio = put_vol_total / (call_vol_total + 1e-9)

        # ── ATM IV ────────────────────────────────────────────────────────
        # Find the strike closest to current price in each chain
        def _atm_row(df: pd.DataFrame) -> pd.Series | None:
            if df.empty:
                return None
            idx = (df["strike"] - current_price).abs().idxmin()
            return df.loc[idx]

        atm_call = _atm_row(calls)
        atm_put  = _atm_row(puts)

        atm_call_iv = float(atm_call["impliedVolatility"]) if atm_call is not None else float("nan")
        atm_put_iv  = float(atm_put["impliedVolatility"])  if atm_put  is not None else float("nan")

        # impliedVolatility from yfinance is already annualised (0–1 range, e.g. 0.325 = 32.5%)
        atm_iv_pct   = round(np.nanmean([atm_call_iv, atm_put_iv]) * 100, 2)
        iv_skew_pct  = round((atm_put_iv - atm_call_iv) * 100, 2)

        # ── Max pain ──────────────────────────────────────────────────────
        max_pain = _compute_max_pain(calls, puts)
        if np.isnan(max_pain):
            max_pain_dist = 0.0
        else:
            max_pain_dist = round((max_pain - current_price) / current_price * 100, 2)

        result = OptionsFlowData(
            symbol              = sym_upper,
            put_call_oi_ratio   = round(pc_oi_ratio,  3),
            put_call_vol_ratio  = round(pc_vol_ratio, 3),
            atm_iv_pct          = atm_iv_pct,
            iv_skew_pct         = iv_skew_pct,
            max_pain_strike     = round(float(max_pain), 4) if not np.isnan(max_pain) else 0.0,
            max_pain_distance_pct = max_pain_dist,
            expiration          = chosen_exp,
        )

        logger.debug(
            f"[{sym_upper}] Options: P/C OI={result.put_call_oi_ratio:.2f} "
            f"ATM IV={result.atm_iv_pct:.1f}% max_pain={result.max_pain_strike} "
            f"dist={result.max_pain_distance_pct:+.2f}%"
        )
        _cache[sym_upper] = (time.time(), result)
        return result

    except Exception as e:
        logger.warning(f"[{sym_upper}] Options fetch failed: {e}")
        _cache[sym_upper] = (time.time(), None)
        return None
