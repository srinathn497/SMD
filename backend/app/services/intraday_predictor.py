"""
Intraday ML Predictor — Phase 3.

A dedicated LightGBM classifier trained on 15-minute bars.

Target: will price be higher in ~1 hour?
  close[t+4] > close[t]  →  1 (UP) | 0 (DOWN)
  4 bars × 15 min = 60 minutes look-ahead

Separate from the daily ml_predictor — optimised for intraday swing entries
within the current session.

Model saved as: models_store/{SYMBOL}_15m.pkl
Retrain trigger: missing file, bundle older than 24 h, or missing 'intra_features' key.
"""
import logging
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pandas_ta as ta
from lightgbm import LGBMClassifier
from sklearn.metrics import accuracy_score
from sklearn.preprocessing import StandardScaler

from app.schemas.signals import IntraPredictionResult
from app.services.market_context import (
    SECTOR_MAP, get_market_df, get_intraday_df, get_earnings_dates, add_earnings_features,
)

logger = logging.getLogger("intra_predictor")

MODELS_DIR = Path(__file__).parent.parent.parent / "models_store"
MODELS_DIR.mkdir(exist_ok=True)

LOOKAHEAD = 4           # 4 × 15 min = ~1 hour look-ahead

# Walk-forward params — stocks ~26 bars/day, crypto ~96 bars/day
WF_MIN_TRAIN_STOCKS = 260   # ~10 trading days
WF_MIN_TRAIN_CRYPTO = 500   # ~5 calendar days
WF_TEST_STOCKS      = 52    # ~2 trading days per test window
WF_TEST_CRYPTO      = 96    # 1 calendar day per test window

FEATURE_COLS_15M = [
    # Momentum
    "rsi_14",
    # MACD
    "macd_hist", "macd_signal",
    # Bollinger Bands
    "bb_pct", "bb_width",
    # Trend
    "ema_diff", "ema_slope",
    # Multi-bar returns
    "ret_1b", "ret_4b", "ret_8b", "ret_16b",
    # Volume
    "volume_ratio", "volume_trend",
    # Volatility
    "atr_pct", "volatility_8b",
    # Intraday context
    "vwap_deviation",         # % distance from intraday VWAP (symbol)
    "spy_intraday_vwap_dev",  # SPY's % distance from its own intraday VWAP
    "open_range_pos",         # position within day's open-to-close range
    # Time encoding (cyclical — lets model learn intraday patterns)
    "time_sin", "time_cos",
    # Daily context (higher-timeframe anchor)
    "daily_rsi", "daily_ret_1d",
    # ── Market regime (daily, forward-filled to 15m bars) ─────────────────
    "vix_level",             # VIX / 30 — market fear level
    "vix_change_5d",         # 5-day VIX change — rising vs calming fear
    "spy_ret_1d",            # SPY yesterday's return — broad market direction
    "sector_ret_1d",         # Sector ETF yesterday's return
    # ── Earnings proximity ─────────────────────────────────────────────────
    "days_to_next_earnings", # calendar days to next earnings (capped 30)
    "days_since_earnings",   # calendar days since last earnings (capped 90)
    "earnings_in_5d",        # binary: earnings within next 5 days
]


def _safe_symbol(symbol: str) -> str:
    return symbol.replace("/", "_").replace("\\", "_")


# ── Feature engineering ────────────────────────────────────────────────────────

