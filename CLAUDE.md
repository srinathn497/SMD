# Project Memory

---
## Session: 2026-09-09 (Recommendation scan "takes forever" — root cause: retrain trigger permanently ON)

### Root cause
- `ml_predictor.predict()` retrain trigger checked `b["features"]` for feature
  **names** (`yield_curve`, `regime_bull`, `eps_surprise_pct`, `sma_50_dist`).
  The **auto-prune step** (added later, undocumented) legitimately drops
  low-importance features from the saved list, and several of those names are
  1W-only / get pruned — so **every bundle, even one trained seconds ago,
  reported stale → full retrain on every predict() call.**
- Effect: conviction scan retrained the whole universe on every run, never
  finished inside `_SCAN_TIMEOUT`, then discarded everything (`rows = []`).
  Leaderboard frozen at 2026-06-05 for ~3 months.
- Machine is off overnight so the 02:00 retrain cron never fires — user runs
  things manually.

### What changed
- **`ml_predictor.needs_retrain(symbol, period)`** — new public method, single
  source of truth. Checks: file exists · `.pkl` mtime < `_MAX_BUNDLE_AGE_DAYS`
  (30) · `bundle_version >= BUNDLE_VERSION` (new stamp = 5) · training_period ·
  **structural keys** only (`classifier_xgb`, `features_1d/1w`, `scaler_1d`,
  `wf_diagnostics`, `calibrator_bull`). **No feature-name checks** — that was
  the bug. `train()` now stamps `bundle_version`.
- **`app/services/model_refresh.py`** — new. `run_model_refresh(extra, force)` +
  `get_refresh_status()`. Retrains only stale bundles (`needs_retrain`), unless
  `force`. `Semaphore(2)` (box is RAM-tight — 16 GB, always ~15 G used),
  `to_thread(train)`, 15-min/symbol ceiling, live progress dict.
  - **Do NOT run standalone training scripts while this job runs** — doubled
    load on the constrained box caused a mass-failure run (110/113 failed).
    At concurrency 2 alone it's healthy.
- **API**: `POST /conviction/refresh-models?force=` · `GET
  /conviction/refresh-models/status`.
- **Frontend**: "Refresh Models" button beside "Scan" in `ConvictionLeaderboard`
  (`Cpu` icon) + progress banner. Hooks `useModelRefreshStatus` /
  `useTriggerModelRefresh`. Scan ↔ Refresh are mutually disabled.
