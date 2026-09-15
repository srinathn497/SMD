# SMD — ML Models Documentation

Two independent LightGBM models power the prediction system.
Each serves a different decision horizon and trading style.

---

## Model 1 — Daily Swing Predictor

**File:** `backend/app/services/ml_predictor.py`
**Bundle:** `models_store/{SYMBOL}.pkl`
**Retrain trigger:** Bundle >24h old, training period changed, or missing new features
**Nightly retrain:** 02:00 via APScheduler

### What it predicts
> Will tomorrow's closing price be higher or lower than today's?

- Target: `close[t+1] > close[t]` → binary UP / DOWN
- Horizon: 1 trading day
- Use case: Swing trades, overnight holds, end-of-day decisions

### Architecture
- **Classifier:** LGBMClassifier (300 estimators, lr=0.03, max_depth=6)
- **Regressor:** LGBMRegressor — predicts the magnitude of the expected move (%)
- **Scaler:** StandardScaler (fit on training split only, no lookahead)
- **Train/test split:** 80% train / 20% static backtest (time-ordered, no shuffle)
- **Recency weighting:** `sample_weight = linspace(0.5, 1.0, n_train)` — newest bars weighted 2× vs oldest

### Features (35 total)

| Group | Features |
|---|---|
| Momentum | rsi_14 |
| MACD | macd_hist, macd_signal |
| Bollinger Bands | bb_pct, bb_width |
| Trend | ema_diff, ema_slope |
| Returns | ret_1d, ret_3d, ret_5d, ret_10d, ret_20d |
| Volume | volume_ratio, volume_trend |
| Volatility | atr_pct, volatility_20d |
| Price position | dist_52w_high, dist_52w_low |
| Candlestick | gap_open, close_position, daily_range, body_size, upper_shadow, lower_shadow |
| Market regime | spy_ret_1d, spy_ret_5d, spy_ret_20d, vix_level, vix_change_5d, rs_vs_spy_5d, rs_vs_spy_20d, sector_ret_5d |
| **Earnings proximity** | **days_to_next_earnings, days_since_earnings, earnings_in_5d** |

### Walk-Forward Validation
- Min training window: 126 days (6 months)
- Test window per round: **10 days** (~2 trading weeks)
- With 2y training data: **~32 rounds** (was 3 rounds with 1y data)
- Rounds use the same recency weighting as the main classifier
- Default training period: **2y** (changed from 1y — produces reliable WF statistics)

### Confidence & Sentiment Adjustment
Raw model probability (0–100%) is adjusted at prediction time:
```
aligned     = (direction == "UP" and sentiment >= 0) OR (direction == "DOWN" and sentiment <= 0)
adjustment  = abs(sentiment_score) * 12 * (1 if aligned else -1)   # ±12pp max
final_conf  = clamp(raw_conf + adjustment, 1, 99)
```

### Interpreting Results
| WF Accuracy | Meaning |
|---|---|
| ≥ 55% | Generalises well — trust the direction |
| 50–55% | Near coin-flip — use as one input among several |
| < 50% | Model failing in current regime — do not act alone |
| < 5 WF rounds | Statistically insufficient — switch to 2y or 3y period |

---

## Model 2 — Intraday 15m Predictor

**File:** `backend/app/services/intraday_predictor.py`
**Bundle:** `models_store/{SYMBOL}_15m.pkl`
**Retrain trigger:** Bundle >24h old or missing new features
**Nightly retrain:** 02:30 via APScheduler

### What it predicts
> Will price be higher in ~1 hour (4 × 15-minute bars)?

- Target: `close[t+4] > close[t]` → binary UP / DOWN
- Horizon: ~60 minutes
- Use case: Intraday entry/exit timing within the daily trend

### Architecture
- **Classifier:** LGBMClassifier (200 estimators, lr=0.05, max_depth=5, num_leaves=25)
- **Scaler:** StandardScaler
- **Train/test split:** 80/20 time-ordered
- **Recency weighting:** `sample_weight = linspace(0.5, 1.0, n_train)`

### Features (29 total)

| Group | Features |
|---|---|
| Momentum | rsi_14 |
| MACD | macd_hist, macd_signal |
| Bollinger Bands | bb_pct, bb_width |
| Trend | ema_diff, ema_slope |
| Returns | ret_1b, ret_4b, ret_8b, ret_16b |
| Volume | volume_ratio, volume_trend |
| Volatility | atr_pct, volatility_8b |
| Intraday context | vwap_deviation, open_range_pos |
| Time encoding | time_sin, time_cos (cyclical 24h) |
| Daily anchor | daily_rsi, daily_ret_1d |
| **Market regime** | **vix_level, vix_change_5d, spy_ret_1d, sector_ret_1d** |
| **Earnings proximity** | **days_to_next_earnings, days_since_earnings, earnings_in_5d** |

### Walk-Forward Validation
- Min training (stocks): 260 bars (~10 trading days)
- Min training (crypto): 500 bars (~5 calendar days)
- Test window (stocks): 52 bars (~2 trading days)
- Test window (crypto): 96 bars (~1 calendar day)
- Typical rounds for stocks with 60d data: **22–25 rounds**

### Data Source
- 15m bars: yfinance (60 days = ~1,500 bars for stocks, ~5,700 for crypto)
- 1d bars: yfinance (3 months, used for daily_rsi, daily_ret_1d, sector/VIX anchoring)

---

## External Intelligence Features

Added in Phase 4 (Feb 2026). Fed into models as training features — not just
used for display. The model **learns** the relationships from historical data.

### Earnings Proximity
Source: `yfinance.Ticker.earnings_dates`

| Feature | Description | Why it matters |
|---|---|---|
| `days_to_next_earnings` | Calendar days to next announcement (cap 30) | Model learns to reduce confidence near earnings |
| `days_since_earnings` | Calendar days since last announcement (cap 90) | Post-earnings drift patterns |
| `earnings_in_5d` | Binary: earnings this week | Strongest signal — model learns that technicals break down within 5 days |

**What the model learns:**
> "When `earnings_in_5d=1` + RSI oversold → don't trust the oversold signal,
> price will react to EPS result, not RSI."

### Market Regime (VIX + SPY + Sector)
Source: `yfinance` via `market_context.py` shared service, 30-min cache

| Feature | Description | Why it matters |
|---|---|---|
| `vix_level` | VIX / 30 (normalised) | High fear = momentum signals less reliable |
| `vix_change_5d` | 5-day VIX % change | Rising fear suppresses bounces |
| `spy_ret_1d` | SPY yesterday's return | Distinguish stock-specific vs macro-driven move |
| `sector_ret_1d` | Sector ETF yesterday's return | Tech selloff affects MSFT/AAPL regardless of their own signals |

**What the model learns:**
> "When VIX spikes + sector ETF down → even a strong RSI oversold signal
> is likely to fail because macro is overwhelmingly bearish."

---

## Planned Improvements (Phase 5+)

See `docs/ROADMAP.md` for full details.

- **WF Diagnostics:** Per-round explanation of why accuracy was low
  (regime analysis from features + earnings flag + SPY context)
- **News sentiment features:** Alpha Vantage API — rolling 1d/5d sentiment
  score as model input (not just display)
- **Economic calendar features:** FMP API — days to Fed meeting, CPI, NFP
- **Probability calibration:** Isotonic regression to fix overconfident
  model outputs (90.7% confidence on a poorly-performing model)