def _build_features_15m(
    df: pd.DataFrame,
    df_1d: pd.DataFrame,
    asset_type: str = "stock",
    prediction_mode: bool = False,
    symbol: str = "",
    earnings_dates: list | None = None,
    market_ctx: dict | None = None,
) -> pd.DataFrame:
    """
    Build 15m feature matrix from intraday OHLCV.

    prediction_mode=True
        Keep the most-recent bar even if it has NaN features.
        Do NOT add a target column.
        Used at prediction time so we score the live bar.
    prediction_mode=False
        Add target column and drop rows with any NaN.
        Used for training.
    """
    df = df.copy()
    df.columns = [c.lower() for c in df.columns]
    df.index = pd.to_datetime(df.index)

    close = df["close"]

    # ── Momentum ──────────────────────────────────────────────────────────────
    df["rsi_14"] = ta.rsi(close, length=14)

    macd_df = ta.macd(close, fast=12, slow=26, signal=9)
    if macd_df is not None:
        h = [c for c in macd_df.columns if c.startswith("MACDh_")]
        s = [c for c in macd_df.columns if c.startswith("MACDs_")]
        df["macd_hist"]   = macd_df[h[0]] if h else 0.0
        df["macd_signal"] = macd_df[s[0]] if s else 0.0
    else:
        df["macd_hist"] = df["macd_signal"] = 0.0

    bb_df = ta.bbands(close, length=20, std=2.0)
    if bb_df is not None:
        p = [c for c in bb_df.columns if c.startswith("BBP_")]
        w = [c for c in bb_df.columns if c.startswith("BBB_")]
        df["bb_pct"]   = bb_df[p[0]] if p else 0.5
        df["bb_width"] = bb_df[w[0]] if w else 0.0
    else:
        df["bb_pct"] = 0.5
        df["bb_width"] = 0.0

    # ── Trend ─────────────────────────────────────────────────────────────────
    ema20 = ta.ema(close, length=20)
    ema50 = ta.ema(close, length=50)
    df["ema_diff"]  = (ema20 - ema50) / (close + 1e-9)
    df["ema_slope"] = ema20.diff(5) / (ema20.shift(5) + 1e-9)

    # ── Multi-bar returns ──────────────────────────────────────────────────────
    df["ret_1b"]  = close.pct_change(1)
    df["ret_4b"]  = close.pct_change(4)
    df["ret_8b"]  = close.pct_change(8)
    df["ret_16b"] = close.pct_change(16)

    # ── Volume ────────────────────────────────────────────────────────────────
    vol_ma20 = df["volume"].rolling(20).mean()
    vol_ma5  = df["volume"].rolling(5).mean()
    df["volume_ratio"] = df["volume"] / (vol_ma20 + 1e-9)
    df["volume_trend"] = vol_ma5 / (vol_ma20 + 1e-9)

    # ── Volatility ────────────────────────────────────────────────────────────
    df["atr_pct"]       = ta.atr(df["high"], df["low"], close, length=14) / (close + 1e-9)
    df["volatility_8b"] = close.pct_change(1).rolling(8).std()

    # ── Intraday VWAP (resets each day) ───────────────────────────────────────
    # Use tz-aware date grouping so VWAP resets at midnight UTC for crypto
    if df.index.tzinfo is not None:
        dates = df.index.tz_convert("UTC").date
    else:
        dates = df.index.date

    df["_date"]    = dates
    df["_typical"] = (df["high"] + df["low"] + close) / 3
    df["_tpv"]     = df["_typical"] * df["volume"]

    vwap_vals = np.zeros(len(df))
    for date_val, grp_idx in df.groupby("_date").groups.items():
        grp = df.loc[grp_idx]
        cum_tpv = grp["_tpv"].cumsum()
        cum_vol = grp["volume"].cumsum()
        vwap_day = cum_tpv / (cum_vol + 1e-9)
        positions = df.index.get_indexer(grp_idx)
        vwap_vals[positions] = vwap_day.values

    df["_vwap"]         = vwap_vals
    df["vwap_deviation"] = (close - df["_vwap"]) / (df["_vwap"] + 1e-9) * 100

    # ── Open-range position ────────────────────────────────────────────────────
    # How far current price is from the day-open, as a fraction of the day's range.
    # Positive = above open, negative = below open.
    def _open_range_for_day(grp: pd.DataFrame) -> pd.Series:
        day_open  = grp["open"].iloc[0]
        day_range = (grp["high"].max() - grp["low"].min())
        day_range = max(day_range, 1e-9)
        return (grp["close"] - day_open) / day_range

    df["open_range_pos"] = df.groupby("_date", group_keys=False).apply(_open_range_for_day)

    # ── Time encoding (cyclical, 24-hour) ──────────────────────────────────────
    minutes_in_day = 24 * 60
    idx_minutes    = df.index.hour * 60 + df.index.minute
    angle          = 2 * np.pi * idx_minutes / minutes_in_day
    df["time_sin"] = np.sin(angle)
    df["time_cos"] = np.cos(angle)

    # ── Daily context (higher-timeframe anchor) ────────────────────────────────
    df_1d = df_1d.copy()
    df_1d.columns = [c.lower() for c in df_1d.columns]
    # Normalise daily index to tz-naive dates for merging
    d_idx = pd.to_datetime(df_1d.index)
    if d_idx.tzinfo is not None:
        d_idx = d_idx.tz_localize(None)
    df_1d.index = d_idx.normalize()

    d_close    = df_1d["close"]
    d_rsi      = ta.rsi(d_close, length=14)
    d_ret_1d   = d_close.pct_change(1)

    # Align 15m bar dates to nearest available daily row (forward-fill)
    bar_dates = pd.to_datetime(df.index)
    if bar_dates.tzinfo is not None:
        bar_dates = bar_dates.tz_localize(None)
    bar_dates = bar_dates.normalize()

    df["daily_rsi"]    = d_rsi.reindex(bar_dates, method="ffill").values
    df["daily_ret_1d"] = d_ret_1d.reindex(bar_dates, method="ffill").values

    # ── Market regime context (VIX + SPY + sector, daily → forward-filled) ─────
    ctx = market_ctx or {}
    bar_dates_norm = bar_dates   # already normalised above

    vix_df = ctx.get("vix")
    if vix_df is not None and not vix_df.empty:
        vix_close = vix_df["close"].reindex(bar_dates_norm, method="ffill")
        df["vix_level"]     = (vix_close / 30.0).values
        df["vix_change_5d"] = vix_close.pct_change(5).reindex(bar_dates_norm, method="ffill").values
    else:
        df["vix_level"]     = 0.0
        df["vix_change_5d"] = 0.0

    spy_df = ctx.get("spy")
    if spy_df is not None and not spy_df.empty:
        spy_close = spy_df["close"].reindex(bar_dates_norm, method="ffill")
        df["spy_ret_1d"] = spy_close.pct_change(1).reindex(bar_dates_norm, method="ffill").values
    else:
        df["spy_ret_1d"] = 0.0

    sector_df = ctx.get("sector")
    if sector_df is not None and not sector_df.empty:
        sect_close = sector_df["close"].reindex(bar_dates_norm, method="ffill")
        df["sector_ret_1d"] = sect_close.pct_change(1).reindex(bar_dates_norm, method="ffill").values
    else:
        df["sector_ret_1d"] = 0.0

    # ── SPY intraday VWAP deviation ───────────────────────────────────────────
    # Tells the model whether SPY itself is above/below its own session VWAP.
    # Distinguishes stock-specific weakness from broad market tape weakness.
    is_crypto = asset_type == "crypto"
    spy_15m_df = ctx.get("spy_15m") if not is_crypto else None
    if spy_15m_df is not None and not spy_15m_df.empty:
        try:
            spy = spy_15m_df.copy()
            # Flatten any MultiIndex or duplicate columns that survived the cache
            if isinstance(spy.columns, pd.MultiIndex):
                spy.columns = spy.columns.get_level_values(0)
                spy.columns = [str(c).lower() for c in spy.columns]
            if spy.columns.duplicated().any():
                spy = spy.loc[:, ~spy.columns.duplicated(keep="first")]

            # Group by US Eastern date so VWAP resets at each trading day open
            if spy.index.tzinfo is not None:
                spy_et_dates = spy.index.tz_convert("America/New_York").date
            else:
                spy_et_dates = spy.index.date
            spy["_spy_date"] = spy_et_dates
            # Use numpy arrays to avoid pandas column-shape issues under concurrency
            _high   = np.asarray(spy["high"]).ravel()
            _low    = np.asarray(spy["low"]).ravel()
            _close  = np.asarray(spy["close"]).ravel()
            _volume = np.asarray(spy["volume"]).ravel()
            spy["_spy_typ"]  = (_high + _low + _close) / 3
            spy["_spy_tpv"]  = spy["_spy_typ"] * _volume

            spy_vwap_arr = np.zeros(len(spy))
            for _d, grp_idx in spy.groupby("_spy_date").groups.items():
                g = spy.loc[grp_idx]
                vw = g["_spy_tpv"].cumsum() / (g["volume"].cumsum() + 1e-9)
                spy_vwap_arr[spy.index.get_indexer(grp_idx)] = vw.values

            spy_vwap_dev = (_close - spy_vwap_arr) / (spy_vwap_arr + 1e-9) * 100
            spy_vwap_dev = pd.Series(spy_vwap_dev, index=spy.index)

            # Align SPY timestamps to symbol timestamps — handle tz mismatch gracefully
            if spy_vwap_dev.index.tzinfo is not None and df.index.tzinfo is not None:
                spy_vwap_dev = spy_vwap_dev.tz_convert(df.index.tzinfo)
            elif spy_vwap_dev.index.tzinfo is not None:
                spy_vwap_dev.index = spy_vwap_dev.index.tz_localize(None)

            df["spy_intraday_vwap_dev"] = (
                spy_vwap_dev.reindex(df.index, method="ffill").fillna(0.0).values
            )
        except Exception as exc:
            logger.warning(f"spy_intraday_vwap_dev: {exc}")
            df["spy_intraday_vwap_dev"] = 0.0
    else:
        df["spy_intraday_vwap_dev"] = 0.0

    # ── Earnings proximity ─────────────────────────────────────────────────────
    add_earnings_features(df, earnings_dates or [], bar_dates_norm)

    # ── Target & output ────────────────────────────────────────────────────────
    available_feat = [c for c in FEATURE_COLS_15M if c in df.columns]

    if not prediction_mode:
        df["target"] = (close.shift(-LOOKAHEAD) > close).astype(int)
        cols = available_feat + ["target", "close"]
        return df[cols].dropna()
    else:
        cols = available_feat + ["close"]
        df_feat = df[cols]
        # Keep all rows for trailing-window features; only the last row may have NaN
        # from indicators — fill with 0 so we can score it
        body     = df_feat.iloc[:-1].dropna()
        last_row = df_feat.iloc[[-1]].fillna(0)
        return pd.concat([body, last_row])


