# SMD — Feature Roadmap

Status of all discussed and implemented features.

---

## ✅ Implemented

### Core Platform
- [x] Markets: US Stocks (NYSE/NASDAQ) + Crypto
- [x] Data source: yfinance (daily + intraday 1h/15m)
- [x] Backend: FastAPI + SQLite (SQLAlchemy async) + APScheduler
- [x] Frontend: React + Vite + Tailwind + TradingView Lightweight Charts v5
- [x] WebSocket live price streaming
- [x] Market scan: 20 stocks + 10 crypto, ranked by signal strength

### Technical Signals
- [x] RSI(14), MACD(12/26/9), Bollinger Bands(20), EMA(20/50)
- [x] Aggregate signal: majority vote → BUY / SELL / HOLD
- [x] ATR-based entry/TP/SL price levels on every scan result
- [x] SignalCard with per-indicator tooltips

### Daily Swing ML (Model 1)
- [x] LightGBM classifier: next-day UP/DOWN direction
- [x] LightGBM regressor: expected move magnitude (%)
- [x] 35 features: technicals + candlestick + market regime + earnings proximity
- [x] Market regime features: SPY 1d/5d/20d, VIX level/change, sector ETF, relative strength
- [x] Earnings proximity features: days_to_next, days_since, earnings_in_5d
- [x] Walk-forward validation: 32 rounds (2y data, 10-day test windows)
- [x] Recency weighting: sample_weight = linspace(0.5, 1.0) — newer data weighted higher
- [x] Sentiment adjustment: ±12pp confidence based on news sentiment
- [x] Default training period: 2y (was 1y — 3 WF rounds insufficient)
- [x] Nightly retrain at 02:00 via APScheduler
- [x] Model cache: `models_store/{SYMBOL}.pkl`, retrain trigger on stale/missing features
- [x] PredictionCard UI: direction, confidence, WF sparkline, training period selector

### Intraday 15m ML (Model 2)
- [x] LightGBM classifier: will price be higher in ~1 hour (4 × 15m bars)?
- [x] 29 features: 15m technicals + VWAP + time encoding + daily anchor + market regime + earnings
- [x] Market regime: vix_level, vix_change_5d, spy_ret_1d, sector_ret_1d (new)
- [x] Earnings proximity: days_to_next_earnings, days_since_earnings, earnings_in_5d (new)
- [x] Walk-forward: 22–25 rounds for stocks (52-bar test windows)
- [x] Recency weighting applied to both main classifier and WF mini-models
- [x] WF bar dates: actual "Feb 20 – Feb 21" labels instead of "~4 days ago" approximation
- [x] Nightly retrain at 02:30 via APScheduler
- [x] IntradayMLBox UI: direction, confidence, WF sparkline with date labels