- **`compute_conviction(..., allow_training=False)`** — new param. Bulk scan
  passes `False`: stale-model symbols get the ML signal **skipped** ("model
  needs refresh — run Refresh Models") instead of retraining inline. On-demand
  analyzers (`signals.py`, `playbook_service.py`) keep `True`.
- **`run_conviction_scan()` timeout fix** — `asyncio.wait(tasks, timeout)` then
  commit the `done` set + cancel `pending`. A timeout now **saves completed
  results** instead of discarding the whole scan. Tasks are `create_task`-wrapped.
- **`conviction_scanner` pred-log block** — uses `needs_retrain()` (was a bare
  `.pkl` exists check that missed stale bundles).
- **`main.py` `_catchup()`** — startup no longer auto-runs the conviction scan
  when the cache is stale (fired on every boot, against a stale model universe,
  burning CPU). Logs a "run Refresh Models then Scan" hint instead. Trade-ideas
  + backtest catch-up unchanged.

### Workflow now
After the machine's been off a while: **Recommendations tab → "Refresh Models"**
(background, ~60–90 min for full universe, safe to leave) → then **"Scan"**
(fast, ~4–8 min, because every `predict()` now hits a fresh bundle).

### Undocumented pipeline drift found (now recorded)
`ml_predictor.train()` is heavier than older CLAUDE.md entries say: **LGBM + XGB
blended ensemble** per horizon, **walk-forward validation on every train**, and
**auto-prune-and-refit** (`_prune_features` → drop low-importance cols → retrain).
Bundle keys added since: `classifier_xgb`, `wf_diagnostics`, `calibrator_bull/
bear/neutral`, `features_1d/1w`, `scaler_1d/1w`, `pruned_1d/1w`, `importances_*`,
`bundle_version`.

### Files changed
- `backend/app/services/ml_predictor.py` — `BUNDLE_VERSION`,
  `_MAX_BUNDLE_AGE_DAYS`, `needs_retrain()`, `train()` version stamp, `predict()`
  trigger simplified
- `backend/app/services/model_refresh.py` — new
- `backend/app/api/v1/conviction.py` — refresh endpoints + schema
- `backend/app/services/conviction.py` — `allow_training` param
- `backend/app/services/conviction_scanner.py` — `allow_training=False`,
  `needs_retrain` in pred-log, `asyncio.wait` timeout fix
- `backend/app/main.py` — `_catchup()` no longer auto-scans
- `frontend/src/api/conviction.js` — 2 new hooks
- `frontend/src/components/signals/ConvictionLeaderboard.jsx` — Refresh Models button

### Open items
- `retrain_all_job()` / `retrain_intraday_job()` (main.py) still call `train()`
  without `to_thread` — only the dead 02:00/02:30 cron reaches them. Fix if cron
  is ever relied on.
- News weighting plan (2026-09-05, in `tasks/todo.md`) — not started; FinBERT
  ruled out (PC RAM). Direction: GDELT tone history + VADER live scorer.

---
## Session: 2026-04-17 (Fundamentals as ML Features + Interests Fix)

### What changed
- Rejected FinLLaMA (8GB RAM, wrong tradeoff) and FinBERT (staleness > accuracy bottleneck)
- Paused all sentiment improvements — ±12pp adjustment is good enough
- Added `eps_surprise_pct` and `revenue_growth_yoy` as ML features (now 47 features)
- Fixed nightly conviction scan — watchlist-only symbols were never getting prediction history logged

### Key decisions
- **EPS surprise**: `(actual − estimate) / |estimate|`, clipped ±2, forward-filled quarterly from `ticker.earnings_dates`
- **Revenue growth**: YoY `pct_change(4)` on `quarterly_income_stmt`, clipped [−1, 5], forward-filled
- **Crypto**: returns zeros for both — no earnings data
- **`_align()` pattern**: `series.reindex(stock_dates.union(series.index)).ffill().reindex(stock_dates)` — handles earnings on non-trading days
- **Bug**: Nightly cron called `run_conviction_scan()` with no `extra` — only default 50 symbols logged. Fix: `conviction_scan_job()` wrapper in `main.py` loads watchlist and passes as `extra`

### Files changed
- `backend/app/services/market_context.py` — `get_fundamentals()` + `_FUNDAMENTALS_CACHE`
- `backend/app/services/ml_predictor.py` — 2 new features in `FEATURE_COLS`, call `get_fundamentals()`, retrain trigger
- `backend/app/main.py` — `conviction_scan_job()` replaces bare lambda at 06:00 cron

### Open items
- **Tier 2**: FCF ±1 conviction point, P/E percentile rank ±1, D/E > 2 hard cap — not implemented
- **Tier 3**: Trade gate — block Open Trade if D/E > 3 or negative FCF — not implemented
- **POL-USD**: Replace with AVAX-USD in DEFAULT_STOCKS
- **Alert email notifications**: Not implemented
- **Live unrealized P&L on Trades page**: Static, no WebSocket
- **Auto-refresh intraday ML during market hours**: `refetchInterval` not added
- **Phase 8A (Options Flow)**: Plan exists, not started

---
## Session: 2026-05-01 (New Conviction Signals + Market Redesign + Fundamentals + Risk Dashboard)

### What changed
- Fixed blank webpage caused by two stale Vite processes on ports 5173/5174
- Updated `start-frontend.sh` and `start-backend.sh` to `pkill` stale processes before restarting
- Added Signal 12 (Breakout+Momentum): 20d rolling high/low breakout + volume surge + MA20 trend filter
- Added Signal 13 (Mean Reversion): Z-score on 20d window — buy at ≤ -2.0, sell at ≥ +2.0
- Added Signal 14 (Fundamental Health): BUY if health_score ≥ 5, SELL if ≤ 2
- Stocks now score 14 signals total; crypto scores 9
- Direction vote now uses 7 opinions (added breakout, zscore, fundamentals) — ties far rarer
- Built new `fundamental_service.py` with 6h in-memory cache, 6-criteria health scoring
- Added `GET /api/v1/fundamentals/{symbol}` endpoint wired into `main.py`
- Full `Market.jsx` redesign: HeroQuoteBar with live price flash + directional gradient, two-column layout
- New `FundamentalCard.jsx`: health ring, score bar, expandable valuation/growth/balance/profitability/analyst sections
- New `MarketHeatmap.jsx` on Dashboard: colour-coded tiles by daily %change, live prices, conviction badges
- Built `risk_service.py`: VaR 95% (historical simulation), Sharpe, Sortino, Max Drawdown, Beta vs SPY, correlation matrix, per-holding breakdown, concentration metrics
- Added `GET /api/v1/portfolio/risk` endpoint using `asyncio.to_thread` + `dataclasses.asdict`
- Built `RiskDashboard.jsx`: VaR hero card, 6 stat cards, concentration bars, holdings risk table, N×N correlation heatmap
- Wired `RiskDashboard` into `Portfolio.jsx` between HoldingsTable and TransactionHistory

### Key decisions
- **Breakout signal**: BUY = close > prev 20d high AND vol ≥ 1.2× 20d avg AND price > MA20; SELL = close < prev 20d low AND vol ≥ 1.2× AND NOT slope_up
- **Mean reversion signal**: Z = (close − 20d mean) / 20d std; thresholds ±2.0 — contrarian signal
- **Fundamental conviction gate**: health_score from `fundamental_service` (0–6 criteria) — only fires for stocks
- **D/E normalization**: yfinance returns `debtToEquity` as a percent (e.g. 42 = 0.42 ratio) — divide by 100
- **asyncio.gather** in conviction now fetches 7 items including `asyncio.to_thread(get_fundamentals, symbol)`
- **Risk serialization**: `dataclasses.asdict()` used explicitly — handles nested `HoldingRisk` + `CorrelationPair` lists
- **Correlation color**: red = correlated (bad, low diversification), green = uncorrelated (diversified)
- **VaR computation**: historical simulation (5th percentile of daily log-return distribution × NAV)
- **Risk staleTime**: 5 minutes on frontend — yfinance 1-year download doesn't need more frequent refresh

### Files changed
- `backend/app/services/conviction.py` — signals 12, 13, 14; 7-opinion direction vote; asyncio.gather extended
- `backend/app/services/fundamental_service.py` — new; 6h cache, health scoring, analyst consensus
- `backend/app/services/risk_service.py` — new; full risk metrics computation
- `backend/app/api/v1/fundamentals.py` — new; `GET /api/v1/fundamentals/{symbol}`
- `backend/app/api/v1/portfolio.py` — added `GET /api/v1/portfolio/risk`
- `backend/app/main.py` — included fundamentals router
- `frontend/src/pages/Market.jsx` — full rewrite; HeroQuoteBar, ChartCard, two-column layout
- `frontend/src/components/signals/FundamentalCard.jsx` — new
- `frontend/src/components/dashboard/MarketHeatmap.jsx` — new
- `frontend/src/components/portfolio/RiskDashboard.jsx` — new
- `frontend/src/api/fundamentals.js` — new; `useFundamentals` hook, 6h staleTime
- `frontend/src/api/portfolio.js` — added `useRisk` hook, 5-min staleTime
- `frontend/src/pages/Portfolio.jsx` — added RiskDashboard
- `start-frontend.sh` / `start-backend.sh` — added pkill stale-process guards

### Open items (carried forward)
- **Tier 2 conviction**: FCF ±1 point, P/E percentile rank ±1, D/E > 2 hard cap — not implemented
- **Tier 3 trade gate**: block Open Trade if D/E > 3 or negative FCF — not implemented
- **POL-USD → AVAX-USD**: Replace in DEFAULT_STOCKS
- **Alert email notifications**: Not implemented
- **Live unrealized P&L on Trades page**: Still static, no WebSocket
- **Auto-refresh intraday ML during market hours**: `refetchInterval` not added to intraday hook
- **Phase 8A (Options Flow)**: Plan exists, not started

---
## Session: 2026-04-07 (Accuracy Improvements + Prediction History Redesign)

### What changed
- Diagnosed 44% accuracy as April 2 Liberation Day tariff shock (systematic UP bias during -10% crash)
- Fixed duplicate yfinance index bug that zeroed all macro features during conviction scan
- Regime-aware isotonic calibration: 3 calibrators (bull/bear/neutral), min 15 samples each
- `class_weight="balanced"` on all LGBMClassifiers to fix UP bias
- Added `hc_accuracy_pct` (≥60% confidence subset) to accuracy summary
- Redesigned prediction history tab: 3-section layout (accuracy card, today's calls grid, track record)
- Fixed smart populate — was re-populating all Interests symbols on every mount

### Key decisions
- **Regime thresholds**: BULL = SPY 20d > +3%, BEAR < −3%, else neutral
- **Calibrator fallback chain**: regime-specific → global → raw LightGBM
- **bundle keys**: `calibrator_bull`, `calibrator_bear`, `calibrator_neutral`, `calibrator` (global)
- **React scope bug pattern**: sub-components defined outside parent can't close over parent state — must pass callbacks as explicit props (`onSymbolClick` threaded through `DateGroup` → `SymbolRow`)
- **Smart populate**: check `alreadyLogged = new Set(rows.filter(r => r.logged_date === TODAY)...)` before calling populate

### Files changed
- `backend/app/services/ml_predictor.py` — dedup index, balanced weights, 3 regime calibrators, `regime` in predict result
- `backend/app/services/prediction_log_service.py` — `hc_accuracy_pct` in accuracy summary
- `backend/app/api/v1/prediction_history.py` — extended `AccuracySummaryOut` schema
- `frontend/src/components/signals/PredictionHistoryTab.jsx` — full rewrite, 3-section layout
- `frontend/src/components/signals/PredictionCard.jsx` — CAL badge shows regime (CAL-BEAR/CAL-BULL/CAL)

---
## Architecture & Standing Decisions

### Stack
- **Backend**: Python 3.13, FastAPI, SQLite (SQLAlchemy async), APScheduler embedded
- **Frontend**: React + Vite + Tailwind + TradingView Lightweight Charts v5 + TanStack Query v5
- **ML**: LightGBM (daily swing) + LightGBM (15m intraday) — two independent models per symbol
- **Data**: yfinance (all intervals — daily, 1h, 15m) — NOT Stooq (early sessions used Stooq, switched back)
- **Runs 100% locally** — no cloud, no paid APIs, no Redis

### ML model (daily)
- **47 features**: OHLCV technicals + market context (SPY/VIX/sector) + macro (yield curve, DXY, credit spread) + earnings proximity + regime one-hot + options-proxy vol + `eps_surprise_pct` + `revenue_growth_yoy`
- **3 horizons per symbol**: 1d (WF_TEST=10), 1w (WF_TEST=5), 1m (WF_TEST=21) — separate classifiers, shared scaler
- **Calibration**: isotonic regression on WF held-out predictions; regime-aware (bull/bear/neutral)
- **Sentiment**: ±12pp confidence adjustment at predict time (not a training feature)
- **Bundle**: single `.pkl` per symbol in `backend/models_store/` — retrain triggers on missing keys
- **Retrain trigger check**: `"eps_surprise_pct" not in feats` (latest guard — catches all prior bundles)

### ML model (15m intraday)
- **22 features**: 15m RSI/MACD/BB/EMA, returns, volume, ATR, VWAP deviation, time sin/cos, daily RSI/ret
- **Target**: `close[t+4] > close[t]` (1 hour ahead)
- **Bundle**: `{SYMBOL}_15m.pkl`, 24h cache, retrain at 02:30 nightly

### Nightly schedule
- **02:00** — retrain all daily ML models (default 50 + watchlist)
- **02:30** — retrain all 15m models
- **06:00** — conviction scan (default 50 + watchlist) → also logs 1d/1w predictions to `prediction_log`
- **07:00** — resolve pending predictions with actual close prices

### Key gotchas
- **Zombie backend**: `pkill -f "uvicorn app.main" && sleep 2` before restart — old process stays on port 8000
- **React Query v5**: `isPending` = first load only; `isFetching` = any in-flight (use for refresh spinners)
- **LW Charts v5**: `chart.addSeries(CandlestickSeries, opts)` not `addCandlestickSeries()`
- **yfinance duplicate index**: some tickers return duplicate dates — fix: `df = df[~df.index.duplicated(keep="last")]` at top of `_build_features()`
- **Tailwind JIT + dynamic classes**: use inline hex for SVG stroke, not dynamic `stroke-{color}` classes
- **brand color = green** (`#22c55e`) — don't use for neutral/info styles
- **Python venv**: `/Users/snagalla/SMD/backend/.venv/` — recreate with `/opt/homebrew/bin/python3.13 -m venv .venv` if Homebrew upgrades Python
- **LightGBM on macOS ARM**: requires `brew install libomp`

### Conviction scoring
- 7 signals: daily ML, 15m ML, intraday context, technical, news sentiment, volume, relative strength
- Score 0/7 → NEUTRAL, 1-3 → WEAK, 4-5 → MODERATE, 6-7 → HIGH_CONVICTION
- Score forced to 0 when direction = NEUTRAL (no majority)
- `conviction_cache` table in SQLite — upsert via `session.merge()`
- Nightly scan at 06:00 now includes watchlist symbols via `conviction_scan_job()`

### Pages / routes
`/` Dashboard · `/market` Chart + signals · `/recommendations` Scanner + Conviction Leaderboard · `/trades` Trade journal · `/interests` Watchlist + prediction history · `/portfolio` Holdings · `/alerts` Alerts

---
## Session: 2026-05-01 (Tier 2 Conviction Signals + Auto-Accept Permissions)

### What changed
- Added Signal 15 (FCF Yield): BUY if FCF Yield >3%, SELL if <0%, neutral 0–3% — stocks only
- Added Signal 16 (Debt/Equity): SELL if D/E >2.0 (high leverage), BUY if <0.5 (conservative) — stocks only
- Added Signal 17 (P/E Valuation): BUY if P/E <15× (value), SELL if >40× (speculative) — stocks only
- Stocks now score 17 signals total (up from 14); crypto stays at 9
- All three new signals reuse the already-fetched `fund_result` from `asyncio.gather` — zero performance impact
- Created `/Users/snagalla/SMD/.claude/settings.json` to auto-accept Read/Edit tool calls for the SMD project

### Key decisions
- **Signal 15 FCF Yield**: uses `fund_result.fcf_yield_pct`; >3% = BUY, <0% = SELL, else neutral (no opinion)
- **Signal 16 D/E**: uses `fund_result.debt_to_equity`; >2.0 = SELL, <0.5 = BUY, 0.5–2.0 = neutral
- **Signal 17 P/E**: uses `fund_result.pe_ratio`; only fires when `pe > 0` (skips negative/no-earnings); <15× = BUY, >40× = SELL
- **`_sig()` with `None` opinion**: signals with `None` opinion don't contribute a vote but still appear in the signal list for transparency
- **`max_score = len(scored)`**: dynamically computed — correctly becomes 17 for stocks, 9 for crypto without hardcoding
- **settings.json hot-reload**: Claude Code does NOT hot-reload `settings.json` mid-session — a full restart is required for permissions to take effect

### Files changed
- `backend/app/services/conviction.py` — Signals 15, 16, 17 appended after Signal 14 block
- `.claude/settings.json` — new; grants auto-accept for `Read(/Users/snagalla/SMD/**)` and `Edit(/Users/snagalla/SMD/**)`

### Open items (carried forward)
- **Tier 3 trade gate**: warn/block when opening a trade if D/E >3 or FCF is negative — not yet implemented (next priority)
- **Conviction docstring**: module docstring still says "13 signals" — needs update to "17 signals"
- **POL-USD → AVAX-USD**: Replace in DEFAULT_STOCKS
- **Alert email notifications**: Not implemented
- **Live unrealized P&L on Trades page**: Still static, no WebSocket
- **Auto-refresh intraday ML during market hours**: `refetchInterval` not added
- **Phase 8A (Options Flow)**: Plan exists, not started

---
## Session: 2026-05-02 (Tier 3 Trade Gate)

### What changed
- Implemented Tier 3 risk gate in `AddTradeModal` inside `Trades.jsx`
- After auto-scan, fundamentals are fetched for stocks (D/E + FCF Yield) using the already-cached `/api/v1/fundamentals/{symbol}` endpoint
- If D/E > 3.0 OR FCF Yield < 0: a red warning banner appears in the modal listing each concern
- The "Open BUY/SELL" button is disabled until the user ticks "I understand the risks and want to proceed"
- Fundamentals failure silently ignored — never blocks a trade if data is unavailable
- Warning resets on every new symbol scan or symbol text change

### Key decisions
- **Frontend-only**: no backend schema change — fundamentals are already server-cached 6h, zero extra latency
- **Thresholds**: D/E > 3.0 (stricter than conviction signal's 2.0) and FCF Yield < 0 (same as conviction)
- **Non-destructive gate**: warning + checkbox, not a hard block — user can always override with acknowledgment
- **`fetchFundamentals` as imperative call**: used inside `handleSymbolBlur` async handler, not as a React Query hook, since it's event-driven and must run after the scan resolves

### Files changed
- `frontend/src/pages/Trades.jsx` — added `AlertTriangle` import, `fetchFundamentals` import, `fundWarning`/`riskAcknowledged` state, risk-check block in `handleSymbolBlur`, warning banner UI, gated submit button

### Open items (carried forward)
- **Conviction docstring**: still says "13 signals" — needs update to "17 signals"
- **POL-USD → AVAX-USD**: Replace in DEFAULT_STOCKS
- **Alert email notifications**: Not implemented
- **Live unrealized P&L on Trades page**: Still static, no WebSocket
- **Auto-refresh intraday ML during market hours**: `refetchInterval` not added
- **Phase 8A (Options Flow)**: Plan exists, not started

---

## Session: 2026-05-05 (Tooltips + Live P&L + Smart Money Scanner)

### What changed
- Added tooltips to **Trade Ideas page** — 9 tooltips covering conviction label, signal score bar, entry zone, Stop/T1/T2 levels, R:R ratio, position size, and invalidation row
- Implemented **Live Unrealized P&L on Trades page** — open trade cards now subscribe via WebSocket, show animated live dot, live price, and real-time P&L ($ and %) with green/red tinted background; ProgressBar now moves with live price
- Built **Smart Money Scanner** (Phase 8A) — new `/smart-money` page and backend service combining options flow + volume surge signals
- Added tooltips to **Smart Money page** — 14 tooltips on column headers, score bar, P/C ratio, IV%, surge ratio, ACCUMULATION/DISTRIBUTION, VWAP badge, max pain %, and all 4 summary stat cards
- Fixed tooltip overlap/clipping bug on both pages — switched from CSS `group-hover` absolute positioning to JS `position:fixed` with mouse tracking

### Key decisions
- **Tooltip fix**: `position: fixed` + `onMouseMove` coordinates — escapes `overflow-x-auto` tables and `overflow-hidden` cards; no React portal needed
- **Live P&L**: frontend-only — `useWebSocket(openSymbols)` in `Trades` feeds `useMarketStore.livePrices`; `livePrice` prop to `OpenTradeCard`; falls back to `entry_price` before first WS tick
- **Smart Money scoring**: −4 to +4 from 4 conditions — P/C vol ratio, IV skew, max pain distance, volume surge × VWAP position; `options_service.py` reused (30-min cache)
- **Smart Money auto-refresh**: `refetchInterval: 3 * 60 * 1000` — React Query polling, no extra WS connection needed

### Files changed
- `frontend/src/pages/TradeIdeas.jsx` — Tooltip component (fixed positioning), 9 tooltips, card `overflow-hidden` replaced with `border-t-2`
- `frontend/src/pages/Trades.jsx` — `useWebSocket` + `useMarketStore` wired in, live P&L hero row, ProgressBar uses `currentPrice`
- `frontend/src/pages/SmartMoney.jsx` — new; table layout, filter tabs, summary stats, open trade modal, 14 fixed-position tooltips
- `frontend/src/api/smartMoney.js` — new; `useSmartMoney` hook, 3-min staleTime + refetchInterval
- `frontend/src/App.jsx` — SmartMoney route added
- `frontend/src/components/layout/Sidebar.jsx` — Smart Money nav link (Zap icon)
- `backend/app/services/smart_money_service.py` — new; scoring engine, `scan_smart_money()` async concurrent scan
- `backend/app/api/v1/smart_money.py` — new; `GET /api/v1/smart-money`
- `backend/app/main.py` — smart_money router registered

### Smart Money signal scoring
| Condition | Score |
|---|---|
| P/C vol ratio < 0.7 (call sweep) | +1 |
| P/C vol ratio > 1.5 (put sweep) | -1 |
| IV skew < −5pp (unusual call demand) | +1 |
| IV skew > +10pp (fear premium) | -1 |
| Max pain > +2% above price | +1 |
| Max pain < −2% below price | -1 |
| Volume surge ≥ 2× AND above VWAP | +1 |
| Volume surge ≥ 2× AND below VWAP | -1 |
Score ≥3 = STRONG_BUY · 1–2 = BUY · 0 = NEUTRAL · −1 to −2 = SELL · ≤−3 = STRONG_SELL

### Open items (carried forward)
- **Conviction docstring**: still says "13 signals" — needs update to "17 signals"
- **POL-USD → AVAX-USD**: Replace in DEFAULT_STOCKS
- **Alert email notifications**: Not implemented
- **Auto-refresh intraday ML during market hours**: `refetchInterval` not added to intraday hook
- **Double-confirmed badge**: Trade Ideas page badge when Smart Money + conviction both agree — not yet built
- **Phase 8A extended**: Smart Money scanner built; insider flow (SEC Form 4) not started

---

## Master Open Items — Complete Backlog (as of 2026-06-11)

### Quick Fixes (< 30 min each)
- [ ] POL-USD → AVAX-USD in DEFAULT_STOCKS
- [ ] Conviction module docstring: "13 signals" → "17 signals"

### ML Accuracy Improvements (Batch 3)
- [x] Per-symbol accuracy tracking — `by_symbol` in accuracy API; collapsible "By Symbol" table in AccuracyCard with min-calls filter (5/10/20) and ★HC accuracy column
- [x] Feature importance pruning — DONE (found already implemented 2026-09-09): `_prune_features` drops low-importance cols per horizon then refits (`pruned_1d`/`pruned_1w` in bundle). NOTE: this silently broke the `predict()` retrain trigger for ~3 months — see 2026-09-09 session.
- [x] Separate 1D vs 1W feature sets — DONE: `FEATURE_COLS_1D` (35) / `FEATURE_COLS_1W` (48), separate scalers, lazy retrain trigger

### Features
- [x] Auto-refresh intraday ML during market hours — already implemented via `marketRefetch()` in signals.js
- [x] Double-confirmed badge — Trade Ideas: violet `⚡ Smart + Conviction` badge + violet top border when HIGH_CONVICTION + Smart Money agree
- [ ] Alert email notifications — send email when a price alert triggers (needs SMTP config)
- [ ] Insider flow / SEC Form 4 — Phase 8A extension: institutional buying signals

### UI Redesign + Mobile + App Store (Major Initiative)
**Vision**: Eye-catching, modern, stylish trading app. Charts and graphs throughout. Mobile-first layout.
**Goal**: Deploy to iOS App Store (and optionally Google Play) via Capacitor.

- [ ] Full UI redesign — modern dark theme, richer data visualisations, polished cards, smooth animations
- [ ] Mobile-first layout — bottom tab bar navigation, touch-friendly targets, portrait-optimised pages
- [ ] Capacitor integration — wrap React app as a native iOS/Android app
- [ ] Push notifications — replace email alerts with native mobile push
- [ ] App Store submission — signing, provisioning, screenshots, privacy policy, App Store Connect

---

## Session: 2026-06-11 (Separate 1D/1W Feature Sets)

### What changed
- Implemented separate feature sets and scalers for 1D vs 1W ML classifiers in `ml_predictor.py`
- `FEATURE_COLS_1D` (35 features): short-term momentum, candlestick patterns, 5d market context
- `FEATURE_COLS_1W` (48 features): trend + structural + macro + fundamental signals
- Each horizon now trains with its own `StandardScaler` (`scaler_1d`, `scaler_1w`)
- `predict()` uses horizon-specific features/scaler when building the classifier input row
- Regressor always uses 1D features (it predicts next-day magnitude regardless of horizon)
- Added `"features_1d" not in b` to retrain trigger — all 208 existing bundles auto-retrain on next use
- Bundle now stores: `features_1d`, `scaler_1d`, `features_1w`, `scaler_1w` + backward-compat aliases `features`/`scaler`

### Key decisions
- **1D-only features**: `gap_open`, `upper_shadow`, `lower_shadow` — intraday microstructure, noise at weekly horizon
- **1W-only features**: `ret_10d/20d`, `volatility_20d`, `dist_52w_high/low`, `spy_ret_20d`, `rs_vs_spy_20d`, full earnings calendar (`days_to_next/since_earnings`), macro (`yield_curve`, `dxy_ret_5d`, `credit_spread`), fundamentals (`eps_surprise_pct`, `revenue_growth_yoy`), `sma_50_dist`, `sma_200_dist`
- **32 shared features**: RSI, MACD, BB, EMA, volume, ATR, VIX, SPY 1d/5d, sector, regime, options-proxy vol
- **`FEATURE_COLS` union superset kept** for `_build_features()` — it still builds all 51 columns; horizon subsets are selected at train/predict time
- **Lazy retrain**: old bundles retrain on first `predict()` call; nightly 02:00 cron retrains all overnight
- **No frontend changes needed** — `features_used` in `PredictionResult` now reports horizon-specific count

### Files changed
- `backend/app/services/ml_predictor.py` — `FEATURE_COLS_1D`, `FEATURE_COLS_1W` constants; `train()` separate scalers/features per horizon; `predict()` horizon-specific row building; retrain trigger updated; bundle format extended

### Open items (updated)
- [x] Separate 1D vs 1W feature sets — DONE
- [x] Feature importance pruning — DONE (see 2026-09-09 session)
- [ ] Alert email notifications
- [ ] Insider flow / SEC Form 4
- [ ] Full UI redesign + Mobile + App Store

---
## Session: 2026-07-03 (Market Tab Design System v2 + Event-Loop-Blocking Bug Fix)

### What changed
- **v1 pass (superseded)**: first redesigned Market.jsx with a "dark neon fintech" look — glow shadows, `neon.violet`/`neon.cyan` tokens, grid/glow page background. Verified working, but superseded same session.
- User is planning to productionize SMD as a paid product and wants a *real design system* (shared components), not more page-by-page CSS — this session built Wave 1 of that, piloted on the Market tab.
- User found a reference design export (`~/Downloads/Market Tab.html`, a self-extracting bundle) and asked to keep our content but adopt its style. Rendered it with Playwright and read the computed DOM styles directly (not guessed) to extract exact tokens.
- Built two static HTML mockups (`market_mockup.html` v1 neon, `market_mockup_v2.html` matching the reference) and got explicit sign-off ("go ahead") before writing any real component code.
- **New shared primitives** in `frontend/src/components/ui/`: `Badge.jsx` (tone=bullish/bearish/neutral/warning + `toneFromSignal()` helper), `SegmentedControl.jsx` (variant=neutral/solid/tint, `wrap` mode), `ExpandableSection.jsx` (trigger can be a node or `(open) => node` render-prop), `Ring.jsx` (circular score/progress, replaces two duplicated SVG ring implementations).
- **Migrated to v2 style + new primitives**: `Market.jsx` (hero, chart toggle, right-panel tab bar — now wraps to 2 rows instead of truncating labels), `ConvictionBadge.jsx`, `FundamentalCard.jsx`, `OptionsFlowPanel.jsx`, `PredictionCard.jsx` (badge + ModelInsights only), `SignalCard.jsx`, `NewsPanel.jsx`, `IntradayPanel.jsx` (time-of-day badge only), `VolumeHistoryCard.jsx` (dropped its own inline tooltip for the shared one), `CandlestickChart.jsx` (chart chrome colors), `ui/Tooltip.jsx` (hardcoded hex colors were stale after the token swap).
- Fixed the tab-truncation bug from the v1 verification pass ("Fundame…", "Options F…", "ML & For…") — right-panel tab bar now wraps instead of truncating.
- **User reported the page loading very slowly after the redesign** — traced to a real, pre-existing backend bug, unrelated to the CSS/JSX changes: `intra_predictor.predict()` / `ml_predictor.predict()` (both of which can trigger a full synchronous LightGBM retrain) were called directly inside `async def` functions in 4 places without `asyncio.to_thread`, blocking the entire single-threaded event loop for the whole training duration — explained why even `/docs` had gone fully unresponsive.
- Fixed all 4 blocking call sites (see Key decisions). Proved the fix by deleting GOOGL's `_15m.pkl` bundle to force a real ~20s retrain, then polling `/docs` every second during it — stayed at ~1ms throughout (previously would have hung for the full duration).
- Also fixed a pre-existing button-in-button DOM nesting bug in `IntradayPanel.jsx` (found via a React console warning during verification) and bumped the conviction scanner's per-symbol timeout 90s → 150s (a single cold retrain alone took ~20s; a symbol can need two trainings plus 5 more concurrent signal fetches under `Semaphore(3)`).

### Key decisions
- **v2 design tokens** (`tailwind.config.js`): `brand.500` #22c55e → **#35d07f** (softer green), `dark.900/800/700/600` → **#090d15/#111826/#1c2436/#28334a** (near-black layered navy, was slate-blue), new `bad.500` #ef6a6a (bearish) and `warn.500` #e8b84b (warning) — semantic colors, not a remap of Tailwind's built-in `red`/`yellow` (those are still used untouched elsewhere in the app). Removed the v1 `neon.*` and `glow-*` boxShadow tokens (no longer used). Added `fontFamily.sans = Space Grotesk`, `fontFamily.mono = IBM Plex Mono` (loaded via Google Fonts `<link>` in `index.html`).
- **`.card` in `index.css`**: flat layered-navy gradient + thin border, no backdrop-blur/glow (matches reference's quieter aesthetic vs. v1's neon glow).
- **Scope calls — kept content unchanged rather than force-fitting new primitives**:
  - `PredictionCard`'s period/horizon selectors stay hand-rolled — they have per-option tooltips `SegmentedControl` doesn't support.
  - `IntradayPanel`'s `SIGNAL_CFG`/`ACTION_CFG` badges (5-state intensity gradient + a distinct purple "take profits" meaning) stay bespoke — collapsing to 4 flat `Badge` tones would lose real information. Only its single time-of-day badge (binary caution/ok) was migrated.
  - `SignalBadge.jsx` was **not deleted** — `Dashboard.jsx` and `SmartMoney.jsx` still import it; only `SignalCard.jsx`'s own usage moved to the new `Badge`.
- **Root-cause pattern for the perf bug**: any synchronous `.predict()` call that can trigger ML training must be wrapped in `await asyncio.to_thread(fn, *args, **kwargs)` — `conviction.py`'s daily-ML call already did this correctly (with a comment explaining why); the fix was applying the same proven pattern to the 3 other call sites (`conviction.py:202` intraday, `signals.py:86` predict route, `signals.py:119` intraday-predict route, `alert_engine.py:107` alert checker).
- **Verification tooling**: system default Node is v14 (can't run Playwright) — use `nvm use 18` first, Playwright installed locally in the session scratchpad dir (not a project dependency).
- **Mockup-before-code**: user explicitly wants a rendered static HTML mockup (matching real token values, sent via file delivery) before any real component work on visual/layout tasks — saved as a standing preference.

### Files changed
- `frontend/index.html` — Google Fonts links (Space Grotesk, IBM Plex Mono)
- `frontend/tailwind.config.js` — v2 color tokens, font families (see Key decisions)
- `frontend/src/index.css` — `.card`, body background, `.ticker-num`
- New: `frontend/src/components/ui/Badge.jsx`, `SegmentedControl.jsx`, `ExpandableSection.jsx`, `Ring.jsx`
- `frontend/src/pages/Market.jsx`, `components/signals/{ConvictionBadge,FundamentalCard,OptionsFlowPanel,PredictionCard,SignalCard,IntradayPanel,VolumeHistoryCard}.jsx`, `components/news/NewsPanel.jsx`, `components/charts/CandlestickChart.jsx`, `components/ui/Tooltip.jsx`
- `backend/app/services/conviction.py` (to_thread fix + intra_ml call), `backend/app/api/v1/signals.py` (2 routes, to_thread fix), `backend/app/services/alert_engine.py` (to_thread fix), `backend/app/services/conviction_scanner.py` (`_SYMBOL_TIMEOUT` 90→150)

### Open items (carried forward + new)
- **Design system rollout**: only the Market tab is migrated — Dashboard, Trades, Portfolio, Interests, Alerts, Smart Money still on old/ad-hoc styling. Planned as a follow-up wave once proven here.
- **`vix_term_structure` macro feature warning** (`market_context.py:223`, `cannot reindex on an axis with duplicate labels`) — fires often in logs but already falls back gracefully (neutral value, no crash/block). Could not reliably reproduce in isolation (clean synthetic run with real AAPL data computed fine) — likely a rare race in the unlocked in-memory `_MARKET_CACHE` dict under concurrent load. Not fixed — needs a reliable repro first.
- **`IntradayPanel`'s `SIGNAL_CFG`/`ACTION_CFG` badges** — still bespoke (5-state intensity + purple semantic), not on the shared `Badge` component.
- **Conviction docstring**: still says "13 signals" — needs update to "17 signals" (carried forward from earlier session, still not done)
- POL-USD → AVAX-USD in DEFAULT_STOCKS (carried forward, still not done)
- Alert email notifications, Insider flow / SEC Form 4, Mobile-first + Capacitor + App Store — unchanged, still future phases

---
## Session: 2026-09-15 (Model-quality Q&A, scan-hang root-cause fix, news-weighting plan, options-income screen)

### Topics
- Whether a better ML model exists than the current per-symbol LightGBM setup
- Recommendation tab / conviction scan "taking forever"
- Whether news is properly weighted in the model (it wasn't)
- Planning proper news weighting into the model
- RAM check (FinBERT ruled out)
- Options Income tab — covered calls / cash-secured puts profitability check
- Buy-write (buy 100 shares + sell call) candidate screen

### Decisions
- **Model architecture**: keep per-symbol LightGBM/XGBoost — right choice for this data size; GBDTs beat deep nets on small tabular data. Real ROI is in meta-labeling and a global cross-sectional (ranking) model, not swapping architectures. Not started — advisory only.
- **News weighting**: news is currently NOT a training feature — only a hard-coded ±12pp post-hoc confidence nudge (`ml_predictor.py`) plus 1 equal vote of 17 in `conviction.py`. Full plan written (`tasks/todo.md`): GDELT 2.0 (free, historical tone) for the training feature + VADER (lexicon, ~1MB RAM) to replace the keyword scorer live. **FinBERT/any resident transformer ruled out** — machine measured at 16GB RAM, chronically ~15GB used, 32-42% free under `memory_pressure`. Plan not yet implemented — Phase 1 (GDELT history + `news_sentiment_daily` table) is the next step whenever picked up.
- **Recommendation-scan root cause (found + fixed)**: `ml_predictor.predict()`'s retrain trigger checked `bundle["features"]` for feature *names* that the (undocumented) auto-prune step legitimately removes — so every bundle, even one trained seconds ago, reported stale and forced a full retrain on every call. This made the conviction scan retrain the whole ~113-symbol universe on every run, never finish inside its timeout, and then discard all results (bug: timeout branch set `rows = []`). Leaderboard was frozen at 2026-06-05 for ~3 months.
- **Fix approach**: since the dev machine is off overnight (nightly cron effectively dead by design), fixed the **manual** path instead of adding more automation:
  - `ml_predictor.needs_retrain()` — new method, checks only structural bundle keys + a new `bundle_version` stamp (=5) + 30-day file age; no feature-name checks.
  - New `model_refresh.py` service + `POST/GET /api/v1/conviction/refresh-models(/status)` — background job, retrains only stale symbols, `Semaphore(2)` (box is RAM-tight), progress-tracked. New "Refresh Models" button in `ConvictionLeaderboard.jsx` beside "Scan".
  - `compute_conviction(..., allow_training=False)` — bulk scan never retrains inline anymore; skips the ML signal for stale symbols instead.
  - `run_conviction_scan()` timeout branch rewritten (`asyncio.wait` + commit completed tasks) so a timeout saves progress instead of discarding everything.
  - `main.py` startup no longer auto-fires the conviction scan on stale cache (was firing on every boot) — logs a hint to run Refresh Models → Scan manually instead.
  - Verified end-to-end: ran Refresh Models live (105 retrained, 7 already-fresh, 1 failed — `SQ` ticker dead, now trades as `XYZ`), then a real Scan produced fresh, calibrated ML signals.
- **Options Income screen**: covered calls have nothing to scan (portfolio holds 0 shares). CSP/long-options tab was empty because the fresh scan found 0 MODERATE+ setups (rangebound tape, best was WEAK BUY). Pulled IV environment directly: **implied vol is below 30-day realized vol on nearly every mega-cap** (NVDA −8.9, MSFT −22.1, AMZN −20.5) — a bad regime for selling premium regardless of conviction. Ran a buy-write (100-share + covered-call) screen across 12 liquid names; recommended **waiting** rather than forcing a trade — no name currently combines (a) non-bearish conviction, (b) IV > HV, and (c) real premium. Closest candidates if forced: NVDA (best conviction/liquidity, cheap premium) or META (best IV rank, high capital/concentration).

### Files Changed
- `backend/app/services/ml_predictor.py` — `BUNDLE_VERSION`, `_MAX_BUNDLE_AGE_DAYS`, `needs_retrain()`, `train()` version stamp, simplified `predict()` retrain check
- `backend/app/services/model_refresh.py` — new
- `backend/app/api/v1/conviction.py` — refresh-models endpoints + schema (incl. `last_error`)
- `backend/app/services/conviction.py` — `allow_training` param on `compute_conviction()`
- `backend/app/services/conviction_scanner.py` — `allow_training=False`, `needs_retrain()` in pred-log gate, `asyncio.wait`-based timeout fix
- `backend/app/main.py` — `_catchup()` no longer auto-runs the conviction scan
- `frontend/src/api/conviction.js` — `useModelRefreshStatus`, `useTriggerModelRefresh`
- `frontend/src/components/signals/ConvictionLeaderboard.jsx` — "Refresh Models" button + progress banner
- `tasks/todo.md` — new; scan-fix plan (done) + news-weighting plan (not started)
- Memory: `project_conviction_refresh_workflow.md`, `project_news_weighting_plan.md` (new)

### Key Context
- **Bundle schema drift discovered**: `ml_predictor.py` has grown an LGBM+XGB blended ensemble, walk-forward validation on every train, and auto-prune-and-refit per horizon — none of this was recorded in CLAUDE.md before this session (now documented in the 2026-09-09 entry above). "Feature importance pruning" was marked pending in Master Open Items but was already implemented — corrected.
- **Machine constraints (measured, not assumed)**: 16GB RAM, sysctl/top/memory_pressure show ~15GB used at baseline, 7GB+ compressed under load, 32-42% "free" depending on load. This is the hard constraint ruling out any resident local LLM/transformer for sentiment scoring.
- **Operational pattern going forward**: after any gap where the machine was off, the workflow is Recommendations tab → **Refresh Models** (background, ~1-2hr for full universe) → **Scan** (fast, ~4-8min). Do not run standalone training scripts while Refresh Models is running — concurrent load caused a mass-failure run (110/113 failed) during verification.
- **IV environment reality check**: `get_iv_environment()` and `scan_covered_calls()`/`scan_cash_secured_puts()` in `covered_call_service.py` are live, callable, and correct — the "empty tab" was a data/regime issue (no qualifying conviction, unfavorable IV-HV spread), not a code bug.

### Open Items
- News-weighting plan Phase 1 (GDELT history backfill + `news_sentiment_daily` table) — not started.
- `retrain_all_job()` / `retrain_intraday_job()` in `main.py` still call `train()` without `asyncio.to_thread` — only reachable via the effectively-dead 02:00/02:30 cron; flagged but not fixed (low priority since manual Refresh Models is the real path now).
- Conviction module docstring still says "13 signals" (should be "17").
- POL-USD → AVAX-USD swap in `DEFAULT_STOCKS` — still not done.
- `SQ` ticker in the default universe is dead (renamed to `XYZ`) — causes a harmless but persistent `needs_retrain`/refresh failure; worth swapping.
- Meta-labeling layer (highest-ROI ML improvement discussed) — advisory only, no plan written yet; would need its own todo.md entry if the user wants to proceed.
- Options Income: no current actionable covered-call or CSP trade — revisit when a MODERATE+ conviction name appears with IV trading above realized vol.

---
