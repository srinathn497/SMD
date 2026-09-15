"""
Conviction Score Service

Aggregates up to 17 independent signals into a single score.
Stocks get 17 signals (7 base + 4 options flow + 2 structural + 4 fundamental).
Crypto gets  9 signals (7 base + 2 structural).

The signals:
  1.  Technical aggregate  (RSI + MACD + BB + EMA majority vote)
  2.  Daily ML direction   (LightGBM next-day, calibrated, ≥55% confidence)
  3.  15m ML direction     (intraday LightGBM, calibrated, ≥55% confidence)
  4.  News sentiment       (RSS keyword sentiment: POSITIVE / NEGATIVE)
  5.  Volume               (today's volume ≥ 1.5× 20-day average)
  6.  Intraday signal      (GOOD_ENTRY / STRONG_ENTRY for BUY; TAKE_PROFITS for SELL)
  7.  Intraday score       (composite ≥ +2 for BUY; ≤ −2 for SELL)
  8.  Put/Call OI Ratio    (stocks only — <0.7 = bullish, >1.3 = bearish)
  9.  Max Pain             (stocks only — >+0.5% above price = bullish pull)
  10. IV Skew              (stocks only — negative skew = unusual call demand = bullish)
  11. Put/Call Volume      (stocks only — <0.7 = call flow dominant = bullish)
  12. Breakout+Momentum    (price breaks 20d high/low with volume + MA confirmation)
  13. Mean Reversion       (Z-score ≤ −2 = deeply oversold BUY; ≥ +2 = overextended SELL)
  14. Fundamental Health   (health_score ≥ 5 = BUY; ≤ 2 = SELL — stocks only)
  15. FCF Yield            (> 3% = BUY; < 0% = SELL — stocks only)
  16. Debt/Equity          (< 0.5 = BUY; > 2.0 = SELL — stocks only)
  17. P/E Valuation        (< 15× = value BUY; > 40× = speculative SELL — stocks only)
"""
import asyncio
import logging
from dataclasses import dataclass, field

from app.services.intraday import compute_intraday
from app.services.intraday_predictor import intra_predictor
from app.services.market_data import market_data_service
from app.services.ml_predictor import ml_predictor
from app.services.news_service import get_news
from app.services.technical import technical_analysis

logger = logging.getLogger("conviction")


# ── Result types ───────────────────────────────────────────────────────────────

@dataclass
class ConvictionSignal:
    name:   str
    passed: bool
    detail: str


@dataclass
class ConvictionResult:
    symbol:         str
    score:          int          # raw signal count
    max_score:      int          # total signals evaluated
    label:          str          # HIGH_CONVICTION | MODERATE | WEAK | NEUTRAL
    direction:      str          # BUY | SELL | NEUTRAL
    confidence_pct: float = 0.0  # weighted score ratio × 100
    signals:        list = field(default_factory=list)


def _label(score: float, max_score: float, direction: str) -> str:
    if direction == "NEUTRAL" or score == 0:
        return "NEUTRAL"
    ratio = score / max_score
    if ratio >= 0.78:   # ≥14/17 — strong supermajority
        return "HIGH_CONVICTION"
    if ratio >= 0.50:   # ≥9/17 — simple majority
        return "MODERATE"
    if ratio >= 0.28:   # ≥5/17 — minority agreement
        return "WEAK"
    return "NEUTRAL"


# ── Main entry point ───────────────────────────────────────────────────────────