### Intraday Context Engine (Rule-based)
- [x] 1h RSI gauge with visual arc
- [x] VWAP deviation + position (above/below/at)
- [x] ATR extension (today's move as % of daily average range)
- [x] Volume pulse (today vs 20-day average)
- [x] Time-of-day awareness: OPEN / MID_MORNING / MIDDAY / POWER_HOUR / CLOSE / AFTER_HOURS / 24H_MARKET
- [x] Composite score: −6 to +6 combining all intraday signals
- [x] Combined Verdict: fuses daily ML direction + intraday signal → BUY / SELL / WAIT / NEUTRAL
- [x] Support/resistance from last 24h swings
- [x] Hourly candlestick sparkline
- [x] Manual refresh button + "Updated HH:MM" timestamp
- [x] 2-min stale time (auto-refreshes on tab focus)

### News & Sentiment
- [x] Yahoo Finance RSS (stocks) + Google News RSS (crypto) with 15-min cache
- [x] Keyword-based sentiment scoring: positive/negative word sets
- [x] Per-article score: (pos_hits - neg_hits) / (total + 1) → −1 to +1
- [x] NewsPanel: sentiment bar + article list with badges
- [x] Sentiment used as confidence adjustment in daily ML (±12pp)

### Alerts
- [x] Price above/below threshold
- [x] ML_PREDICT_UP / ML_PREDICT_DOWN (≥70% confidence)
- [x] SIGNAL_BUY / SIGNAL_SELL (aggregate signal flip)
- [x] SENTIMENT_NEGATIVE (news sentiment < threshold)
- [x] PRICE_TARGET
- [x] Evaluation every 60s via APScheduler
- [x] WebSocket broadcast on trigger → in-app toast

### Trades
- [x] Open / close / delete trades
- [x] ATR-based TP/SL auto-calculation
- [x] Auto-scan on symbol entry in Add Trade form
- [x] TP/SL checker every 30 minutes via APScheduler
- [x] Stats bar: total trades, win rate, P&L
- [x] Closed trades table with P&L per trade

### UI & UX
- [x] Portal-based Tooltip (renders in document.body — never clipped by overflow:hidden)
- [x] Viewport-aware: flips above/below + horizontal clamping + arrow tracks trigger center
- [x] Interests page: watchlist symbols with signals + news + Chart/Alert/Trade actions
- [x] Sidebar navigation: Dashboard / Market / Portfolio / Alerts / Trades / Recommendations / Interests
- [x] Dark theme (Tailwind custom palette)

---

## ✅ Recently Implemented

### WF Diagnostics (Phase 4b — complete)
Per-round explanation of *why* accuracy was low. Shown on hover over each WF bar.

**Per-round diagnostic (example):**
```
Round 18 — Feb 10–12  |  Accuracy: 40.4%
Regime:  RSI 35→72 · Vol 2.8×
Market:  SPY −2.3% (selloff)
Event:   ⚠ Earnings week
→ Earnings uncertainty made technicals unreliable.
```

- [x] Regime stats per WF test window: RSI swing, volume ratio from feature DataFrame
- [x] SPY cumulative return per window (spy_ret_1d already in features)
- [x] VIX level (vix_level already in features)
- [x] Earnings flag (earnings_in_5d already in features)
- [x] `wf_diagnostics: list[str]` added to both `PredictionResult` and `IntraPredictionResult`
- [x] `wf_dates: list` added to `PredictionResult` (daily model — was missing, intraday already had it)
- [x] Frontend: diagnostic text appended to WF bar tooltips in `WFSparkline` (PredictionCard) and `IntraWFSparkline` (IntradayPanel)
- [x] Fixed stale tooltip text in daily `WFSparkline` (was incorrectly using "months", now uses actual dates + 10-day windows)

---

## 📋 Planned (Not Started)

### Phase 5 — News as ML Feature (requires Alpha Vantage API)
Feed news sentiment INTO the model, not just display it.

- [ ] Alpha Vantage `NEWS_SENTIMENT` API with `time_from`/`time_to` for historical news
- [ ] New features: `news_sentiment_1d`, `news_sentiment_5d`, `news_volume_spike`
- [ ] Add to both daily and 15m feature sets
- [ ] Expected impact: medium — helps on event-driven days, noisy otherwise

**API cost:** Alpha Vantage free tier (25 req/day dev), $50/mo standard (300 req/min)

### Phase 5 — Economic Calendar Features (requires FMP API)
- [ ] Days to next Fed meeting, CPI release, NFP jobs report
- [ ] `high_impact_event_week` binary feature
- [ ] Add to daily model feature set
- [ ] Expected impact: medium — macro events are the second-biggest cause of model failure after earnings

**API cost:** Financial Modeling Prep free tier (250 req/day), $14/mo premium

### Phase 6 — Probability Calibration
The models are often overconfident (90% confidence on poorly-performing models).
Calibration makes "70% confidence" actually mean "right ~70% of the time."

- [ ] Isotonic regression calibrator fitted on WF test predictions
- [ ] Apply calibration in `predict()` before returning confidence_pct
- [ ] Expected impact: high — removes false certainty, builds user trust

### Phase 6 — SPY Intraday VWAP as 15m Feature
For the intraday model: is SPY itself above/below VWAP right now?
This distinguishes MSFT weakness (stock-specific) from broad market weakness (don't fight tape).

- [ ] Fetch SPY 15m data alongside symbol 15m data in predict endpoint
- [ ] Compute SPY's intraday VWAP deviation per bar
- [ ] Add `spy_intraday_vwap_dev` to FEATURE_COLS_15M
- [ ] Expected impact: high — the single most useful intraday feature missing from the current set

### Phase 7 — Real-time Auto-Refresh
- [ ] `refetchInterval` on intraday ML prediction during market hours
- [ ] Session window check: only auto-refresh 9:30am–4:00pm ET (stocks)
- [ ] Crypto: 24/7 refresh at 30-min interval

### Phase 7 — Alert Email Notifications
- [ ] SMTP integration for triggered alert emails
- [ ] User email settings in profile page
- [ ] Currently: in-app WebSocket toast only

### Phase 8 — Live P&L on Trades Page
- [ ] WebSocket feed on Trades page for open positions
- [ ] Live unrealized P&L updating every 30s
- [ ] Currently: static entry price shown

### Phase 8 — Scanner Symbol Fix
- [ ] Replace POL-USD with AVAX-USD or MATIC-USD in default scanner list
- [ ] POL-USD has no data in current data source

---

## Architecture Decisions (Record)

| Decision | Choice | Reason |
|---|---|---|
| Data source | yfinance | Free, supports daily + intraday 1h/15m, no auth |
| ML library | LightGBM | Fast, handles mixed feature types, feature importance |
| DB | SQLite via SQLAlchemy async | Zero-config, sufficient for single-user dashboard |
| Scheduler | APScheduler embedded in FastAPI | No Redis/Celery needed |
| WF test window | 10 days (daily) / 52 bars (15m) | More rounds → better statistics |
| Training period default | 2y | 32 WF rounds vs 3 with 1y |
| Recency weighting | linspace(0.5, 1.0) | Adapts to recent regime without discarding history |
| Earnings data | yfinance.Ticker.earnings_dates | Free, includes future estimated dates |
| Market context cache | 30-min in-memory | Avoids redundant downloads during same training run |