# ── Per-round WF diagnostic ────────────────────────────────────────────────────

def _make_diagnostic(window: pd.DataFrame, accuracy: float) -> str:
    """
    Generate a human-readable diagnostic string for one WF test window.
    Works on both daily and 15m feature DataFrames (same column names).
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
            conclusion = "Earnings uncertainty made patterns unpredictable."
        elif spy_cum < -0.015:
            conclusion = "Macro selloff — broad market overwhelmed intraday signals."
        elif spy_cum > 0.015:
            conclusion = "Strong rally — mean-reversion setups backfired."
        else:
            conclusion = "Model failed — possible regime shift or choppy action."
    lines.append(f"→ {conclusion}")

    return "\n".join(lines)


# ── Walk-forward validation ────────────────────────────────────────────────────

def _walk_forward_15m(
    feat_df: pd.DataFrame,
    feature_cols: list[str],
    is_crypto: bool,
) -> dict:
    min_train = WF_MIN_TRAIN_CRYPTO if is_crypto else WF_MIN_TRAIN_STOCKS
    test_bars = WF_TEST_CRYPTO      if is_crypto else WF_TEST_STOCKS

    X_all = feat_df[feature_cols].values[:-1]
    y_all = feat_df["target"].values[:-1]
    idx   = feat_df.index[:-1]   # DatetimeIndex aligned with X_all
    n     = len(X_all)

    accuracies:  list[float]      = []
    dates:       list[list[str]]  = []
    diagnostics: list[str]        = []
    all_probas:  list[float]      = []   # P(UP) for each held-out test bar
    all_actuals: list[int]        = []   # ground-truth label (1=UP, 0=DOWN)
    start = min_train

    while start + test_bars <= n:
        X_tr, y_tr = X_all[:start], y_all[:start]
        X_te, y_te = X_all[start:start + test_bars], y_all[start:start + test_bars]

        sc = StandardScaler()
        X_tr_sc = sc.fit_transform(X_tr)
        X_te_sc = sc.transform(X_te)

        # Recency weights: oldest bar = 0.5, newest bar = 1.0
        wts = np.linspace(0.5, 1.0, len(X_tr))

        # Wrap scaled arrays in DataFrames so LGBM retains feature names (suppresses warning)
        X_tr_df = pd.DataFrame(X_tr_sc, columns=feature_cols)
        X_te_df = pd.DataFrame(X_te_sc, columns=feature_cols)

        m = LGBMClassifier(
            n_estimators=100, learning_rate=0.1,
            max_depth=5, random_state=42, verbose=-1,
        )
        m.fit(X_tr_df, y_tr, sample_weight=wts)
        acc = float(accuracy_score(y_te, m.predict(X_te_df)))
        accuracies.append(acc)

        # Collect raw P(UP) probabilities for calibration
        test_probas = m.predict_proba(X_te_df)[:, 1]
        all_probas.extend(test_probas.tolist())
        all_actuals.extend(y_te.tolist())

        # Actual timestamps of the test window (e.g. ["Feb 5", "Feb 6"])
        ts_start = pd.Timestamp(idx[start])
        ts_end   = pd.Timestamp(idx[min(start + test_bars - 1, n - 1)])
        dates.append([
            f"{ts_start.strftime('%b')} {ts_start.day}",
            f"{ts_end.strftime('%b')} {ts_end.day}",
        ])

        # Per-round diagnostic from feature values in the test window
        window = feat_df.iloc[start:start + test_bars]
        diagnostics.append(_make_diagnostic(window, acc))

        start += test_bars

    # Fit isotonic regression calibrator on all held-out WF predictions
    calibrator = None
    if len(all_probas) >= 30:
        from sklearn.isotonic import IsotonicRegression
        calibrator = IsotonicRegression(out_of_bounds="clip").fit(all_probas, all_actuals)

    if not accuracies:
        return {"wf_accuracy": 0.0, "wf_std": 0.0, "wf_rounds": 0,
                "wf_history": [], "wf_dates": [], "wf_diagnostics": [],
                "intra_calibrator": calibrator}

    arr = np.array(accuracies)
    return {
        "wf_accuracy":      round(float(arr.mean()), 4),
        "wf_std":           round(float(arr.std()),  4),
        "wf_rounds":        len(accuracies),
        "wf_history":       [round(a, 4) for a in accuracies],
        "wf_dates":         dates,
        "wf_diagnostics":   diagnostics,
        "intra_calibrator": calibrator,
    }


# ── Market context helper ──────────────────────────────────────────────────────

def _fetch_market_ctx(symbol: str, is_crypto: bool) -> dict:
    """
    Fetch VIX, SPY, and sector ETF daily data for feature enrichment.
    Returns a dict with keys: vix, spy, sector (DataFrames).
    All fetches use the shared 30-min cache in market_context.
    """
    if is_crypto:
        return {}   # crypto has no sector ETF and VIX is US-market specific

    vix_df    = get_market_df("^VIX", period="3y")
    spy_df    = get_market_df("SPY",  period="3y")
    sec_ticker = SECTOR_MAP.get(symbol.upper(), "")
    sector_df  = get_market_df(sec_ticker, period="3y") if sec_ticker and sec_ticker != "SPY" else spy_df
    # SPY 15m for intraday VWAP feature (yfinance 15m covers last 60 days)
    spy_15m = get_intraday_df("SPY", interval="15m", period="60d")

    return {"vix": vix_df, "spy": spy_df, "sector": sector_df, "spy_15m": spy_15m}


# ── Main predictor class ───────────────────────────────────────────────────────

class IntraMLPredictor:

    def train(
        self,
        symbol: str,
        df_15m: pd.DataFrame,
        df_1d: pd.DataFrame,
        asset_type: str = "stock",
    ) -> dict:
        is_crypto = asset_type == "crypto"
        min_bars  = WF_MIN_TRAIN_CRYPTO if is_crypto else WF_MIN_TRAIN_STOCKS

        # Fetch external context once — passed into feature builder
        earnings_dates = get_earnings_dates(symbol) if not is_crypto else []
        market_ctx = _fetch_market_ctx(symbol, is_crypto)

        feat_df = _build_features_15m(
            df_15m, df_1d, asset_type, prediction_mode=False,
            symbol=symbol, earnings_dates=earnings_dates, market_ctx=market_ctx,
        )
        feature_cols = [c for c in feat_df.columns if c not in ("target", "close")]

        if len(feat_df) < min_bars + 10:
            raise ValueError(
                f"Insufficient 15m data for {symbol}: {len(feat_df)} bars "
                f"(need ≥ {min_bars + 10}; try fetching more history)"
            )

        X = feat_df[feature_cols].values[:-1]
        y = feat_df["target"].values[:-1]

        split    = int(len(X) * 0.8)
        scaler   = StandardScaler()
        X_tr_sc  = scaler.fit_transform(X[:split])
        X_te_sc  = scaler.transform(X[split:])

        clf = LGBMClassifier(
            n_estimators=200, learning_rate=0.05,
            max_depth=5, num_leaves=25,
            min_child_samples=15,
            subsample=0.8, colsample_bytree=0.8,
            random_state=42, verbose=-1,
        )
        # Recency weights: oldest bar = 0.5, newest bar = 1.0
        train_weights = np.linspace(0.5, 1.0, split)

        # Wrap scaled arrays in DataFrames so LGBM retains feature names (suppresses warning)
        X_tr_df = pd.DataFrame(X_tr_sc, columns=feature_cols)
        X_te_df = pd.DataFrame(X_te_sc, columns=feature_cols)

        clf.fit(X_tr_df, y[:split], sample_weight=train_weights)
        static_acc = float(accuracy_score(y[split:], clf.predict(X_te_df)))

        logger.info(f"[{symbol} 15m] Running walk-forward validation…")
        wf = _walk_forward_15m(feat_df, feature_cols, is_crypto)
        logger.info(
            f"[{symbol} 15m] WF accuracy: {wf['wf_accuracy']:.1%} "
            f"± {wf['wf_std']:.1%} over {wf['wf_rounds']} rounds"
        )

        importances  = dict(zip(feature_cols, clf.feature_importances_.tolist()))
        top_features = sorted(importances.items(), key=lambda x: -x[1])[:5]

        safe = _safe_symbol(symbol)
        joblib.dump(
            {
                "classifier":          clf,
                "scaler":              scaler,
                "intra_features":      feature_cols,
                "static_accuracy":     static_acc,
                "trained_on":          len(feat_df),
                "asset_type":          asset_type,
                "top_features":        top_features,
                "trained_at":          time.time(),
                # Prefix wf keys to avoid collision with daily bundle keys
                "intra_wf_accuracy":     wf["wf_accuracy"],
                "intra_wf_std":          wf["wf_std"],
                "intra_wf_rounds":       wf["wf_rounds"],
                "intra_wf_history":      wf["wf_history"],
                "intra_wf_dates":        wf["wf_dates"],
                "intra_wf_diagnostics":  wf["wf_diagnostics"],
                "intra_calibrator":      wf["intra_calibrator"],
            },
            MODELS_DIR / f"{safe}_15m.pkl",
        )

        return {
            "static_accuracy": static_acc,
            "wf_accuracy":     wf["wf_accuracy"],
            "wf_rounds":       wf["wf_rounds"],
            "trained_on":      len(feat_df),
        }

    def predict(
        self,
        symbol: str,
        df_15m: pd.DataFrame,
        df_1d: pd.DataFrame,
        asset_type: str = "stock",
    ) -> IntraPredictionResult:
        safe       = _safe_symbol(symbol)
        model_path = MODELS_DIR / f"{safe}_15m.pkl"

        # Retrain if: missing, stale (> 24 h), or pre-Phase-3 bundle
        needs_train = not model_path.exists()
        if not needs_train:
            try:
                b   = joblib.load(model_path)
                age = time.time() - b.get("trained_at", 0)
                if ("intra_features" not in b
                        or "days_to_next_earnings" not in b.get("intra_features", [])
                        or "intra_wf_diagnostics" not in b
                        or "intra_calibrator" not in b
                        or "spy_intraday_vwap_dev" not in b.get("intra_features", [])
                        or age > 86400):
                    needs_train = True
            except Exception:
                needs_train = True

        if needs_train:
            self.train(symbol, df_15m, df_1d, asset_type)

        bundle: dict         = joblib.load(model_path)
        clf:    LGBMClassifier = bundle["classifier"]
        scaler: StandardScaler = bundle["scaler"]
        feature_cols: list[str] = bundle["intra_features"]

        # Build features in prediction mode — keeps the live bar even with NaN
        is_crypto = asset_type == "crypto"
        earnings_dates = get_earnings_dates(symbol) if not is_crypto else []
        market_ctx = _fetch_market_ctx(symbol, is_crypto)
        feat_df = _build_features_15m(
            df_15m, df_1d, asset_type, prediction_mode=True,
            symbol=symbol, earnings_dates=earnings_dates, market_ctx=market_ctx,
        )
        if feat_df.empty:
            raise ValueError(f"Could not build 15m features for {symbol}")

        available   = [c for c in feature_cols if c in feat_df.columns]
        last_values = feat_df[available].iloc[-1].fillna(0).values.reshape(1, -1)
        last_sc     = scaler.transform(last_values)

        last_df      = pd.DataFrame(last_sc, columns=available)
        proba        = clf.predict_proba(last_df)[0]
        raw_up_proba = float(proba[1])

        # Apply isotonic regression calibrator if available (fitted on WF held-out data)
        if bundle.get("intra_calibrator") is not None:
            cal_up_proba  = float(bundle["intra_calibrator"].predict([raw_up_proba])[0])
            is_calibrated = True
        else:
            cal_up_proba  = raw_up_proba
            is_calibrated = False

        direction  = "UP" if cal_up_proba >= 0.5 else "DOWN"
        confidence = round((cal_up_proba if direction == "UP" else 1.0 - cal_up_proba) * 100, 1)

        current_price    = float(feat_df["close"].iloc[-1])
        last_bar_ts      = feat_df.index[-1]
        # Convert to UTC ISO string so the frontend can show "scored as of HH:MM"
        try:
            scored_bar_time = pd.Timestamp(last_bar_ts).tz_convert("UTC").isoformat()
        except Exception:
            scored_bar_time = str(last_bar_ts)

        return IntraPredictionResult(
            symbol=symbol.upper(),
            direction=direction,
            confidence_pct=confidence,
            is_calibrated=is_calibrated,
            current_price=round(current_price, 4),
            horizon_bars=LOOKAHEAD,
            horizon_minutes=LOOKAHEAD * 15,
            wf_accuracy=round(bundle.get("intra_wf_accuracy", 0.0) * 100, 1),
            wf_accuracy_std=round(bundle.get("intra_wf_std",      0.0) * 100, 1),
            wf_history=[round(a * 100, 1) for a in bundle.get("intra_wf_history", [])],
            static_accuracy=round(bundle.get("static_accuracy", 0.0) * 100, 1),
            trained_on_bars=bundle.get("trained_on", 0),
            top_features=bundle.get("top_features", []),
            wf_dates=bundle.get("intra_wf_dates", []),
            wf_diagnostics=bundle.get("intra_wf_diagnostics", []),
            scored_bar_time=scored_bar_time,
        )

    def clear_cache(self, symbol: str) -> bool:
        """Delete the 15m model bundle so the next predict() forces a retrain."""
        safe = _safe_symbol(symbol)
        path = MODELS_DIR / f"{safe}_15m.pkl"
        if path.exists():
            path.unlink()
            logger.info(f"Cleared 15m model cache for {symbol}")
            return True
        return False


intra_predictor = IntraMLPredictor()