async def compute_conviction(
    symbol: str,
    asset_type: str = "stock",
    allow_training: bool = True,
) -> ConvictionResult:
    """
    Fetch all required data concurrently, then score each of the 7 signals.
    Each unavailable signal is skipped (doesn't penalise the score).

    allow_training=False (used by the bulk conviction scan): if the daily ML
    bundle is stale/missing, skip the ML signal instead of retraining inline —
    a bulk scan cannot afford a multi-minute retrain per symbol.
    """

    is_stock = not (symbol.upper().endswith("-USD") or symbol.upper().endswith("-USDT"))

    # ── 1. Parallel data fetch ─────────────────────────────────────────────────
    from app.services.options_service import get_options_flow
    from app.services.fundamental_service import get_fundamentals
    fetches = await asyncio.gather(
        market_data_service.get_ohlcv_df(symbol, asset_type, "1d", period="3y"),   # ML + technical
        market_data_service.get_ohlcv_df(symbol, asset_type, "1h", period="5d"),   # intraday context
        market_data_service.get_ohlcv_df(symbol, asset_type, "15m", period="60d"), # 15m ML
        market_data_service.get_ohlcv_df(symbol, asset_type, "1d", period="3mo"),  # intraday context daily anchor
        get_news(symbol, asset_type),
        asyncio.to_thread(get_options_flow, symbol)    if is_stock else asyncio.sleep(0),
        asyncio.to_thread(get_fundamentals, symbol)    if is_stock else asyncio.sleep(0),
        return_exceptions=True,
    )
    df_1d_long, df_1h, df_15m, df_1d_short, news_result, options_result, fund_result = fetches

    # asyncio.sleep(0) returns None for crypto; treat that as no options/fundamental data
    if not is_stock or isinstance(options_result, Exception):
        options_result = None
    if not is_stock or isinstance(fund_result, Exception):
        fund_result = None

    # ── 2. Collect each signal's opinion ──────────────────────────────────────
    # Opinion: "BUY" | "SELL" | None (unavailable or HOLD/NEUTRAL)
    # Each opinion contributes a vote to determine direction.
    # After direction is set, each signal is scored: did it agree?

    tech_opinion  = None   # "BUY" | "SELL" | None
    ml_opinion    = None
    intra_opinion = None
    news_opinion  = None

    tech_detail  = ("unavailable", "unavailable")   # (pass_text, fail_text)
    ml_detail    = ("unavailable", "unavailable")
    intra_detail = ("unavailable", "unavailable")
    news_detail  = ("unavailable", "unavailable")

    vol_passes   = False
    vol_detail   = "unavailable"
    sig6_passes  = False
    sig6_detail  = "unavailable"
    sig7_passes  = False
    sig7_detail  = "unavailable"

    options_opinion_8  = None
    options_detail_8   = "unavailable"
    options_opinion_9  = None
    options_detail_9   = "unavailable"
    options_opinion_10 = None
    options_detail_10  = "unavailable"
    options_opinion_11 = None
    options_detail_11  = "unavailable"

    ml_result   = None
    intra_ctx   = None

    # ── Signal 1: Technical aggregate ─────────────────────────────────────────
    try:
        if isinstance(df_1d_long, Exception):
            raise df_1d_long
        tech = technical_analysis.compute_all(df_1d_long, symbol, asset_type)
        n    = len(tech.indicators)
        if tech.aggregate_signal == "BUY":
            tech_opinion = "BUY"
            tech_detail  = (
                f"BUY — {tech.buy_count}/{n} indicators bullish",
                f"BUY — {tech.buy_count}/{n} indicators bullish",
            )
        elif tech.aggregate_signal == "SELL":
            tech_opinion = "SELL"
            tech_detail  = (
                f"SELL — {tech.sell_count}/{n} indicators bearish",
                f"SELL — {tech.sell_count}/{n} indicators bearish",
            )
        else:
            tech_detail = (
                f"HOLD — signals split ({tech.buy_count} buy / {tech.sell_count} sell)",
                f"HOLD — signals split ({tech.buy_count} buy / {tech.sell_count} sell)",
            )
    except Exception as e:
        logger.debug(f"[{symbol}] Technical: {e}")

    # ── Signal 2: Daily ML ────────────────────────────────────────────────────
    try:
        if isinstance(df_1d_long, Exception):
            raise df_1d_long
        if not allow_training and ml_predictor.needs_retrain(symbol, "3y"):
            ml_detail = (
                "model needs refresh — run Refresh Models",
                "model needs refresh — run Refresh Models",
            )
            raise RuntimeError("stale model, training skipped")
        s_score = 0.0
        s_label = "NEUTRAL"
        if not isinstance(news_result, Exception) and news_result is not None:
            s_score = news_result.score
            s_label = news_result.label
        # ml_predictor.predict() is synchronous and can trigger a full retrain
        # (40+ seconds).  Running it in a thread keeps the event loop unblocked
        # so other concurrent scan tasks can proceed while training happens.
        ml_result = await asyncio.to_thread(
            ml_predictor.predict,
            symbol, df_1d_long, "3y",
            sentiment_score=s_score,
            sentiment_label=s_label,
        )
        cal_tag = " (calibrated)" if ml_result.is_calibrated else ""
        if ml_result.confidence_pct >= 55:
            ml_opinion = "BUY" if ml_result.direction == "UP" else "SELL"
            ml_detail  = (
                f"{ml_result.direction} {ml_result.confidence_pct}%{cal_tag}",
                f"{ml_result.direction} {ml_result.confidence_pct}%{cal_tag}",
            )
        else:
            ml_detail = (
                f"{ml_result.direction} {ml_result.confidence_pct}% — below 55% threshold",
                f"{ml_result.direction} {ml_result.confidence_pct}% — below 55% threshold",
            )
    except Exception as e:
        logger.debug(f"[{symbol}] Daily ML: {e}")

    # ── Signal 3: 15m intraday ML ─────────────────────────────────────────────
    try:
        if isinstance(df_15m, Exception) or isinstance(df_1d_short, Exception):
            raise ValueError("missing data")
        intra_ml = await asyncio.to_thread(
            intra_predictor.predict, symbol, df_15m, df_1d_short, asset_type
        )
        cal_tag  = " (calibrated)" if intra_ml.is_calibrated else ""
        if intra_ml.confidence_pct >= 55:
            intra_opinion = "BUY" if intra_ml.direction == "UP" else "SELL"
            intra_detail  = (
                f"{intra_ml.direction} {intra_ml.confidence_pct}%{cal_tag} (~1h horizon)",
                f"{intra_ml.direction} {intra_ml.confidence_pct}%{cal_tag} (~1h horizon)",
            )
        else:
            intra_detail = (
                f"{intra_ml.direction} {intra_ml.confidence_pct}% — below 55% threshold",
                f"{intra_ml.direction} {intra_ml.confidence_pct}% — below 55% threshold",
            )
    except Exception as e:
        logger.debug(f"[{symbol}] 15m ML: {e}")

    # ── Signal 4: News sentiment ───────────────────────────────────────────────
    try:
        if isinstance(news_result, Exception) or news_result is None:
            raise ValueError("no news data")
        score_str = f"score {news_result.score:+.2f}"
        if news_result.label == "POSITIVE":
            news_opinion = "BUY"
            news_detail  = (f"POSITIVE sentiment ({score_str})", f"POSITIVE sentiment ({score_str})")
        elif news_result.label == "NEGATIVE":
            news_opinion = "SELL"
            news_detail  = (f"NEGATIVE sentiment ({score_str})", f"NEGATIVE sentiment ({score_str})")
        else:
            news_detail  = (f"NEUTRAL sentiment ({score_str})", f"NEUTRAL sentiment ({score_str})")
    except Exception as e:
        logger.debug(f"[{symbol}] News: {e}")

    # ── Signal 12: Breakout + Momentum (stocks and crypto) ────────────────────
    # BUY  — price breaks above 20-day high with volume + MA confirmation
    # SELL — price breaks below 20-day low  with volume + MA confirmation
    breakout_opinion = None
    breakout_detail  = "unavailable"
    try:
        if isinstance(df_1d_long, Exception):
            raise df_1d_long
        _bdf   = df_1d_long.copy()
        _bdf.columns = [c.lower() for c in _bdf.columns]
        _close = _bdf["close"]
        lookback   = 20
        prev_high  = float(_close.iloc[-(lookback + 1):-1].max())
        prev_low   = float(_close.iloc[-(lookback + 1):-1].min())
        today_px   = float(_close.iloc[-1])
        ma20       = float(_close.rolling(lookback).mean().iloc[-1])
        slope_up   = today_px > ma20
        vcol       = "volume" if "volume" in _bdf.columns else None
        vol_conf, vol_str = True, ""
        if vcol:
            vol_ratio = float(_bdf[vcol].iloc[-1] / _bdf[vcol].rolling(20).mean().iloc[-1])
            vol_conf  = vol_ratio >= 1.2
            vol_str   = f", vol {vol_ratio:.1f}× avg"
        if today_px > prev_high:
            if vol_conf and slope_up:
                breakout_opinion = "BUY"
                breakout_detail  = f"Breakout above {lookback}d high ${prev_high:.2f}{vol_str} — momentum confirmed"
            elif not vol_conf:
                breakout_detail = f"Price above {lookback}d high ${prev_high:.2f} but low volume{vol_str} — unconfirmed"
            else:
                breakout_detail = f"Price above {lookback}d high but below 20d MA — weak breakout"
        elif today_px < prev_low:
            if vol_conf and not slope_up:
                breakout_opinion = "SELL"
                breakout_detail  = f"Breakdown below {lookback}d low ${prev_low:.2f}{vol_str} — momentum confirmed"
            elif not vol_conf:
                breakout_detail = f"Price below {lookback}d low ${prev_low:.2f} but low volume{vol_str} — unconfirmed"
            else:
                breakout_detail = f"Price below {lookback}d low but above 20d MA — weak breakdown"
        else:
            pct_to_high = (prev_high - today_px) / prev_high * 100
            breakout_detail = f"Within {lookback}d range (${prev_low:.2f}–${prev_high:.2f}), {pct_to_high:.1f}% from high"
    except Exception as e:
        logger.debug(f"[{symbol}] Breakout: {e}")

    # ── Signal 13: Mean Reversion / Z-Score (stocks and crypto) ──────────────
    # BUY  — Z ≤ −2.0: price deeply oversold relative to 20-day mean
    # SELL — Z ≥ +2.0: price overextended above 20-day mean
    zscore_opinion = None
    zscore_detail  = "unavailable"
    try:
        if isinstance(df_1d_long, Exception):
            raise df_1d_long
        _zdf   = df_1d_long.copy()
        _zdf.columns = [c.lower() for c in _zdf.columns]
        _close = _zdf["close"]
        _mean  = float(_close.rolling(20).mean().iloc[-1])
        _std   = float(_close.rolling(20).std().iloc[-1])
        if _std > 0:
            z = (float(_close.iloc[-1]) - _mean) / _std
            if z <= -2.0:
                zscore_opinion = "BUY"
                zscore_detail  = f"Z-Score {z:.2f} — {abs(z):.1f}σ below 20d mean (deeply oversold, reversion likely)"
            elif z >= 2.0:
                zscore_opinion = "SELL"
                zscore_detail  = f"Z-Score {z:.2f} — {z:.1f}σ above 20d mean (overextended, reversion likely)"
            elif z <= -1.0:
                zscore_detail = f"Z-Score {z:.2f} — mildly below 20d mean (−1σ to −2σ), watch for reversion"
            elif z >= 1.0:
                zscore_detail = f"Z-Score {z:.2f} — mildly above 20d mean (+1σ to +2σ), slightly extended"
            else:
                zscore_detail = f"Z-Score {z:.2f} — near 20d mean (within ±1σ), no reversion signal"
        else:
            zscore_detail = "Z-Score unavailable — insufficient price variation"
    except Exception as e:
        logger.debug(f"[{symbol}] Z-Score: {e}")

    # ── Signal 14: Fundamental Health (stocks only) ───────────────────────────
    # BUY  — health_score ≥ 5/6 (STRONG fundamentals)
    # SELL — health_score ≤ 2/6 (WEAK fundamentals)
    fund_opinion = None
    fund_detail  = "unavailable"
    if is_stock and fund_result is not None:
        try:
            fd = fund_result
            if fd.health_direction == "BUY":
                fund_opinion = "BUY"
                fund_detail  = (
                    f"Fundamentals STRONG ({fd.health_score}/6) — "
                    + ", ".join(k for k, v in fd.criteria.items() if v is True)
                )
            elif fd.health_direction == "SELL":
                fund_opinion = "SELL"
                fund_detail  = (
                    f"Fundamentals WEAK ({fd.health_score}/6) — "
                    + ", ".join(k for k, v in fd.criteria.items() if v is False)
                    + " not met"
                )
            else:
                fund_detail = (
                    f"Fundamentals MODERATE ({fd.health_score}/6) — "
                    "mixed signals, no directional conviction"
                )
        except Exception as e:
            logger.debug(f"[{symbol}] Fundamentals signal: {e}")

    # ── Determine direction from majority vote (signals 1–4 + 12–14) ─────────
    # Breakout, mean reversion and fundamental health participate in the vote.
    opinions   = [tech_opinion, ml_opinion, intra_opinion, news_opinion,
                  breakout_opinion, zscore_opinion, fund_opinion]
    votes_buy  = sum(1 for o in opinions if o == "BUY")
    votes_sell = sum(1 for o in opinions if o == "SELL")

    if votes_buy > votes_sell:
        direction = "BUY"
    elif votes_sell > votes_buy:
        direction = "SELL"
    else:
        direction = "NEUTRAL"

    # ── Signal 5: Volume ───────────────────────────────────────────────────────
    try:
        if isinstance(df_1d_long, Exception):
            raise df_1d_long
        vcol = "volume" if "volume" in df_1d_long.columns else "Volume"
        vol_ratio = float(
            df_1d_long[vcol].iloc[-1] / df_1d_long[vcol].rolling(20).mean().iloc[-1]
        )
        if vol_ratio >= 1.5:
            vol_passes = True
            vol_detail = f"{vol_ratio:.1f}× average — strong participation"
        else:
            vol_detail = f"{vol_ratio:.1f}× average — below 1.5× threshold"
    except Exception as e:
        logger.debug(f"[{symbol}] Volume: {e}")

    # ── Signals 6 & 7: Intraday signal + composite ────────────────────────────
    try:
        if isinstance(df_1h, Exception) or isinstance(df_1d_short, Exception):
            raise ValueError("missing data")
        intra_ctx = compute_intraday(
            df_1h, df_1d_short, symbol,
            daily_direction=ml_result.direction if ml_result else "UNKNOWN",
            daily_confidence=ml_result.confidence_pct if ml_result else 0.0,
            asset_type=asset_type,
        )
        intra_sig = intra_ctx.intraday_signal
        comp      = intra_ctx.composite_score

        # Signal 6
        if direction == "BUY" and intra_sig in ("GOOD_ENTRY", "STRONG_ENTRY"):
            sig6_passes = True
            sig6_detail = f"{intra_sig.replace('_', ' ').title()} — good timing"
        elif direction == "SELL" and intra_sig in ("TAKE_PROFITS", "WAIT_PULLBACK"):
            sig6_passes = True
            sig6_detail = f"{intra_sig.replace('_', ' ').title()} — confirms exit timing"
        else:
            sig6_detail = f"{intra_sig.replace('_', ' ').title()} — doesn't confirm direction"

        # Signal 7
        if direction == "BUY" and comp >= 2:
            sig7_passes = True
            sig7_detail = f"Composite +{comp}/6 — bullish intraday conditions"
        elif direction == "SELL" and comp <= -2:
            sig7_passes = True
            sig7_detail = f"Composite {comp}/6 — bearish intraday conditions"
        else:
            sig7_detail = f"Composite {comp:+d}/6 — weak intraday confirmation"
    except Exception as e:
        logger.debug(f"[{symbol}] Intraday: {e}")

    # ── Signals 8 & 9: Options flow (stocks only) ──────────────────────────────
    if is_stock and options_result is not None:
        try:
            pc = options_result.put_call_oi_ratio
            dist = options_result.max_pain_distance_pct

            # Signal 8 — Put/Call OI Ratio
            if pc < 0.7:
                options_opinion_8 = "BUY"
                options_detail_8  = f"P/C OI {pc:.2f} — calls dominate (bullish positioning)"
            elif pc > 1.3:
                options_opinion_8 = "SELL"
                options_detail_8  = f"P/C OI {pc:.2f} — puts dominate (hedging / bearish)"
            else:
                options_detail_8 = f"P/C OI {pc:.2f} — neutral (0.7–1.3 range)"

            # Signal 9 — Max Pain
            if dist > 0.5:
                options_opinion_9 = "BUY"
                options_detail_9  = f"Max pain ${options_result.max_pain_strike:.2f} ({dist:+.2f}%) — gravitational pull up"
            elif dist < -0.5:
                options_opinion_9 = "SELL"
                options_detail_9  = f"Max pain ${options_result.max_pain_strike:.2f} ({dist:+.2f}%) — gravitational pull down"
            else:
                options_detail_9 = (
                    f"Max pain ${options_result.max_pain_strike:.2f} ({dist:+.2f}%) — within ±0.5% of price"
                )

            # Signal 10 — IV Skew (put IV − call IV)
            # Negative skew (calls pricier) = unusual call demand = bullish
            # Positive skew (puts pricier)  = fear/hedging premium = bearish
            skew = options_result.iv_skew_pct
            if skew < -2.0:
                options_opinion_10 = "BUY"
                options_detail_10  = f"IV Skew {skew:+.1f}pp — calls pricier than puts (unusual call demand, bullish)"
            elif skew > 2.0:
                options_opinion_10 = "SELL"
                options_detail_10  = f"IV Skew {skew:+.1f}pp — puts pricier than calls (fear premium, bearish)"
            else:
                options_detail_10 = f"IV Skew {skew:+.1f}pp — balanced (within ±2pp)"

            # Signal 11 — Put/Call Volume Ratio (same-session fresh positioning)
            pcv = options_result.put_call_vol_ratio
            if pcv < 0.7:
                options_opinion_11 = "BUY"
                options_detail_11  = f"P/C Vol {pcv:.2f} — call volume dominant (bullish flow today)"
            elif pcv > 1.3:
                options_opinion_11 = "SELL"
                options_detail_11  = f"P/C Vol {pcv:.2f} — put volume dominant (bearish/hedging flow today)"
            else:
                options_detail_11 = f"P/C Vol {pcv:.2f} — neutral (0.7–1.3 range)"

        except Exception as e:
            logger.debug(f"[{symbol}] Options signals: {e}")

    # ── Score & assemble signals ───────────────────────────────────────────────
    def _sig(name: str, opinion, detail_tuple: tuple, direction: str) -> ConvictionSignal:
        """Score a directional signal: passed iff its opinion matches final direction."""
        if direction == "NEUTRAL":
            passed = False
        elif direction == "BUY":
            passed = (opinion == "BUY")
        else:
            passed = (opinion == "SELL")
        return ConvictionSignal(name, passed, detail_tuple[0])

    scored = [
        _sig("Technical",  tech_opinion,  tech_detail,  direction),
        _sig("Daily ML",   ml_opinion,    ml_detail,    direction),
        _sig("15m ML",     intra_opinion, intra_detail, direction),
        _sig("News",       news_opinion,  news_detail,  direction),
        ConvictionSignal("Volume",          vol_passes,  vol_detail),
        ConvictionSignal("Intraday Signal", sig6_passes, sig6_detail),
        ConvictionSignal("Intraday Score",  sig7_passes, sig7_detail),
    ]

    # Signals 8–11: options flow (stocks only)
    if is_stock:
        scored.append(_sig("Put/Call OI",    options_opinion_8,
                           (options_detail_8,  options_detail_8),  direction))
        scored.append(_sig("Max Pain",        options_opinion_9,
                           (options_detail_9,  options_detail_9),  direction))
        scored.append(_sig("IV Skew",         options_opinion_10,
                           (options_detail_10, options_detail_10), direction))
        scored.append(_sig("Put/Call Volume", options_opinion_11,
                           (options_detail_11, options_detail_11), direction))

    # Signals 12 & 13 — structural signals for both stocks and crypto
    scored.append(_sig("Breakout",       breakout_opinion,
                        (breakout_detail, breakout_detail), direction))
    scored.append(_sig("Mean Reversion", zscore_opinion,
                        (zscore_detail,   zscore_detail),   direction))

    # Signal 14 — fundamental health (stocks only)
    if is_stock:
        scored.append(_sig("Fundamentals", fund_opinion,
                           (fund_detail, fund_detail), direction))

    # ── Tier 2 signals (stocks only, require fund_result) ─────────────────────

    # Signal 15 — FCF Yield: >3% = attractive cash generation; <0% = burning cash
    fcf_opinion = None
    fcf_detail  = "unavailable"
    if is_stock and fund_result is not None:
        try:
            fy = fund_result.fcf_yield_pct
            if fy is not None:
                if fy > 3.0:
                    fcf_opinion = "BUY"
                    fcf_detail  = f"FCF Yield {fy:.1f}% — strong free cash generation (>3%)"
                elif fy < 0:
                    fcf_opinion = "SELL"
                    fcf_detail  = f"FCF Yield {fy:.1f}% — negative free cash flow (burning cash)"
                else:
                    fcf_detail  = f"FCF Yield {fy:.1f}% — neutral (0–3%, not a catalyst)"
            else:
                fcf_detail = "FCF Yield unavailable"
        except Exception as e:
            logger.debug(f"[{symbol}] FCF Yield signal: {e}")
        scored.append(_sig("FCF Yield", fcf_opinion, (fcf_detail, fcf_detail), direction))

    # Signal 16 — Debt/Equity: >2.0 = high leverage risk; <0.5 = conservative balance sheet
    de_opinion = None
    de_detail  = "unavailable"
    if is_stock and fund_result is not None:
        try:
            de = fund_result.debt_to_equity
            if de is not None:
                if de > 2.0:
                    de_opinion = "SELL"
                    de_detail  = f"D/E {de:.2f} — high leverage (>2×), elevated financial risk"
                elif de < 0.5:
                    de_opinion = "BUY"
                    de_detail  = f"D/E {de:.2f} — conservative balance sheet (<0.5×), low risk"
                else:
                    de_detail  = f"D/E {de:.2f} — manageable leverage (0.5×–2×)"
            else:
                de_detail = "Debt/Equity unavailable"
        except Exception as e:
            logger.debug(f"[{symbol}] D/E signal: {e}")
        scored.append(_sig("Debt/Equity", de_opinion, (de_detail, de_detail), direction))

    # Signal 17 — P/E Value: <15 = cheap vs market; >40 = expensive/speculative
    pe_opinion = None
    pe_detail  = "unavailable"
    if is_stock and fund_result is not None:
        try:
            pe = fund_result.pe_ratio
            if pe is not None and pe > 0:
                if pe < 15:
                    pe_opinion = "BUY"
                    pe_detail  = f"P/E {pe:.1f}× — below market average, value opportunity (<15×)"
                elif pe > 40:
                    pe_opinion = "SELL"
                    pe_detail  = f"P/E {pe:.1f}× — elevated valuation (>40×), priced for perfection"
                else:
                    pe_detail  = f"P/E {pe:.1f}× — in line with market (15×–40×)"
            else:
                pe_detail = f"P/E unavailable or negative (no earnings)"
        except Exception as e:
            logger.debug(f"[{symbol}] P/E signal: {e}")
        scored.append(_sig("P/E Valuation", pe_opinion, (pe_detail, pe_detail), direction))

    max_score = len(scored)   # 17 for stocks, 9 for crypto
    score     = 0 if direction == "NEUTRAL" else sum(1 for s in scored if s.passed)

    # Apply adaptive signal weights for label quality (score display stays as raw count)
    # Per-stock weights take priority over global weights (see signal_performance_service)
    from app.services.signal_performance_service import get_weight
    if direction != "NEUTRAL":
        w_score = sum(get_weight(s.name, symbol) for s in scored if s.passed)
        w_max   = sum(get_weight(s.name, symbol) for s in scored)
    else:
        w_score, w_max = 0.0, float(max_score)

    confidence_pct = round(w_score / w_max * 100, 1) if w_max > 0 else 0.0

    return ConvictionResult(
        symbol         = symbol.upper(),
        score          = score,
        max_score      = max_score,
        label          = _label(w_score, w_max, direction),
        direction      = direction,
        confidence_pct = confidence_pct,
        signals        = [{"name": s.name, "passed": s.passed, "detail": s.detail}
                          for s in scored],
    )
