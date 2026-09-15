"""
ML Predictor — Sprint 1 upgraded version.

Three models per symbol, stored in a single .pkl bundle:
  1. LGBMClassifier  — next-day direction (UP / DOWN)
  2. LGBMRegressor   — next-day magnitude (expected % move)
  3. Walk-forward    — rolling validation across 21-day windows

Sentiment is accepted at prediction time and used to adjust classifier
confidence (alignment bonus / misalignment penalty, ±12 pp max).
"""
import logging
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pandas_ta as ta
from lightgbm import LGBMClassifier, LGBMRegressor
from sklearn.metrics import accuracy_score, mean_absolute_error
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

from app.schemas.signals import PredictionResult
from app.services.market_context import (
    SECTOR_MAP, get_market_df as _get_market_df,
    get_earnings_dates, add_earnings_features, get_macro_features,
    get_fundamentals,
)

logger = logging.getLogger("ml_predictor")

MODELS_DIR = Path(__file__).parent.parent.parent / "models_store"
MODELS_DIR.mkdir(exist_ok=True)

# Bump when the training pipeline / bundle layout changes in a way that makes
# older bundles unusable or not comparable. needs_retrain() flags any bundle
# with a lower version for a one-time rebuild.
#   5 — XGB blend + separate 1D/1W feature sets + auto-prune + version stamp
BUNDLE_VERSION = 5

# A bundle file older than this is considered stale even if the schema matches —
# picked up by the manual "Refresh Models" job (and by predict() when it is
# allowed to train). Long enough that normal week-to-week use never trips it.
_MAX_BUNDLE_AGE_DAYS = 30

# Walk-forward params
WF_MIN_TRAIN_DAYS = 126   # 6 months minimum training window
WF_TEST_DAYS      = 10    # ~2 weeks per test window — more rounds, finer resolution


def _safe_symbol(symbol: str) -> str:
    return symbol.replace("/", "_").replace("\\", "_")


def _trim_to_last_complete_bar(df: pd.DataFrame, is_crypto: bool = False) -> pd.DataFrame:
    """
    Drop today's daily bar if it is still incomplete.

    Stocks : the bar is incomplete while the US market is open (09:30–16:00 ET).
             After close the bar is finalised — keep it.
    Crypto : the 24-h bar accumulates until midnight UTC; today's bar is never
             "done" until the day rolls over, so always use yesterday's bar.

    Falls back gracefully if timezone data is unavailable.
    """
    if df.empty or len(df) < 2:
        return df

    # Normalise last bar date to tz-naive UTC date for comparison
    last_ts = pd.Timestamp(df.index[-1])
    if last_ts.tzinfo is not None:
        last_ts = last_ts.tz_convert("UTC").tz_localize(None)
    last_date = last_ts.normalize()
    today_utc = pd.Timestamp.utcnow().normalize().tz_localize(None)

    if last_date < today_utc:
        return df  # last bar is already from a prior day — complete

    if is_crypto:
        # Crypto day bar accumulates all day; use yesterday's finished bar
        return df.iloc[:-1]

    # Stocks: drop today's bar only while the US market is open
    try:
        et_now       = pd.Timestamp.now(tz="America/New_York")
        market_open  = et_now.replace(hour=9,  minute=30, second=0, microsecond=0)
        market_close = et_now.replace(hour=16, minute=0,  second=0, microsecond=0)
        if et_now.weekday() < 5 and market_open <= et_now < market_close:
            return df.iloc[:-1]
    except Exception:
        pass  # timezone lookup failed; keep data as-is

    return df  # after close / pre-market / weekend — bar is complete


# ── Feature engineering ────────────────────────────────────────────────────────

FEATURE_COLS = [
    # Momentum oscillators
    "rsi_14",
    # MACD
    "macd_hist", "macd_signal",
    # Bollinger Bands
    "bb_pct", "bb_width",
    # Trend
    "ema_diff",          # (EMA20 - EMA50) / close  — normalized
    "ema_slope",         # EMA20 slope over last 5 bars
    # Multi-period returns
    "ret_1d", "ret_3d", "ret_5d", "ret_10d", "ret_20d",
    # Volume
    "volume_ratio",      # today / 20-day avg
    "volume_trend",      # 5-day avg / 20-day avg
    # Volatility
    "atr_pct",           # ATR / close
    "volatility_20d",    # 20-day rolling std of returns
    # Price position
    "dist_52w_high",     # % distance from 52-week high (bearish if high)
    "dist_52w_low",      # % distance from 52-week low  (bullish if low)
    # ── OHLC price action (candlestick features) ──────────────────────────
    "gap_open",          # overnight gap: (open - prev_close) / prev_close
    "close_position",    # where close settled in day's range (0=low, 1=high)
    "daily_range",       # intraday range: (high - low) / close
    "body_size",         # candlestick body: |close - open| / close
    "upper_shadow",      # rejection at highs: (high - max(o,c)) / close
    "lower_shadow",      # support at lows:   (min(o,c) - low)  / close
    # ── Market context (SPY / VIX / sector) ──────────────────────────────
    "spy_ret_1d",        # S&P 500 1-day return  — daily market momentum
    "spy_ret_5d",        # S&P 500 5-day return  — weekly market trend
    "spy_ret_20d",       # S&P 500 20-day return — monthly market regime
    "vix_level",         # VIX / 30 (normalised) — market fear / stress
    "vix_change_5d",     # VIX 5-day pct change  — rising vs calming fear
    "rs_vs_spy_5d",      # stock 5d ret  − SPY 5d ret  — relative strength
    "rs_vs_spy_20d",     # stock 20d ret − SPY 20d ret — relative strength
    "sector_ret_5d",     # sector ETF 5-day return    — sector momentum
    # ── Earnings proximity ─────────────────────────────────────────────────
    "days_to_next_earnings",  # calendar days to next earnings (capped 30)
    "days_since_earnings",    # calendar days since last earnings (capped 90)
    "earnings_in_5d",         # binary: earnings within next 5 days
    # ── Macro features ─────────────────────────────────────────────────────
    "yield_curve",            # 10Y − 13W Treasury spread
    "dxy_ret_5d",             # US Dollar Index 5-day return
    "credit_spread",          # HYG 5d ret − LQD 5d ret
    "vix_term_structure",     # VIX / VIX3M ratio
    # ── Regime one-hot ─────────────────────────────────────────────────────
    "regime_bull",            # SPY 20d ret > +3%
    "regime_bear",            # SPY 20d ret < -3%
    # ── Options-proxy volatility features ──────────────────────────────────
    "parkinson_vol_20d",      # high/low range vol — what options pricing actually uses
    "hv_ratio",               # vol_10d/vol_30d term structure proxy (>1 = near-term fear)
    "vol_regime",             # vol_5d/vol_20d vol expansion/contraction detector
    "realized_skewness_20d",  # 20-day return skewness (negative = put-skew analogue)
    # ── Fundamental features (quarterly, forward-filled) ───────────────────
    "eps_surprise_pct",       # (actual − estimate) / |estimate|, clipped ±2
    "revenue_growth_yoy",     # YoY quarterly revenue growth, clipped [−1, 5]
    # ── Sector relative strength (step 5) ──────────────────────────────────
    "sector_rs_5d",           # stock 5d return − sector ETF 5d return — stock-specific alpha
    # ── Market breadth proxy (step 5) ──────────────────────────────────────
    "mkt_breadth_5d",         # RSP 5d return − SPY 5d return — equal-weight vs cap-weight spread
    # ── Medium/long-term trend position (step 6) ───────────────────────────
    "sma_50_dist",            # (close − SMA50) / SMA50  — weekly trend filter
    "sma_200_dist",           # (close − SMA200) / SMA200 — golden/death cross indicator
]

