"""
Intraday context service — Phase 2.

Answers the two core trader questions with a richer, multi-factor signal:
  1. "I'm up $30 today — should I hold or take profits?"
  2. "This stock is up $50 today — is now a good entry point?"

New in Phase 2:
  - VWAP (Volume-Weighted Average Price) — institutional price anchor
  - Time-of-day awareness — different caution levels for Open / Midday / Power Hour
  - Composite scoring (-6 → +6) instead of hard thresholds on a single indicator
  - Daily ML direction integration → fused "Combined Verdict" for clear action guidance
  - STRONG_ENTRY signal level added above GOOD_ENTRY
"""
import logging
from zoneinfo import ZoneInfo

import pandas as pd
import pandas_ta as ta

from app.schemas.signals import HourlyBar, IntradayContext

logger = logging.getLogger("intraday")

ET = ZoneInfo("America/New_York")

# Market session boundaries (minutes since midnight ET)
_OPEN       = 9 * 60 + 30   # 570
_CLOSE      = 16 * 60        # 960


# ── Time-of-day ────────────────────────────────────────────────────────────────

def _time_of_day(last_ts: pd.Timestamp, is_crypto: bool) -> tuple[str, bool]:
    """
    Returns (label, caution_flag).
    caution_flag = True during volatile open, low-vol midday, and erratic close.
    Crypto markets trade 24/7 — we skip caution flags for them.
    """
    if is_crypto:
        return "24H_MARKET", False

    try:
        if last_ts.tzinfo is None:
            ts_et = last_ts.replace(tzinfo=ET)
        else:
            ts_et = last_ts.astimezone(ET)
        mins = ts_et.hour * 60 + ts_et.minute
    except Exception:
        return "UNKNOWN", False

    if mins < _OPEN or mins >= _CLOSE:
        return "AFTER_HOURS", True
    if mins < _OPEN + 30:          # 9:30–10:00
        return "OPEN", True        # erratic, wide spreads, false signals common
    if mins < _OPEN + 90:          # 10:00–11:00
        return "MID_MORNING", False  # best directional window
    if mins < 14 * 60:             # 11:00–14:00
        return "MIDDAY", True      # low volume, choppy
    if mins < 15 * 60 + 30:        # 14:00–15:30
        return "POWER_HOUR", False  # institutions active again
    return "CLOSE", True           # 15:30–16:00, erratic last-minute moves


# ── VWAP ───────────────────────────────────────────────────────────────────────

def _compute_vwap(today_bars: pd.DataFrame, current_price: float) -> tuple[float, float, str]:
    """
    Returns (vwap, deviation_pct, position_label).
    VWAP resets at market open — computed only on today's bars.
    """
    try:
        bars = today_bars[today_bars["volume"] > 0].copy() if "volume" in today_bars.columns else today_bars.copy()
        if bars.empty:
            bars = today_bars.copy()
        typical = (bars["high"] + bars["low"] + bars["close"]) / 3
        cum_tpv = (typical * bars["volume"]).cumsum()
        cum_vol = bars["volume"].cumsum()
        vwap = float(cum_tpv.iloc[-1] / (cum_vol.iloc[-1] + 1e-9))
    except Exception:
        vwap = current_price

    dev_pct = (current_price - vwap) / (vwap + 1e-9) * 100
    if dev_pct > 0.4:
        pos = "ABOVE_VWAP"
    elif dev_pct < -0.4:
        pos = "BELOW_VWAP"
    else:
        pos = "AT_VWAP"

    return round(vwap, 4), round(dev_pct, 2), pos


# ── Composite scoring ──────────────────────────────────────────────────────────

