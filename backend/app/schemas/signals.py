from __future__ import annotations
from pydantic import BaseModel


class IndicatorSignal(BaseModel):
    name: str
    value: float | None
    signal: str  # BUY | SELL | HOLD
    detail: str = ""


class SignalResult(BaseModel):
    symbol: str
    asset_type: str
    current_price: float
    aggregate_signal: str  # BUY | SELL | HOLD
    confidence_pct: float
    buy_count: int
    sell_count: int
    hold_count: int
    indicators: list[IndicatorSignal]


class PredictionResult(BaseModel):
    symbol: str
    direction: str            # UP | DOWN

    # Confidence
    confidence_pct: float         # sentiment-adjusted (primary number to show)
    raw_confidence_pct: float     # pure ML confidence before sentiment adjustment

    # Price
    current_price: float
    target_price: float
    expected_move_pct: float      # magnitude: predicted next-day % move

    # Walk-forward validation (more reliable than static accuracy)
    wf_accuracy: float            # mean accuracy across rolling windows (%)
    wf_accuracy_std: float        # std deviation across windows (%)
    wf_rounds: int                # number of walk-forward rounds completed
    wf_accuracy_history: list[float]  # per-round accuracy for sparkline
    wf_dates: list                # per-round [start_date, end_date] strings
    wf_diagnostics: list[str]     # per-round regime/event explanation

    # Static backtest (kept for reference)
    model_accuracy: float
    features_used: int
    trained_on_days: int

    # Feature importance
    top_features: list                    # list of [name, importance] pairs (legacy top-5)
    feature_importances_1d: list = []     # full sorted list: [{name, importance_pct, category, pruned}]
    feature_importances_1w: list = []
    pruned_features_1d: list[str] = []   # features removed as low-signal (< 1%)
    pruned_features_1w: list[str] = []

    # Calibration
    is_calibrated: bool = False   # True if isotonic regression calibrator was applied

    # Sentiment
    sentiment_score: float        # -1.0 to +1.0
    sentiment_label: str          # POSITIVE | NEUTRAL | NEGATIVE

    # ATR-based trade levels (% of current price)
    take_profit_pct: float = 0.0  # e.g. 2.8 means +2.8% TP above entry
    stop_loss_pct: float   = 0.0  # e.g. 1.9 means -1.9% SL below entry

    # Prediction horizon
    horizon: str = "1d"           # "1d" | "1w" | "1m"

    # Regime & earnings context
    earnings_blackout_active: bool = False   # earnings within 5d ahead or 2d past
    regime: str = "NEUTRAL"                  # "BULL" | "BEAR" | "NEUTRAL"


class IntraPredictionResult(BaseModel):
    symbol: str
    direction: str          # UP | DOWN
    confidence_pct: float   # 0–100, raw model probability

    current_price: float

    # Prediction horizon
    horizon_bars: int       # 4
    horizon_minutes: int    # 60

    # Walk-forward validation
    wf_accuracy: float      # mean accuracy across rolling windows (%)
    wf_accuracy_std: float  # std deviation (%)
    wf_history: list[float] # per-round accuracy for sparkline

    # Static backtest
    static_accuracy: float

    trained_on_bars: int    # number of 15m bars used in training
    top_features: list      # top 5 [name, importance] pairs
    wf_dates: list          # per-round [start_date, end_date] strings (e.g. ["Feb 5", "Feb 6"])
    wf_diagnostics: list[str]  # per-round regime/event explanation
    is_calibrated: bool = False  # True if isotonic regression calibrator was applied
    scored_bar_time: str = ""    # ISO timestamp of the live bar that was scored


class OptionsFlowData(BaseModel):
    symbol: str
    put_call_oi_ratio: float
    put_call_vol_ratio: float
    atm_iv_pct: float            # e.g. 32.5 = 32.5% annualised IV
    iv_skew_pct: float           # put IV − call IV in pp; positive = fear premium
    max_pain_strike: float
    max_pain_distance_pct: float  # positive = max pain above price (bullish pull)
    expiration: str               # nearest expiry date used


class HourlyBar(BaseModel):
    time: int       # unix seconds
    open: float
    high: float
    low: float
    close: float


class IntradayContext(BaseModel):
    symbol: str

    # Today's price action
    current_price: float
    today_open: float
    today_change_pct: float       # % move from today's open
    today_high: float
    today_low: float

    # Extension gauge — how much of the daily ATR has been used today
    daily_atr: float              # 14-day ATR in price units
    today_move_usd: float         # abs(current - today_open)
    atr_coverage: float           # today_move / daily_atr  (0 = nothing moved, 2 = 2× ATR)

    # RSI on 1h bars
    rsi_1h: float
    rsi_status: str               # OVERSOLD | NEUTRAL | OVERBOUGHT

    # VWAP — intraday volume-weighted average price
    vwap: float                   # today's VWAP in price units
    vwap_deviation_pct: float     # (price - vwap) / vwap * 100  (negative = below = bullish)
    vwap_position: str            # ABOVE_VWAP | BELOW_VWAP | AT_VWAP

    # Volume pulse
    volume_ratio: float           # today volume / 20-day avg daily volume
    volume_status: str            # HIGH | NORMAL | LOW

    # Time-of-day context (US market hours; AFTER_HOURS for non-US or crypto off-hours)
    time_of_day: str              # OPEN | MID_MORNING | MIDDAY | POWER_HOUR | CLOSE | AFTER_HOURS
    time_caution: bool            # true = volatile or low-vol period, treat signals cautiously

    # Nearest levels from recent 1h swings
    nearest_support: float
    nearest_resistance: float

    # Composite scoring — replaces single-condition logic with multi-factor score
    composite_score: int          # -6 to +6; positive = bullish conditions
    score_components: list[str]   # plain-English breakdown of what drove the score

    # Daily ML context (passed in from the ML prediction card)
    daily_direction: str          # UP | DOWN | UNKNOWN
    daily_confidence: float       # 0–100; 0 if unknown

    # Combined verdict — fuses daily ML trend with intraday conditions
    combined_verdict: str         # e.g. "Daily ↑ + oversold intraday → strong entry setup"
    combined_action: str          # BUY | SELL | WAIT | NEUTRAL

    # Overall intraday decision hint
    intraday_signal: str          # STRONG_ENTRY | GOOD_ENTRY | NEUTRAL | WAIT_PULLBACK | TAKE_PROFITS
    signal_reason: str

    # Hourly OHLC sparkline (last 8 bars)
    hourly_bars: list[HourlyBar]