# ── Horizon-specific feature subsets ──────────────────────────────────────────
# 1D: short-term momentum signals — overnight gaps, intraday patterns, 5-day returns
# 1W: trend + structural signals — 20-day returns, SMA distances, macro, fundamentals
# FEATURE_COLS above is the union superset used by _build_features() to build all columns.

FEATURE_COLS_1D = [
    "rsi_14", "macd_hist", "macd_signal", "bb_pct", "bb_width",
    "ema_diff", "ema_slope",
    "ret_1d", "ret_3d", "ret_5d",
    "volume_ratio", "volume_trend",
    "atr_pct",
    "gap_open", "close_position", "daily_range", "body_size",
    "upper_shadow", "lower_shadow",
    "spy_ret_1d", "spy_ret_5d",
    "vix_level", "vix_change_5d",
    "rs_vs_spy_5d",
    "sector_ret_5d", "sector_rs_5d",
    "earnings_in_5d",
    "regime_bull", "regime_bear",
    "parkinson_vol_20d", "hv_ratio", "vol_regime", "realized_skewness_20d",
    "mkt_breadth_5d",
    "vix_term_structure",
]

FEATURE_COLS_1W = [
    "rsi_14", "macd_hist", "macd_signal", "bb_pct", "bb_width",
    "ema_diff", "ema_slope",
    "ret_1d", "ret_3d", "ret_5d", "ret_10d", "ret_20d",
    "volume_ratio", "volume_trend",
    "atr_pct", "volatility_20d",
    "dist_52w_high", "dist_52w_low",
    "close_position", "daily_range", "body_size",
    "spy_ret_1d", "spy_ret_5d", "spy_ret_20d",
    "vix_level", "vix_change_5d",
    "rs_vs_spy_5d", "rs_vs_spy_20d",
    "sector_ret_5d", "sector_rs_5d",
    "earnings_in_5d", "days_to_next_earnings", "days_since_earnings",
    "yield_curve", "dxy_ret_5d", "credit_spread",
    "vix_term_structure",
    "regime_bull", "regime_bear",
    "parkinson_vol_20d", "hv_ratio", "vol_regime", "realized_skewness_20d",
    "eps_surprise_pct", "revenue_growth_yoy",
    "mkt_breadth_5d",
    "sma_50_dist", "sma_200_dist",
]


FEATURE_CATEGORIES: dict[str, str] = {
    "rsi_14": "momentum", "macd_hist": "momentum", "macd_signal": "momentum",
    "bb_pct": "momentum", "bb_width": "momentum",
    "ema_diff": "trend", "ema_slope": "trend",
    "sma_50_dist": "trend", "sma_200_dist": "trend",
    "ret_1d": "returns", "ret_3d": "returns", "ret_5d": "returns",
    "ret_10d": "returns", "ret_20d": "returns",
    "volume_ratio": "volume", "volume_trend": "volume",
    "atr_pct": "volatility", "volatility_20d": "volatility",
    "parkinson_vol_20d": "volatility", "hv_ratio": "volatility",
    "vol_regime": "volatility", "realized_skewness_20d": "volatility",
    "dist_52w_high": "price_pos", "dist_52w_low": "price_pos",
    "gap_open": "candlestick", "close_position": "candlestick",
    "daily_range": "candlestick", "body_size": "candlestick",
    "upper_shadow": "candlestick", "lower_shadow": "candlestick",
    "spy_ret_1d": "market", "spy_ret_5d": "market", "spy_ret_20d": "market",
    "vix_level": "market", "vix_change_5d": "market",
    "rs_vs_spy_5d": "market", "rs_vs_spy_20d": "market",
    "sector_ret_5d": "market", "sector_rs_5d": "market",
    "mkt_breadth_5d": "market", "vix_term_structure": "market",
    "regime_bull": "regime", "regime_bear": "regime",
    "earnings_in_5d": "earnings", "days_to_next_earnings": "earnings",
    "days_since_earnings": "earnings",
    "yield_curve": "macro", "dxy_ret_5d": "macro", "credit_spread": "macro",
    "eps_surprise_pct": "fundamentals", "revenue_growth_yoy": "fundamentals",
}

PRUNE_THRESHOLD_PCT = 1.0   # features below this % of total importance are pruned
MIN_FEATURES_AFTER_PRUNE = 10


def _importance_list(model: LGBMClassifier, feature_cols: list[str]) -> list[dict]:
    """Return sorted feature importances with category labels and percentage share."""
    raw   = model.feature_importances_.tolist()
    total = sum(raw) or 1
    return sorted(
        [
            {
                "name":           name,
                "importance":     int(imp),
                "importance_pct": round(imp / total * 100, 1),
                "category":       FEATURE_CATEGORIES.get(name, "other"),
                "pruned":         False,
            }
            for name, imp in zip(feature_cols, raw)
        ],
        key=lambda x: -x["importance"],
    )


def _prune_features(importances: list[dict], current_cols: list[str]) -> tuple[list[str], list[str]]:
    """Return (kept, pruned) feature name lists. Never prunes below MIN_FEATURES_AFTER_PRUNE."""
    above = [d["name"] for d in importances if d["importance_pct"] >= PRUNE_THRESHOLD_PCT]
    below = [d["name"] for d in importances if d["importance_pct"] < PRUNE_THRESHOLD_PCT]
    if len(above) < MIN_FEATURES_AFTER_PRUNE:
        return current_cols, []
    return above, below