def _composite_score(
    rsi_1h: float,
    vwap_dev_pct: float,
    atr_coverage: float,
    volume_ratio: float,
    daily_direction: str,
    time_of_day: str,
    time_caution: bool,
) -> tuple[int, list[str]]:
    """
    Build a -6 → +6 score by summing independent signals.
    Returns (score, component_descriptions).

    Positive = bullish conditions (favour entry / hold long).
    Negative = bearish / extended conditions (favour exit / avoid new entry).
    """
    score = 0
    parts: list[str] = []

    # ── RSI (1h) ─────────────────────────────────────────────────────────────
    if rsi_1h <= 30:
        score += 3; parts.append(f"RSI {rsi_1h:.0f} — strongly oversold (+3)")
    elif rsi_1h <= 40:
        score += 2; parts.append(f"RSI {rsi_1h:.0f} — oversold (+2)")
    elif rsi_1h <= 47:
        score += 1; parts.append(f"RSI {rsi_1h:.0f} — mild bullish lean (+1)")
    elif rsi_1h >= 70:
        score -= 3; parts.append(f"RSI {rsi_1h:.0f} — strongly overbought (-3)")
    elif rsi_1h >= 60:
        score -= 2; parts.append(f"RSI {rsi_1h:.0f} — overbought (-2)")
    elif rsi_1h >= 53:
        score -= 1; parts.append(f"RSI {rsi_1h:.0f} — mild bearish lean (-1)")

    # ── VWAP deviation ────────────────────────────────────────────────────────
    if vwap_dev_pct < -1.5:
        score += 2; parts.append(f"{abs(vwap_dev_pct):.1f}% below VWAP — significant discount (+2)")
    elif vwap_dev_pct < -0.4:
        score += 1; parts.append(f"{abs(vwap_dev_pct):.1f}% below VWAP — discount (+1)")
    elif vwap_dev_pct > 1.5:
        score -= 2; parts.append(f"{vwap_dev_pct:.1f}% above VWAP — extended premium (-2)")
    elif vwap_dev_pct > 0.4:
        score -= 1; parts.append(f"{vwap_dev_pct:.1f}% above VWAP — slight premium (-1)")

    # ── ATR extension ─────────────────────────────────────────────────────────
    if atr_coverage >= 2.0:
        score -= 3; parts.append(f"{atr_coverage:.1f}× ATR — extreme extension (-3)")
    elif atr_coverage >= 1.5:
        score -= 2; parts.append(f"{atr_coverage:.1f}× ATR — extended, risky to chase (-2)")
    elif atr_coverage >= 1.0:
        score -= 1; parts.append(f"{atr_coverage:.1f}× ATR — near full daily range (-1)")
    elif atr_coverage < 0.4:
        score += 1; parts.append(f"only {atr_coverage:.1f}× ATR used — plenty of room (+1)")

    # ── Volume (amplifier, not standalone) ───────────────────────────────────
    if volume_ratio >= 1.5:
        if score > 0:
            score += 1; parts.append(f"volume {volume_ratio:.1f}× avg confirms bullish move (+1)")
        elif score < 0:
            score -= 1; parts.append(f"volume {volume_ratio:.1f}× avg confirms bearish move (-1)")
        # score == 0: high volume on neutral signal — no change
    elif volume_ratio < 0.6:
        # Low volume reduces conviction — halve the RSI+VWAP contribution
        old = score
        score = score // 2
        if old != score:
            parts.append(f"low volume {volume_ratio:.1f}× — reduced conviction (halved)")

    # ── Daily ML direction (macro context) ───────────────────────────────────
    dd = daily_direction.upper()
    if dd == "UP":
        score += 1; parts.append("daily ML trend: UP (+1)")
    elif dd == "DOWN":
        score -= 1; parts.append("daily ML trend: DOWN (-1)")

    # ── Time-of-day modifier ──────────────────────────────────────────────────
    if time_caution and abs(score) > 1:
        label = time_of_day.replace("_", " ").title()
        old = score
        # Cap magnitude to ±2 during caution windows (false signals are common)
        score = max(-2, min(2, score))
        if old != score:
            parts.append(f"caution: {label} — signals less reliable (capped to ±2)")

    return score, parts


# ── Signal from score ──────────────────────────────────────────────────────────

def _signal_from_score(score: int) -> str:
    if score >= 4:
        return "STRONG_ENTRY"
    if score >= 2:
        return "GOOD_ENTRY"
    if score <= -4:
        return "TAKE_PROFITS"
    if score <= -2:
        return "WAIT_PULLBACK"
    return "NEUTRAL"


def _signal_reason(signal: str, parts: list[str], time_of_day: str, time_caution: bool) -> str:
    """One concise sentence explaining the signal, then list key drivers."""
    intros = {
        "STRONG_ENTRY":  "Multiple indicators align bullishly — strong entry setup.",
        "GOOD_ENTRY":    "Conditions favour a long entry; risk/reward is favourable.",
        "NEUTRAL":       "No strong edge in either direction right now.",
        "WAIT_PULLBACK": "Stock is extended or overbought — poor risk/reward to enter here.",
        "TAKE_PROFITS":  "Multiple bearish signals align — seriously consider locking in profits.",
    }
    caution_note = ""
    if time_caution and time_of_day not in ("AFTER_HOURS", "UNKNOWN", "24H_MARKET"):
        label = time_of_day.replace("_", " ").title()
        caution_note = f" Note: {label} is a lower-reliability window."

    drivers = "; ".join(p.split(" — ")[0] for p in parts[:3])
    return f"{intros.get(signal, '')} Key factors: {drivers}.{caution_note}"