def _build_features(df: pd.DataFrame, symbol: str = "", earnings_dates: list | None = None) -> pd.DataFrame:
    df = df.copy()
    df.columns = [c.lower() for c in df.columns]
    # Remove duplicate dates yfinance occasionally produces (causes reindex errors downstream)
    if df.index.duplicated().any():
        df = df[~df.index.duplicated(keep="last")]
    close = df["close"]

    # ── Momentum ──────────────────────────────────────────────────────────────
    df["rsi_14"] = ta.rsi(close, length=14)

    macd_df = ta.macd(close, fast=12, slow=26, signal=9)
    if macd_df is not None:
        h = [c for c in macd_df.columns if c.startswith("MACDh_")]
        s = [c for c in macd_df.columns if c.startswith("MACDs_")]
        df["macd_hist"]   = macd_df[h[0]] if h else 0.0
        df["macd_signal"] = macd_df[s[0]] if s else 0.0

    bb_df = ta.bbands(close, length=20, std=2.0)
    if bb_df is not None:
        p = [c for c in bb_df.columns if c.startswith("BBP_")]
        w = [c for c in bb_df.columns if c.startswith("BBB_")]
        df["bb_pct"]   = bb_df[p[0]] if p else 0.5
        df["bb_width"] = bb_df[w[0]] if w else 0.0

    # ── Trend ─────────────────────────────────────────────────────────────────
    ema20 = ta.ema(close, length=20)
    ema50 = ta.ema(close, length=50)
    df["ema_diff"]  = (ema20 - ema50) / close
    df["ema_slope"] = ema20.diff(5) / (ema20.shift(5) + 1e-9)   # 5-bar slope

    # ── Returns ───────────────────────────────────────────────────────────────
    df["ret_1d"]  = close.pct_change(1)
    df["ret_3d"]  = close.pct_change(3)
    df["ret_5d"]  = close.pct_change(5)
    df["ret_10d"] = close.pct_change(10)
    df["ret_20d"] = close.pct_change(20)

    # ── Volume ────────────────────────────────────────────────────────────────
    vol_ma20 = df["volume"].rolling(20).mean()
    vol_ma5  = df["volume"].rolling(5).mean()
    df["volume_ratio"] = df["volume"] / (vol_ma20 + 1e-9)
    df["volume_trend"] = vol_ma5 / (vol_ma20 + 1e-9)

    # ── Volatility ────────────────────────────────────────────────────────────
    df["atr_pct"]       = ta.atr(df["high"], df["low"], close, length=14) / close
    df["volatility_20d"] = df["ret_1d"].rolling(20).std()

    # ── Options-proxy volatility features ─────────────────────────────────────
    # These capture what options pricing reflects, using data we already have.
    log_hl = np.log((df["high"] / df["low"].clip(lower=1e-9)).clip(lower=1e-9))
    df["parkinson_vol_20d"] = (
        np.sqrt((log_hl ** 2).rolling(20).mean() / (4 * np.log(2))) * np.sqrt(252)
    ).fillna(0)

    returns = close.pct_change()
    vol_5d  = returns.rolling(5).std()
    vol_10d = returns.rolling(10).std()
    vol_20d = returns.rolling(20).std()
    vol_30d = returns.rolling(30).std()

    df["hv_ratio"]              = (vol_10d / vol_30d.clip(lower=1e-9)).clip(0, 5).fillna(1.0)
    df["vol_regime"]            = (vol_5d  / vol_20d.clip(lower=1e-9)).clip(0, 5).fillna(1.0)
    df["realized_skewness_20d"] = returns.rolling(20).skew().fillna(0)

    # ── Price position ────────────────────────────────────────────────────────
    high_52w = close.rolling(252, min_periods=50).max()
    low_52w  = close.rolling(252, min_periods=50).min()
    df["dist_52w_high"] = (high_52w - close) / (high_52w + 1e-9)
    df["dist_52w_low"]  = (close - low_52w)  / (low_52w  + 1e-9)

    # ── OHLC candlestick features (use open, high, low directly) ──────────────
    open_  = df["open"]
    high_  = df["high"]
    low_   = df["low"]
    hl     = (high_ - low_).clip(lower=1e-9)   # intraday range, avoid div/0

    # Overnight gap — shows what happened while market was closed
    df["gap_open"]      = (open_ - close.shift(1)) / (close.shift(1) + 1e-9)

    # Where close settled in the day's range (0 = at low, 1 = at high)
    df["close_position"] = (close - low_) / hl

    # Intraday range as % of price — measures daily volatility / conviction
    df["daily_range"]   = hl / close

    # Candlestick body — large body = strong conviction, tiny = indecision/doji
    df["body_size"]     = (close - open_).abs() / close

    # Upper shadow — price ran up but got rejected (selling pressure)
    df["upper_shadow"]  = (high_ - pd.concat([close, open_], axis=1).max(axis=1)) / close

    # Lower shadow — price dipped but bounced back (buying support)
    df["lower_shadow"]  = (pd.concat([close, open_], axis=1).min(axis=1) - low_) / close

    # ── Market context (SPY / VIX / sector ETF) ───────────────────────────────
    # Normalise the stock's DatetimeIndex to tz-naive dates so we can reindex
    # against the yfinance-fetched market DataFrames (which are also tz-naive).
    raw_idx = pd.to_datetime(df.index)
    if raw_idx.tz is not None:
        stock_dates = raw_idx.tz_convert("UTC").tz_localize(None).normalize()
    else:
        stock_dates = raw_idx.normalize()

    # Timezone conversion can map two different tz-aware timestamps to the same
    # calendar date (e.g. midnight + 4 PM ET both normalize to the same UTC day).
    # Dedup AFTER normalization and keep df aligned, otherwise reindex raises
    # "cannot reindex on an axis with duplicate labels".
    if stock_dates.duplicated().any():
        keep_mask = ~stock_dates.duplicated(keep="last")  # numpy bool array
        stock_dates = stock_dates[keep_mask]
        df = df.iloc[keep_mask]

    spy_df = _get_market_df("SPY")
    if not spy_df.empty:
        spy_close = spy_df["close"].reindex(stock_dates, method="ffill")
        spy_1d  = spy_close.pct_change(1)
        spy_5d  = spy_close.pct_change(5)
        spy_20d = spy_close.pct_change(20)
        df["spy_ret_1d"]  = spy_1d.values
        df["spy_ret_5d"]  = spy_5d.values
        df["spy_ret_20d"] = spy_20d.values
        df["rs_vs_spy_5d"]  = close.pct_change(5)  - spy_5d.values
        df["rs_vs_spy_20d"] = close.pct_change(20) - spy_20d.values
    else:
        for col in ("spy_ret_1d", "spy_ret_5d", "spy_ret_20d",
                    "rs_vs_spy_5d", "rs_vs_spy_20d"):
            df[col] = 0.0

    vix_df = _get_market_df("^VIX")
    if not vix_df.empty:
        vix_close = vix_df["close"].reindex(stock_dates, method="ffill")
        df["vix_level"]     = (vix_close / 30.0).values   # normalise: 1.0 = crisis level
        df["vix_change_5d"] = vix_close.pct_change(5).values
    else:
        df["vix_level"]     = 0.0
        df["vix_change_5d"] = 0.0

    sector_ticker = SECTOR_MAP.get(symbol.upper(), "")
    if sector_ticker and sector_ticker != "SPY":
        sect_df = _get_market_df(sector_ticker)
    elif not spy_df.empty:
        sect_df = spy_df   # reuse already-fetched SPY — no extra download
    else:
        sect_df = pd.DataFrame()

    if not sect_df.empty:
        sect_close = sect_df["close"].reindex(stock_dates, method="ffill")
        df["sector_ret_5d"] = sect_close.pct_change(5).values
        # Sector relative strength: stock outperforming/underperforming its own sector
        stock_ret_5d = close.pct_change(5)
        df["sector_rs_5d"] = (stock_ret_5d.values - sect_close.pct_change(5).values)
    else:
        df["sector_ret_5d"] = 0.0
        df["sector_rs_5d"]  = 0.0

    # ── Market breadth: RSP vs SPY (equal-weight vs cap-weight spread) ────────
    # When RSP > SPY: broader participation — healthy advance
    # When RSP < SPY: mega-cap driven — narrow, weaker breadth
    rsp_df = _get_market_df("RSP")
    if not rsp_df.empty and not spy_df.empty:
        rsp_close = rsp_df["close"].reindex(stock_dates, method="ffill")
        spy_5d_arr = (spy_df["close"].reindex(stock_dates, method="ffill")
                      .pct_change(5).values)
        df["mkt_breadth_5d"] = rsp_close.pct_change(5).values - spy_5d_arr
    else:
        df["mkt_breadth_5d"] = 0.0

    # ── Medium/long-term trend position (better signal for 1w/1m models) ─────
    sma50  = close.rolling(50,  min_periods=30).mean()
    sma200 = close.rolling(200, min_periods=100).mean()
    df["sma_50_dist"]  = ((close - sma50)  / (sma50  + 1e-9)).fillna(0.0)
    df["sma_200_dist"] = ((close - sma200) / (sma200 + 1e-9)).fillna(0.0)

    # ── Macro features ────────────────────────────────────────────────────────
    macro = get_macro_features(stock_dates)
    for col, arr in macro.items():
        df[col] = arr

    # ── Regime one-hot (derived from SPY 20d return, already computed) ────────
    spy20 = pd.Series(df["spy_ret_20d"].values)
    df["regime_bull"] = (spy20 > 0.03).astype(float).values
    df["regime_bear"] = (spy20 < -0.03).astype(float).values

    # ── Fundamental features (quarterly, forward-filled) ──────────────────────
    fundamentals = get_fundamentals(symbol, stock_dates)
    for col, arr in fundamentals.items():
        df[col] = arr

    # ── Earnings proximity ────────────────────────────────────────────────────
    add_earnings_features(df, earnings_dates or [], stock_dates)

    # ── Earnings blackout column (NOT a training feature; used to filter rows) ──
    if earnings_dates:
        earn_set = sorted(set(earnings_dates))
        blackout = np.zeros(len(stock_dates), dtype=float)
        for i, ts in enumerate(stock_dates):
            dt = pd.Timestamp(ts).normalize().date()
            future_e = [e for e in earn_set if e >= dt]
            past_e   = [e for e in earn_set if e < dt]
            in_next5 = bool(future_e and (future_e[0] - dt).days <= 5)
            in_past2 = bool(past_e and (dt - past_e[-1]).days <= 2)
            blackout[i] = 1.0 if (in_next5 or in_past2) else 0.0
        df["in_earnings_blackout"] = blackout
    else:
        df["in_earnings_blackout"] = 0.0

    # ── Targets ───────────────────────────────────────────────────────────────
    # Filter near-zero-move days (< 0.5%) from 1d target — noise that the model
    # cannot reliably learn from.
    future_1d  = close.shift(-1)
    future_1w  = close.shift(-5)
    future_1m  = close.shift(-21)
    move_pct_1d = (future_1d - close) / (close + 1e-9) * 100
    df["target_dir"] = (
        (future_1d > close)
        .where(future_1d.notna() & (move_pct_1d.abs() >= 0.5))
        .astype(float)
    )
    df["target_mag"] = ((future_1d - close) / close * 100).clip(-10, 10)  # NaN propagates
    move_pct_1w = (future_1w - close) / (close + 1e-9) * 100
    df["target_1w"] = (
        (future_1w > close)
        .where(future_1w.notna() & (move_pct_1w.abs() >= 0.5))
        .astype(float)
    )
    df["target_1m"]  = (future_1m  > close).where(future_1m.notna()).astype(float)

    available = [c for c in FEATURE_COLS if c in df.columns]
    out_cols  = available + ["target_dir", "target_mag", "target_1w", "target_1m",
                              "close", "in_earnings_blackout"]
    # Drop warmup rows (NaN indicators / 1d targets). Trailing rows where only
    # multi-horizon targets are NaN are kept — filtered per-horizon in train/predict.
    # NOTE: blackout rows are NOT filtered here — callers handle that.
    # train() excludes them from training; predict() reads the flag from the live bar.
    return df[out_cols].dropna(subset=available + ["target_dir", "target_mag"])


# ── Per-round WF diagnostic ────────────────────────────────────────────────────

def _make_diagnostic(window: pd.DataFrame, accuracy: float) -> str:
    """
    Generate a human-readable diagnostic string for one WF test window.
    Describes what regime/events occurred and why accuracy was high or low.
    """
    lines: list[str] = []

    # ── Regime ───────────────────────────────────────────────────────────────
    regime_parts: list[str] = []
    if "rsi_14" in window.columns:
        rsi = window["rsi_14"].dropna()
        if len(rsi) >= 2:
            regime_parts.append(f"RSI {rsi.min():.0f}→{rsi.max():.0f}")
    if "volume_ratio" in window.columns:
        vol = float(window["volume_ratio"].mean())
        if not np.isnan(vol):
            regime_parts.append(f"Vol {vol:.1f}×")
    if regime_parts:
        lines.append("Regime:  " + " · ".join(regime_parts))

    # ── Market ────────────────────────────────────────────────────────────────
    market_parts: list[str] = []
    spy_cum = 0.0
    if "spy_ret_1d" in window.columns:
        spy_cum = float((1 + window["spy_ret_1d"].fillna(0)).prod() - 1)
        if abs(spy_cum) > 0.005:
            word = "rally" if spy_cum > 0 else "selloff"
            market_parts.append(f"SPY {spy_cum * 100:+.1f}% ({word})")
    if "vix_level" in window.columns:
        vix = float(window["vix_level"].mean()) * 30
        if not np.isnan(vix) and vix > 25:
            market_parts.append(f"VIX {vix:.0f}")
    if market_parts:
        lines.append("Market:  " + " · ".join(market_parts))

    # ── Events ───────────────────────────────────────────────────────────────
    has_earnings = (
        "earnings_in_5d" in window.columns
        and float(window["earnings_in_5d"].max()) > 0
    )
    if has_earnings:
        lines.append("Event:   ⚠ Earnings week")

    # ── Conclusion ────────────────────────────────────────────────────────────
    if accuracy >= 0.55:
        conclusion = "Model performed well in this period."
    elif accuracy >= 0.50:
        conclusion = "Near coin-flip — borderline regime."
    else:
        if has_earnings:
            conclusion = "Earnings uncertainty made technicals unreliable."
        elif spy_cum < -0.015:
            conclusion = "Macro selloff — broad market overwhelmed stock signals."
        elif spy_cum > 0.015:
            conclusion = "Strong rally — mean-reversion signals backfired."
        else:
            conclusion = "Model failed — possible regime shift or choppy action."
    lines.append(f"→ {conclusion}")

    return "\n".join(lines)


# ── XGBoost helper ────────────────────────────────────────────────────────────

def _make_xgb_classifier(n_estimators: int = 300) -> XGBClassifier:
    return XGBClassifier(
        n_estimators=n_estimators, learning_rate=0.03,
        max_depth=6, subsample=0.8, colsample_bytree=0.8,
        eval_metric="logloss", random_state=42, verbosity=0,
    )


# ── Walk-forward validation ────────────────────────────────────────────────────