# ── Combined verdict ───────────────────────────────────────────────────────────

def _combined_verdict(
    daily_direction: str,
    daily_confidence: float,
    intraday_signal: str,
) -> tuple[str, str]:
    """
    Fuse daily ML direction with intraday signal into one clear action.
    Returns (verdict_text, action_code).
    action_code: BUY | SELL | WAIT | NEUTRAL
    """
    dd = daily_direction.upper()
    conf_str = f"{daily_confidence:.0f}%" if daily_confidence > 0 else ""
    conf_label = f" ({conf_str} confidence)" if conf_str else ""

    bullish_signals = {"STRONG_ENTRY", "GOOD_ENTRY"}
    bearish_signals = {"TAKE_PROFITS", "WAIT_PULLBACK"}

    if dd == "UP":
        if intraday_signal == "STRONG_ENTRY":
            return (
                f"Daily ML ↑ UP{conf_label} + intraday strongly oversold/discounted "
                "→ Best entry setup. Strong confluence — consider entering now.",
                "BUY",
            )
        if intraday_signal == "GOOD_ENTRY":
            return (
                f"Daily ML ↑ UP{conf_label} + intraday below VWAP/oversold "
                "→ Good entry. Trend and timing agree — reasonable to enter.",
                "BUY",
            )
        if intraday_signal == "NEUTRAL":
            return (
                f"Daily ML ↑ UP{conf_label} + intraday neutral "
                "→ No ideal entry yet. Wait for a dip below VWAP or RSI < 45 for better risk/reward.",
                "WAIT",
            )
        if intraday_signal in bearish_signals:
            return (
                f"Daily ML ↑ UP{conf_label} but intraday is overbought/extended "
                "→ Do NOT chase here. Wait for pullback to VWAP — the daily trend is your friend but timing is poor.",
                "WAIT",
            )

    elif dd == "DOWN":
        if intraday_signal in bearish_signals:
            return (
                f"Daily ML ↓ DOWN{conf_label} + intraday overbought/extended "
                "→ Strong exit signal. Reduce or close long positions. Trend and timing both bearish.",
                "SELL",
            )
        if intraday_signal == "NEUTRAL":
            return (
                f"Daily ML ↓ DOWN{conf_label} + intraday neutral "
                "→ Avoid new longs. Watch for breakdown below support / VWAP.",
                "WAIT",
            )
        if intraday_signal in bullish_signals:
            return (
                f"Daily ML ↓ DOWN{conf_label} but intraday is oversold "
                "→ Possible dead-cat bounce only. High risk for longs — wait for daily signal to turn UP first.",
                "WAIT",
            )

    # No daily context
    return (
        "Load the ML Prediction to combine daily trend with this intraday signal for a clear action.",
        "NEUTRAL",
    )


# ── RSI / volume status helpers ─────────────────────────────────────────────────

def _rsi_status(rsi: float) -> str:
    if rsi >= 65: return "OVERBOUGHT"
    if rsi <= 35: return "OVERSOLD"
    return "NEUTRAL"


def _volume_status(ratio: float) -> str:
    if ratio >= 1.5: return "HIGH"
    if ratio <= 0.7: return "LOW"
    return "NORMAL"


# ── Main computation ────────────────────────────────────────────────────────────

def compute_intraday(
    df_1h: pd.DataFrame,
    df_1d: pd.DataFrame,
    symbol: str,
    daily_direction: str = "UNKNOWN",
    daily_confidence: float = 0.0,
    asset_type: str = "stock",
) -> IntradayContext:
    """
    df_1h — 1h OHLCV DataFrame (30 days of data for reliable RSI warmup)
    df_1d — 1d OHLCV DataFrame (3 months of data)
    """
    is_crypto = asset_type == "crypto"

    df_1h = df_1h.copy()
    df_1h.index = pd.to_datetime(df_1h.index)

    # ── Identify "today" = date of the most recent bar ─────────────────────
    last_ts = df_1h.index[-1]
    if last_ts.tzinfo is not None:
        last_date = last_ts.tz_convert("UTC").date()
        df_1h["_date"] = df_1h.index.tz_convert("UTC").date
    else:
        last_date = last_ts.date()
        df_1h["_date"] = df_1h.index.date

    today_bars = df_1h[df_1h["_date"] == last_date]
    if today_bars.empty:
        today_bars = df_1h.iloc[-6:]

    today_open    = float(today_bars["open"].iloc[0])
    today_high    = float(today_bars["high"].max())
    today_low     = float(today_bars["low"].min())
    current_price = float(today_bars["close"].iloc[-1])
    today_change_pct = (current_price - today_open) / (today_open + 1e-9) * 100
    today_move_usd   = abs(current_price - today_open)

    # ── RSI on 1h bars ─────────────────────────────────────────────────────
    rsi_series = ta.rsi(df_1h["close"], length=14)
    rsi_1h = float(rsi_series.dropna().iloc[-1]) if rsi_series is not None and not rsi_series.dropna().empty else 50.0

    # ── Daily ATR for extension gauge ───────────────────────────────────────
    atr_series = ta.atr(df_1d["high"], df_1d["low"], df_1d["close"], length=14)
    daily_atr  = float(atr_series.dropna().iloc[-1]) if atr_series is not None and not atr_series.dropna().empty else max(today_move_usd, 1.0)
    atr_coverage = today_move_usd / (daily_atr + 1e-9)

    # ── Volume pulse ─────────────────────────────────────────────────────────
    today_volume  = float(today_bars["volume"].sum()) if "volume" in today_bars.columns else 0.0
    avg_daily_vol = float(df_1d["volume"].tail(20).mean()) if "volume" in df_1d.columns else 1.0
    volume_ratio  = min(round(today_volume / (avg_daily_vol + 1e-9), 2), 9.99)

    # ── VWAP ─────────────────────────────────────────────────────────────────
    vwap, vwap_dev_pct, vwap_position = _compute_vwap(today_bars, current_price)

    # ── Time of day ──────────────────────────────────────────────────────────
    time_of_day, time_caution = _time_of_day(last_ts, is_crypto)

    # ── Composite score ───────────────────────────────────────────────────────
    score, score_components = _composite_score(
        rsi_1h, vwap_dev_pct, atr_coverage, volume_ratio,
        daily_direction, time_of_day, time_caution,
    )
    score = max(-6, min(6, score))

    # ── Intraday signal + combined verdict ────────────────────────────────────
    intraday_signal = _signal_from_score(score)
    signal_reason   = _signal_reason(intraday_signal, score_components, time_of_day, time_caution)
    combined_verdict, combined_action = _combined_verdict(daily_direction, daily_confidence, intraday_signal)

    # ── Support / Resistance from last 24 hourly bars ─────────────────────────
    recent_1h         = df_1h.tail(24)
    nearest_support    = float(recent_1h["low"].min())
    nearest_resistance = float(recent_1h["high"].max())

    # ── Hourly sparkline — last 8 bars ────────────────────────────────────────
    hourly_bars = []
    for ts, row in df_1h.tail(8).iterrows():
        t = int(ts.timestamp()) if hasattr(ts, "timestamp") else int(pd.Timestamp(ts).timestamp())
        hourly_bars.append(HourlyBar(
            time=t,
            open=round(float(row["open"]), 4),
            high=round(float(row["high"]), 4),
            low=round(float(row["low"]),  4),
            close=round(float(row["close"]), 4),
        ))

    return IntradayContext(
        symbol=symbol.upper(),
        current_price=round(current_price, 2),
        today_open=round(today_open, 2),
        today_change_pct=round(today_change_pct, 2),
        today_high=round(today_high, 2),
        today_low=round(today_low, 2),
        daily_atr=round(daily_atr, 2),
        today_move_usd=round(today_move_usd, 2),
        atr_coverage=round(atr_coverage, 2),
        rsi_1h=round(rsi_1h, 1),
        rsi_status=_rsi_status(rsi_1h),
        vwap=round(vwap, 2),
        vwap_deviation_pct=vwap_dev_pct,
        vwap_position=vwap_position,
        volume_ratio=volume_ratio,
        volume_status=_volume_status(volume_ratio),
        time_of_day=time_of_day,
        time_caution=time_caution,
        nearest_support=round(nearest_support, 2),
        nearest_resistance=round(nearest_resistance, 2),
        composite_score=score,
        score_components=score_components,
        daily_direction=daily_direction.upper(),
        daily_confidence=round(daily_confidence, 1),
        combined_verdict=combined_verdict,
        combined_action=combined_action,
        intraday_signal=intraday_signal,
        signal_reason=signal_reason,
        hourly_bars=hourly_bars,
    )