def _walk_forward(
    feat_df: pd.DataFrame,
    feature_cols: list[str],
    target_col: str = "target_dir",
    min_train: int  = WF_MIN_TRAIN_DAYS,
    test_days: int  = WF_TEST_DAYS,
) -> dict:
    """
    Rolling walk-forward over test_days-day test windows.
    target_col selects which label to use (target_dir / target_1w / target_1m).
    Returns per-round accuracy list, date labels, diagnostics, and calibrator.
    """
    # Drop rows where the chosen target is NaN (e.g. last 5 rows for target_1w)
    valid = feat_df.dropna(subset=[target_col])
    X_all = valid[feature_cols].values
    y_raw = valid[target_col].values.astype(int)
    # Guard: yfinance MultiIndex bugs can produce a 2-column DataFrame for a single column,
    # making y_raw shape (n, 2) instead of (n,). Take column 0 and warn.
    if y_raw.ndim != 1:
        logger.warning(
            f"_walk_forward: '{target_col}' produced {y_raw.ndim}D array "
            f"shape {y_raw.shape} — possible duplicate column in feat_df. "
            f"feat_df columns: {list(feat_df.columns)}"
        )
        y_raw = y_raw[:, 0]
    y_all = y_raw
    n     = len(X_all)
    idx   = valid.index

    # Indices of regime columns in the unscaled feature matrix (0/1 flags)
    bull_idx = feature_cols.index("regime_bull") if "regime_bull" in feature_cols else None
    bear_idx = feature_cols.index("regime_bear") if "regime_bear" in feature_cols else None

    accuracies:  list[float]      = []
    dates:       list[list[str]]  = []
    diagnostics: list[str]        = []
    all_probas:  list[float]      = []
    all_actuals: list[int]        = []
    all_regimes: list[str]        = []   # "bull" | "bear" | "neutral" per held-out row
    start = min_train

    while start + test_days <= n:
        X_tr, y_tr = X_all[:start], y_all[:start]
        X_te, y_te = X_all[start:start + test_days], y_all[start:start + test_days]

        sc = StandardScaler()
        X_tr_sc = sc.fit_transform(X_tr)
        X_te_sc = sc.transform(X_te)

        # Recency weights: oldest bar = 0.5, newest bar = 1.0
        wts = np.linspace(0.5, 1.0, len(X_tr))

        # Wrap scaled arrays in DataFrames so LGBM retains feature names (suppresses warning)
        X_tr_df = pd.DataFrame(X_tr_sc, columns=feature_cols)
        X_te_df = pd.DataFrame(X_te_sc, columns=feature_cols)

        # Ensemble: blend LGBM + XGBoost 50/50 for diversity
        # class_weight='balanced' corrects the UP bias from bull-dominated training data
        lgbm_wf = LGBMClassifier(n_estimators=100, learning_rate=0.1,
                                  max_depth=5, class_weight="balanced",
                                  random_state=42, verbose=-1)
        lgbm_wf.fit(X_tr_df, y_tr, sample_weight=wts)

        xgb_wf = XGBClassifier(n_estimators=100, learning_rate=0.1, max_depth=5,
                                eval_metric="logloss", random_state=42, verbosity=0)
        xgb_wf.fit(X_tr_sc, y_tr, sample_weight=wts)

        blended = (lgbm_wf.predict_proba(X_te_df)[:, 1] +
                   xgb_wf.predict_proba(X_te_sc)[:, 1]) / 2.0
        acc = float(accuracy_score(y_te, (blended >= 0.5).astype(int)))
        accuracies.append(acc)

        # Collect blended P(UP) probabilities for calibration
        all_probas.extend(blended.tolist())
        all_actuals.extend(y_te.tolist())

        # Track regime for each held-out test row (using unscaled X_te)
        for j in range(len(blended)):
            if bull_idx is not None and bear_idx is not None:
                r = ("bull" if X_te[j, bull_idx] > 0.5
                     else "bear" if X_te[j, bear_idx] > 0.5
                     else "neutral")
            else:
                r = "neutral"
            all_regimes.append(r)

        # Actual date range of this test window
        ts_start = pd.Timestamp(idx[start])
        ts_end   = pd.Timestamp(idx[min(start + test_days - 1, n - 1)])
        dates.append([
            f"{ts_start.strftime('%b')} {ts_start.day}",
            f"{ts_end.strftime('%b')} {ts_end.day}",
        ])

        # Per-round diagnostic from feature values in the test window
        window = valid.iloc[start:start + test_days]
        diagnostics.append(_make_diagnostic(window, acc))

        start += test_days

    # ── Calibrators: one global + one per regime ─────────────────────────────
    # Global calibrator: fitted on all held-out WF predictions (fallback)
    # Regime calibrators: fitted on regime-filtered subsets — learns that
    #   the model's UP confidence is systematically wrong in bear markets.
    # Minimum 15 points per bucket to fit reliably.
    from sklearn.isotonic import IsotonicRegression

    calibrator = None
    if len(all_probas) >= 30:
        calibrator = IsotonicRegression(out_of_bounds="clip").fit(all_probas, all_actuals)

    cal_regime: dict[str, object] = {}
    for regime_name in ("bull", "bear", "neutral"):
        mask = [r == regime_name for r in all_regimes]
        r_p  = [p for p, m in zip(all_probas,  mask) if m]
        r_a  = [a for a, m in zip(all_actuals, mask) if m]
        if len(r_p) >= 15:
            cal_regime[regime_name] = IsotonicRegression(out_of_bounds="clip").fit(r_p, r_a)
            logger.debug(
                f"Regime calibrator '{regime_name}': {len(r_p)} samples, "
                f"mean_prob={np.mean(r_p):.2f}, mean_actual={np.mean(r_a):.2f}"
            )

    if not accuracies:
        return {"wf_accuracy": 0.0, "wf_accuracy_std": 0.0,
                "wf_rounds": 0, "wf_accuracy_history": [],
                "wf_dates": [], "wf_diagnostics": [],
                "calibrator": calibrator,
                "calibrator_bull":    cal_regime.get("bull"),
                "calibrator_bear":    cal_regime.get("bear"),
                "calibrator_neutral": cal_regime.get("neutral")}

    arr = np.array(accuracies)
    return {
        "wf_accuracy":         round(float(arr.mean()), 4),
        "wf_accuracy_std":     round(float(arr.std()),  4),
        "wf_rounds":           len(accuracies),
        "wf_accuracy_history": [round(a, 4) for a in accuracies],
        "wf_dates":            dates,
        "wf_diagnostics":      diagnostics,
        "calibrator":          calibrator,
        "calibrator_bull":     cal_regime.get("bull"),
        "calibrator_bear":     cal_regime.get("bear"),
        "calibrator_neutral":  cal_regime.get("neutral"),
    }


# ── Main predictor class ───────────────────────────────────────────────────────

class MLPredictor:

    def train(self, symbol: str, df: pd.DataFrame, training_period: str = "3y") -> dict:
        earnings_dates = get_earnings_dates(symbol)
        feat_df_all = _build_features(df, symbol, earnings_dates)

        # Filter earnings blackout rows from TRAINING data only.
        # _build_features keeps all rows so predict() can still read the live bar's flag.
        feat_df = feat_df_all[feat_df_all["in_earnings_blackout"] == 0.0]

        # Horizon-specific feature columns (only those available in this dataset)
        feature_cols_1d = [c for c in FEATURE_COLS_1D if c in feat_df.columns]
        feature_cols_1w = [c for c in FEATURE_COLS_1W if c in feat_df.columns]

        if len(feat_df) < 100:
            raise ValueError(
                f"Insufficient data for {symbol}: {len(feat_df)} rows after blackout filter "
                f"(period '{training_period}' too short — try 1y or longer)"
            )

        # Use rows where 1-day targets are confirmed (target_dir is NaN for last row)
        feat_1d = feat_df.dropna(subset=["target_dir", "target_mag"])
        X     = feat_1d[feature_cols_1d].values
        y_raw = feat_1d["target_dir"].values.astype(int)
        if y_raw.ndim != 1:
            logger.warning(
                f"[{symbol}] train: target_dir is {y_raw.ndim}D shape {y_raw.shape} "
                f"— duplicate column in feat_df (yfinance MultiIndex bug). "
                f"feat_df columns: {list(feat_1d.columns)}"
            )
            y_raw = y_raw[:, 0]
        y_dir = y_raw
        y_mag = feat_1d["target_mag"].values

        # ── Direction ensemble (LGBM + XGBoost, 1D horizon) ──────────────────
        split = int(len(X) * 0.8)
        scaler_1d = StandardScaler()
        X_tr_sc = scaler_1d.fit_transform(X[:split])
        X_te_sc = scaler_1d.transform(X[split:])

        # Recency weights: oldest bar = 0.5, newest bar = 1.0
        train_weights = np.linspace(0.5, 1.0, split)

        classifier_lgbm = LGBMClassifier(
            n_estimators=300, learning_rate=0.03,
            max_depth=6, num_leaves=31,
            min_child_samples=20,
            subsample=0.8, colsample_bytree=0.8,
            class_weight="balanced",
            random_state=42, verbose=-1,
        )
        # Wrap scaled arrays in DataFrames so LGBM retains feature names (suppresses warning)
        X_tr_df = pd.DataFrame(X_tr_sc, columns=feature_cols_1d)
        X_te_df = pd.DataFrame(X_te_sc, columns=feature_cols_1d)

        classifier_lgbm.fit(X_tr_df, y_dir[:split], sample_weight=train_weights)

        classifier_xgb = _make_xgb_classifier()
        classifier_xgb.fit(X_tr_sc, y_dir[:split], sample_weight=train_weights)

        blended_te = (classifier_lgbm.predict_proba(X_te_df)[:, 1] +
                      classifier_xgb.predict_proba(X_te_sc)[:, 1]) / 2.0
        static_accuracy = float(accuracy_score(y_dir[split:], (blended_te >= 0.5).astype(int)))

        # ── Magnitude regressor (1D features — predicts next-day magnitude) ───
        regressor = LGBMRegressor(
            n_estimators=300, learning_rate=0.03,
            max_depth=5, num_leaves=25,
            min_child_samples=20,
            subsample=0.8, colsample_bytree=0.8,
            random_state=42, verbose=-1,
        )
        regressor.fit(X_tr_df, y_mag[:split], sample_weight=train_weights)
        mag_mae = float(mean_absolute_error(y_mag[split:], regressor.predict(X_te_df)))

        # ── Walk-forward validation (1-day) ──────────────────────────────────
        logger.info(f"[{symbol}] Running walk-forward validation…")
        wf = _walk_forward(feat_df, feature_cols_1d)
        logger.info(f"[{symbol}] WF accuracy: {wf['wf_accuracy']:.1%} "
                    f"± {wf['wf_accuracy_std']:.1%} over {wf['wf_rounds']} rounds")

        # ── 1D: feature importance + auto-prune low-signal features ──────────
        importances_1d = _importance_list(classifier_lgbm, feature_cols_1d)
        kept_1d, pruned_1d = _prune_features(importances_1d, feature_cols_1d)
        if pruned_1d:
            logger.info(f"[{symbol}] 1D: pruning {len(pruned_1d)} low-signal features → retrain")
            feature_cols_1d = kept_1d
            _X = feat_1d[feature_cols_1d].values
            scaler_1d = StandardScaler()
            _Xtr = scaler_1d.fit_transform(_X[:split])
            _Xte = scaler_1d.transform(_X[split:])
            _Xtr_df = pd.DataFrame(_Xtr, columns=feature_cols_1d)
            _Xte_df = pd.DataFrame(_Xte, columns=feature_cols_1d)
            classifier_lgbm = LGBMClassifier(
                n_estimators=300, learning_rate=0.03, max_depth=6, num_leaves=31,
                min_child_samples=20, subsample=0.8, colsample_bytree=0.8,
                class_weight="balanced", random_state=42, verbose=-1,
            )
            classifier_lgbm.fit(_Xtr_df, y_dir[:split], sample_weight=train_weights)
            classifier_xgb = _make_xgb_classifier()
            classifier_xgb.fit(_Xtr, y_dir[:split], sample_weight=train_weights)
            _bt = (classifier_lgbm.predict_proba(_Xte_df)[:, 1] +
                   classifier_xgb.predict_proba(_Xte)[:, 1]) / 2.0
            static_accuracy = float(accuracy_score(y_dir[split:], (_bt >= 0.5).astype(int)))
            regressor = LGBMRegressor(
                n_estimators=300, learning_rate=0.03, max_depth=5, num_leaves=25,
                min_child_samples=20, subsample=0.8, colsample_bytree=0.8,
                random_state=42, verbose=-1,
            )
            regressor.fit(_Xtr_df, y_mag[:split], sample_weight=train_weights)
            mag_mae = float(mean_absolute_error(y_mag[split:], regressor.predict(_Xte_df)))
            importances_1d = _importance_list(classifier_lgbm, feature_cols_1d)

        # ── Multi-horizon ensemble classifiers (1-week & 1-month) ────────────
        multi: dict = {}
        scaler_1w: StandardScaler | None = None  # populated when 1w trains successfully

        for hz_days, hz_name in [(5, "1w"), (21, "1m")]:
            tcol   = f"target_{hz_name}"
            feat_h = feat_df.dropna(subset=[tcol])
            if len(feat_h) < WF_MIN_TRAIN_DAYS + hz_days + 20:
                logger.warning(
                    f"[{symbol}] Skipping {hz_name} horizon (only {len(feat_h)} rows)"
                )
                continue

            # 1W uses its own feature set and scaler; 1M shares 1D features
            hz_fcols = feature_cols_1w if hz_name == "1w" else feature_cols_1d
            X_h   = feat_h[hz_fcols].values
            y_h   = feat_h[tcol].values.astype(int)
            if y_h.ndim != 1:
                y_h = y_h[:, 0]
            sp_h  = int(len(X_h) * 0.8)
            wts_h = np.linspace(0.5, 1.0, sp_h)

            hz_scaler = StandardScaler()
            X_h_tr_sc = hz_scaler.fit_transform(X_h[:sp_h])
            X_h_te_sc = hz_scaler.transform(X_h[sp_h:])
            X_h_tr_df = pd.DataFrame(X_h_tr_sc, columns=hz_fcols)
            X_h_te_df = pd.DataFrame(X_h_te_sc, columns=hz_fcols)

            clf_lgbm_h = LGBMClassifier(
                n_estimators=300, learning_rate=0.03,
                max_depth=6, num_leaves=31, min_child_samples=20,
                subsample=0.8, colsample_bytree=0.8,
                class_weight="balanced",
                random_state=42, verbose=-1,
            )
            clf_lgbm_h.fit(X_h_tr_df, y_h[:sp_h], sample_weight=wts_h)

            clf_xgb_h = _make_xgb_classifier()
            clf_xgb_h.fit(X_h_tr_sc, y_h[:sp_h], sample_weight=wts_h)

            blended_h_te = (clf_lgbm_h.predict_proba(X_h_te_df)[:, 1] +
                            clf_xgb_h.predict_proba(X_h_te_sc)[:, 1]) / 2.0
            sa_h = float(accuracy_score(y_h[sp_h:], (blended_h_te >= 0.5).astype(int)))

            logger.info(f"[{symbol}] Running {hz_name} walk-forward…")
            wf_h = _walk_forward(feat_h, hz_fcols, target_col=tcol, test_days=hz_days)
            logger.info(
                f"[{symbol}] {hz_name} WF: {wf_h['wf_accuracy']:.1%} over {wf_h['wf_rounds']} rounds"
            )
            # Importances + auto-prune (1W only — 1M is secondary, skip prune)
            imp_h = _importance_list(clf_lgbm_h, hz_fcols)
            pruned_h: list[str] = []
            if hz_name == "1w":
                kept_h, pruned_h = _prune_features(imp_h, hz_fcols)
                if pruned_h:
                    logger.info(f"[{symbol}] 1W: pruning {len(pruned_h)} features → retrain")
                    hz_fcols = kept_h
                    feature_cols_1w = kept_h
                    _Xh = feat_h[hz_fcols].values
                    hz_scaler = StandardScaler()
                    _Xhtr = hz_scaler.fit_transform(_Xh[:sp_h])
                    _Xhte = hz_scaler.transform(_Xh[sp_h:])
                    _Xhtr_df = pd.DataFrame(_Xhtr, columns=hz_fcols)
                    _Xhte_df = pd.DataFrame(_Xhte, columns=hz_fcols)
                    clf_lgbm_h = LGBMClassifier(
                        n_estimators=300, learning_rate=0.03, max_depth=6, num_leaves=31,
                        min_child_samples=20, subsample=0.8, colsample_bytree=0.8,
                        class_weight="balanced", random_state=42, verbose=-1,
                    )
                    clf_lgbm_h.fit(_Xhtr_df, y_h[:sp_h], sample_weight=wts_h)
                    clf_xgb_h = _make_xgb_classifier()
                    clf_xgb_h.fit(_Xhtr, y_h[:sp_h], sample_weight=wts_h)
                    _bh = (clf_lgbm_h.predict_proba(_Xhte_df)[:, 1] +
                           clf_xgb_h.predict_proba(_Xhte)[:, 1]) / 2.0
                    sa_h = float(accuracy_score(y_h[sp_h:], (_bh >= 0.5).astype(int)))
                    imp_h = _importance_list(clf_lgbm_h, hz_fcols)

            if hz_name == "1w":
                scaler_1w = hz_scaler
            multi[f"classifier_lgbm_{hz_name}"]     = clf_lgbm_h
            multi[f"classifier_xgb_{hz_name}"]      = clf_xgb_h
            multi[f"features_{hz_name}"]             = hz_fcols
            multi[f"scaler_{hz_name}"]               = hz_scaler
            multi[f"importances_{hz_name}"]          = imp_h
            multi[f"pruned_{hz_name}"]               = pruned_h
            multi[f"static_accuracy_{hz_name}"]     = sa_h
            multi[f"wf_accuracy_{hz_name}"]         = wf_h["wf_accuracy"]
            multi[f"wf_accuracy_std_{hz_name}"]     = wf_h["wf_accuracy_std"]
            multi[f"wf_rounds_{hz_name}"]           = wf_h["wf_rounds"]
            multi[f"wf_accuracy_history_{hz_name}"] = wf_h["wf_accuracy_history"]
            multi[f"wf_dates_{hz_name}"]            = wf_h["wf_dates"]
            multi[f"wf_diagnostics_{hz_name}"]      = wf_h["wf_diagnostics"]
            multi[f"calibrator_{hz_name}"]          = wf_h["calibrator"]

        # ── Feature importance (from LGBM primary) ───────────────────────────
        importances = dict(zip(feature_cols_1d,
                               classifier_lgbm.feature_importances_.tolist()))
        top_features = sorted(importances.items(), key=lambda x: -x[1])[:5]

        safe = _safe_symbol(symbol)
        joblib.dump({
            "bundle_version":    BUNDLE_VERSION,
            "classifier_lgbm":   classifier_lgbm,
            "classifier_xgb":    classifier_xgb,
            "regressor":         regressor,
            # 1D horizon (primary)
            "scaler":            scaler_1d,        # backward-compat alias
            "features":          feature_cols_1d,  # backward-compat alias
            "scaler_1d":         scaler_1d,
            "features_1d":       feature_cols_1d,
            # 1W horizon (separate scaler + feature set)
            "scaler_1w":         scaler_1w,        # None if 1w training was skipped
            "features_1w":       feature_cols_1w,
            "importances_1d":    importances_1d,
            "pruned_1d":         pruned_1d,
            "static_accuracy":   static_accuracy,
            "mag_mae":           mag_mae,
            "trained_on":        len(feat_df),
            "training_period":   training_period,
            "top_features":      top_features,
            # Regime calibrators stored at top level (1d horizon only;
            # 1w/1m use global calibrator — fewer held-out rows per regime)
            "calibrator_bull":    wf.get("calibrator_bull"),
            "calibrator_bear":    wf.get("calibrator_bear"),
            "calibrator_neutral": wf.get("calibrator_neutral"),
            **wf,
            **multi,
        }, MODELS_DIR / f"{safe}.pkl")

        return {
            "static_accuracy": static_accuracy,
            "wf_accuracy":     wf["wf_accuracy"],
            "wf_rounds":       wf["wf_rounds"],
            "mag_mae":         mag_mae,
            "trained_on":      len(feat_df),
        }

    def predict(
        self,
        symbol: str,
        df: pd.DataFrame,
        training_period: str = "3y",
        sentiment_score: float = 0.0,
        sentiment_label: str = "NEUTRAL",
        horizon: str = "1d",
    ) -> PredictionResult:
        safe = _safe_symbol(symbol)
        model_path = MODELS_DIR / f"{safe}.pkl"

        # Retrain if: no file, wrong period, or old bundle missing new fields
        needs_train = self.needs_retrain(symbol, training_period)

        # Drop today's bar if it is still incomplete (live price ≠ end-of-day close)
        is_crypto = symbol.upper().endswith("-USD")
        df = _trim_to_last_complete_bar(df, is_crypto=is_crypto)

        if needs_train:
            self.train(symbol, df, training_period)

        bundle = joblib.load(model_path)
        clf_lgbm: LGBMClassifier = bundle["classifier_lgbm"]
        clf_xgb:  XGBClassifier  = bundle["classifier_xgb"]
        regressor:      LGBMRegressor    = bundle["regressor"]
        feature_cols_1d: list[str]       = bundle.get("features_1d", bundle["features"])
        scaler_1d:       StandardScaler  = bundle.get("scaler_1d",   bundle["scaler"])
        feature_cols_1w: list[str]       = bundle.get("features_1w", feature_cols_1d)
        scaler_1w: StandardScaler | None = bundle.get("scaler_1w")

        earnings_dates = get_earnings_dates(symbol)
        # _build_features returns ALL rows including blackout rows so we can
        # (a) read the live bar's in_earnings_blackout flag, and
        # (b) read regime from the most recent bar.
        # Training filters blackout rows separately inside train().
        feat_df = _build_features(df, symbol, earnings_dates)
        if feat_df.empty:
            raise ValueError("Could not build features for prediction")

        # Build the 1D feature row (always needed — regressor always uses 1D features)
        available_1d = [c for c in feature_cols_1d if c in feat_df.columns]
        last_row_1d  = feat_df[available_1d].iloc[-1].values.reshape(1, -1)
        last_row_1d_sc = scaler_1d.transform(last_row_1d)

        # ── Detect current market regime from live bar ─────────────────────────
        try:
            if feat_df["regime_bull"].iloc[-1] == 1.0:
                live_regime = "bull"
            elif feat_df["regime_bear"].iloc[-1] == 1.0:
                live_regime = "bear"
            else:
                live_regime = "neutral"
        except Exception:
            live_regime = "neutral"

        # ── Select model pair for requested horizon ────────────────────────────
        if horizon in ("1w", "1m") and f"classifier_lgbm_{horizon}" in bundle:
            clf_lgbm_use = bundle[f"classifier_lgbm_{horizon}"]
            clf_xgb_use  = bundle.get(f"classifier_xgb_{horizon}")
            # 1w/1m use global calibrator (fewer held-out rows per regime bucket)
            cal_use   = bundle.get(f"calibrator_{horizon}")
            wf_key    = f"wf_accuracy_{horizon}"
            wf_std_k  = f"wf_accuracy_std_{horizon}"
            wf_rnd_k  = f"wf_rounds_{horizon}"
            wf_hist_k = f"wf_accuracy_history_{horizon}"
            wf_date_k = f"wf_dates_{horizon}"
            wf_diag_k = f"wf_diagnostics_{horizon}"
            sa_key    = f"static_accuracy_{horizon}"
        else:
            horizon      = "1d"   # fall back gracefully if 1w/1m not trained yet
            clf_lgbm_use = clf_lgbm
            clf_xgb_use  = clf_xgb
            # For 1d: prefer regime-specific calibrator, fall back to global
            cal_use = (bundle.get(f"calibrator_{live_regime}")
                       or bundle.get("calibrator"))
            wf_key    = "wf_accuracy"
            wf_std_k  = "wf_accuracy_std"
            wf_rnd_k  = "wf_rounds"
            wf_hist_k = "wf_accuracy_history"
            wf_date_k = "wf_dates"
            wf_diag_k = "wf_diagnostics"
            sa_key    = "static_accuracy"

        # ── Build horizon-specific feature row for classifier ─────────────────
        if horizon == "1w" and scaler_1w is not None:
            available_hz   = [c for c in feature_cols_1w if c in feat_df.columns]
            last_row_hz_sc = scaler_1w.transform(
                feat_df[available_hz].iloc[-1].values.reshape(1, -1))
        else:
            available_hz   = available_1d
            last_row_hz_sc = last_row_1d_sc

        # ── Direction — blend LGBM + XGBoost ──────────────────────────────────
        last_row_hz_df = pd.DataFrame(last_row_hz_sc, columns=available_hz)
        lgbm_prob = float(clf_lgbm_use.predict_proba(last_row_hz_df)[0][1])
        if clf_xgb_use is not None:
            xgb_prob     = float(clf_xgb_use.predict_proba(last_row_hz_sc)[0][1])
            raw_up_proba = (lgbm_prob + xgb_prob) / 2.0
        else:
            raw_up_proba = lgbm_prob

        # Apply isotonic regression calibrator if available (fitted on WF held-out data)
        if cal_use is not None:
            cal_up_proba  = float(cal_use.predict([raw_up_proba])[0])
            is_calibrated = True
        else:
            cal_up_proba  = raw_up_proba
            is_calibrated = False

        direction      = "UP" if cal_up_proba >= 0.5 else "DOWN"
        cal_confidence = (cal_up_proba if direction == "UP" else 1.0 - cal_up_proba) * 100
        raw_confidence = round(cal_confidence, 1)   # calibrated, pre-sentiment

        # ── Magnitude (regressor always uses 1D features) ─────────────────────
        last_row_1d_df    = pd.DataFrame(last_row_1d_sc, columns=available_1d)
        expected_move_pct = float(regressor.predict(last_row_1d_df)[0])
        current_price     = float(feat_df["close"].iloc[-1])
        # Apply magnitude in the classifier's direction — the two models are
        # independent so expected_move_pct may have opposite sign to direction.
        # We use abs(magnitude) and flip to match the classifier direction.
        magnitude = abs(expected_move_pct)
        target_price = (current_price * (1 + magnitude / 100) if direction == "UP"
                        else current_price * (1 - magnitude / 100))

        # ── Sentiment adjustment (±12 pp max) ─────────────────────────────────
        aligned = (direction == "UP"   and sentiment_score >= 0) or \
                  (direction == "DOWN" and sentiment_score <= 0)
        adjustment = abs(sentiment_score) * 12 * (1 if aligned else -1)
        adj_confidence = round(min(99.0, max(1.0, raw_confidence + adjustment)), 1)

        # ── ATR-based trade levels (% of price, scaled by horizon) ────────────
        # 1d: 1.5× TP / 1.0× SL;  1w: 3.0× / 2.0×;  1m: 6.0× / 4.0×
        ATR_MULT = {"1d": (1.5, 1.0), "1w": (3.0, 2.0), "1m": (6.0, 4.0)}
        tp_mult, sl_mult = ATR_MULT.get(horizon, (1.5, 1.0))
        try:
            atr_pct_val = float(feat_df["atr_pct"].iloc[-1])
            if atr_pct_val > 0:
                take_profit_pct = round(atr_pct_val * tp_mult * 100, 2)
                stop_loss_pct   = round(atr_pct_val * sl_mult * 100, 2)
            else:
                take_profit_pct = stop_loss_pct = 0.0
        except Exception:
            take_profit_pct = stop_loss_pct = 0.0

        # ── Earnings blackout from live bar ───────────────────────────────────
        try:
            in_blackout = bool(feat_df["in_earnings_blackout"].iloc[-1] == 1.0)
        except Exception:
            in_blackout = False

        regime = live_regime.upper()   # already detected above

        return PredictionResult(
            symbol=symbol,
            direction=direction,
            # Main confidence = sentiment-adjusted
            confidence_pct=adj_confidence,
            raw_confidence_pct=raw_confidence,
            is_calibrated=is_calibrated,
            current_price=round(current_price, 6),
            target_price=round(target_price, 6),
            expected_move_pct=round(expected_move_pct, 2),
            # Walk-forward (reliable accuracy) — horizon-specific
            wf_accuracy=round(bundle.get(wf_key, 0.0) * 100, 1),
            wf_accuracy_std=round(bundle.get(wf_std_k, 0.0) * 100, 1),
            wf_rounds=bundle.get(wf_rnd_k, 0),
            wf_accuracy_history=[round(a * 100, 1)
                                  for a in bundle.get(wf_hist_k, [])],
            wf_dates=bundle.get(wf_date_k, []),
            wf_diagnostics=bundle.get(wf_diag_k, []),
            # Static (kept for reference)
            model_accuracy=round(bundle.get(sa_key, 0.0) * 100, 1),
            features_used=len(available_hz),
            trained_on_days=bundle.get("trained_on", 0),
            # Top features (legacy — kept for backward compat)
            top_features=bundle.get("top_features", []),
            # Full feature importances (1D and 1W)
            feature_importances_1d=bundle.get("importances_1d", []),
            feature_importances_1w=bundle.get("importances_1w",
                                               bundle.get("importances_1d", [])),
            pruned_features_1d=bundle.get("pruned_1d", []),
            pruned_features_1w=bundle.get("pruned_1w", []),
            # Sentiment
            sentiment_score=round(sentiment_score, 4),
            sentiment_label=sentiment_label,
            # Trade levels
            take_profit_pct=take_profit_pct,
            stop_loss_pct=stop_loss_pct,
            # Horizon
            horizon=horizon,
            # Regime & blackout
            earnings_blackout_active=in_blackout,
            regime=regime,
        )

    def clear_cache(self, symbol: str) -> bool:
        """Delete the saved model bundle so the next predict() call forces a retrain."""
        safe = _safe_symbol(symbol)
        path = MODELS_DIR / f"{safe}.pkl"
        if path.exists():
            path.unlink()
            logger.info(f"Cleared model cache for {symbol}")
            return True
        return False

    # Structural bundle keys that must exist for predict() to run against the
    # current pipeline. These are layout markers, NOT feature names — auto-prune
    # legitimately removes individual features, so checking feature names here
    # would (and previously did) force a retrain on every single call.
    _REQUIRED_KEYS = (
        "classifier_lgbm", "classifier_xgb", "regressor", "wf_diagnostics",
        "calibrator", "calibrator_bull",
        "classifier_lgbm_1w", "features_1d", "features_1w", "scaler_1d",
    )

    def needs_retrain(self, symbol: str, training_period: str = "3y") -> bool:
        """
        True if the saved bundle is missing, unreadable, on an older schema
        version, wrong training period, or older than _MAX_BUNDLE_AGE_DAYS —
        i.e. the next training-allowed predict() would do a full retrain.

        Lets callers (the manual model-refresh job, the conviction scan) check
        staleness *without* paying the cost of training.
        """
        safe = _safe_symbol(symbol)
        model_path = MODELS_DIR / f"{safe}.pkl"
        if not model_path.exists():
            return True
        try:
            age_days = (time.time() - model_path.stat().st_mtime) / 86400
            if age_days > _MAX_BUNDLE_AGE_DAYS:
                return True
            b = joblib.load(model_path)
            if b.get("bundle_version", 0) < BUNDLE_VERSION:
                return True
            if b.get("training_period", "2y") != training_period:
                return True
            if any(k not in b for k in self._REQUIRED_KEYS):
                return True
        except Exception:
            return True
        return False

    def retrain_all(self, symbols_df_map: dict[str, pd.DataFrame], training_period: str = "3y"):
        for symbol, df in symbols_df_map.items():
            try:
                self.train(symbol, df, training_period)
            except Exception as e:
                logger.warning(f"Retrain failed for {symbol}: {e}")


ml_predictor = MLPredictor()
