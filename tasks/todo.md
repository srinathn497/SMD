# Fix: Recommendation-tab scan taking forever (2026-09-04 → implemented 2026-09-09)

## Root cause (verified live)
- **The retrain trigger was permanently stuck ON.** `ml_predictor.predict()`
  decided a bundle was stale if `b["features"]` (the 1D feature-list alias) was
  missing names like `yield_curve`, `regime_bull`, `eps_surprise_pct`,
  `sma_50_dist`. But the **auto-prune step** (added later) legitimately drops
  low-importance features from the saved list, and several of those names are
  1W-only or get pruned — so **every bundle, including one trained seconds ago,
  reported `needs_retrain = True`.** Two features added at different times that
  silently conflicted.
- Consequence: every `predict()` call retrained. The conviction scan retrained
  the *entire* universe on *every* run, never finished inside `_SCAN_TIMEOUT`,
  and then discarded everything (`rows = []`). Leaderboard frozen at 2026-06-05
  for ~3 months; only ~26 symbols ever "completed" across many runs because
  each run retrains a few then times out — and next run they're "stale" again.
- Compounding: the machine is off overnight so the 02:00 retrain cron rarely
  runs; deliberately left as manual triggers.
- `run_conviction_scan()`'s timeout branch discarded ALL results on timeout
  while logging "saving partial results".

## Fix 1 — Correct + reusable staleness check  ✅ DONE
- [x] `ml_predictor.needs_retrain(symbol, period)` — public method. Checks:
      file exists · `.pkl` mtime < `_MAX_BUNDLE_AGE_DAYS` (30) ·
      `bundle_version >= BUNDLE_VERSION` (new stamp, =5) · training_period ·
      structural keys present (`classifier_xgb`, `features_1d/1w`, `scaler_1d`,
      `wf_diagnostics`, `calibrator_bull`, …). **No feature-name checks** —
      that was the bug.
- [x] `train()` stamps `bundle_version = BUNDLE_VERSION`.
- [x] `predict()` retrain check reduced to `self.needs_retrain(...)`.
- [x] Verified: pre-fix `needs_retrain('AAPL') = True`; after one real train →
      `False` and stays False. Loop broken.

## Fix 2 — Manual "Refresh Models" job (decoupled from the scan)  ✅ DONE
- [x] `app/services/model_refresh.py` — `run_model_refresh(extra, force)` +
      `get_refresh_status()`. Universe = default + watchlist. Retrains only
      symbols where `needs_retrain()` (unless `force`). `Semaphore(2)` (box is
      RAM-tight), `to_thread(train)`, 15-min per-symbol ceiling, live progress
      dict (`running/total/trained/skipped/failed/current`).
- [x] API: `POST /conviction/refresh-models?force=` + `GET
      /conviction/refresh-models/status`.
- [x] Frontend: "Refresh Models" button beside "Scan" in `ConvictionLeaderboard`
      (`Cpu` icon), progress banner (`Training 47/113 · 2 failed`), hooks
      `useModelRefreshStatus` / `useTriggerModelRefresh`. Scan disabled while
      refreshing and vice-versa.

## Fix 3 — Scan never retrains inline + honest timeout  ✅ DONE
- [x] `compute_conviction(..., allow_training=False)` — new param. When the
      bundle is stale, the ML signal is skipped with detail "model needs refresh
      — run Refresh Models" instead of retraining. Conviction scanner passes
      `False`; on-demand analyzers keep `True`.
- [x] `conviction_scanner` pred-log block uses `needs_retrain()` (was bare
      `.pkl` exists check — didn't catch stale bundles).
- [x] `run_conviction_scan()` overall-timeout: `asyncio.wait(tasks, timeout=…)`
      then commit the `done` set + cancel `pending`. A timeout now saves
      completed results instead of discarding the scan.

## Fix 4 — Docs  ✅ DONE
- [x] `CLAUDE.md` — new session entry: the retrain-trigger bug, `BUNDLE_VERSION`,
      `needs_retrain()`, Refresh Models button/endpoint, `allow_training` flag,
      scan-timeout fix. XGB-blend / walk-forward / auto-prune pipeline documented.
      "Feature importance pruning" moved to done in Master Open Items.

## Not done (deliberately)
- No startup/cron auto-catch-up for model staleness — machine is off at those
  times; manual "Refresh Models" is the intended trigger.
- `retrain_all_job()` / `retrain_intraday_job()` still call `train()` without
  `to_thread` — only reachable via the 02:00/02:30 cron which effectively never
  fires here. Left alone; `model_refresh.py` is the path that's actually used.
  (Flagged for a future pass if cron is ever relied on.)

---

# Plan: Proper news weighting in the ML model (2026-09-05)

## Definition of done
- Daily news sentiment is a **learned feature** in the daily model (1D + 1W),
  time-aligned to every historical bar, with ~3y of history.
- The model learns news weight per symbol/horizon from data (LightGBM/XGB +
  existing `_prune_features`), replacing the fixed ±12pp rule.
- Walk-forward accuracy measured with-news vs. news-excluded per horizon;
  features kept only where lift is real.
- Runtime ±12pp heuristic demoted to "breaking news since last training bar"
  only, or removed — decided by held-out calibration.
- No paid infra. At most one new free external source, with neutral fallback.

## Current state (verified)
- `news_service.py`: keyword bag-of-words over 8 RSS headlines, 15-min cache,
  `agg_score ∈ [-1,1]`. No history — cannot backfill from RSS.
- `ml_predictor.predict()` L1119-1123: `±|score|*12pp` post-calibration nudge,
  confidence only, never direction, default 0.0 (only `conviction.py` passes it).
- `conviction.py` Signal 4: 1 equal vote of 17.
- Reusable plumbing: `market_context.get_fundamentals()` inner `_align()` =
  `series.reindex(stock_dates.union(series.index)).ffill().reindex(stock_dates).fillna(0.0)`
  — exact pattern for external data on non-trading days. `add_earnings_features()`
  is the template. `FEATURE_COLS` superset built in `_build_features()`;
  `FEATURE_COLS_1D` / `FEATURE_COLS_1W` select per horizon; separate scalers.
- DB: `Base.metadata.create_all` auto-creates; register new model in
  `database.py:33`. No migrations.
- Retrain trigger: key/feature-presence check in `predict()` L987-1005.

## Phase 1 — Historical news data
- [ ] `news_history_service.py` — GDELT 2.0 DOC API client (free, no key):
      `get_daily_tone(query, start, end) -> DataFrame[date, tone, article_vol]`
      via `mode=timelinetone` + `timelinevol`; rescale tone −100..100 → [−1,1].
- [ ] `SYMBOL_NEWS_QUERY` map — per-symbol GDELT query (company name + ticker),
      default universe curated; fallback `"<symbol> stock"`. Crypto: topic
      queries; zeros for unmapped tokens.
- [ ] Politeness + on-disk cache (`news_history_cache/<symbol>.parquet`, 1-day TTL).
- [ ] Table `news_sentiment_daily` (`app/models/news_sentiment.py`):
      `symbol, date, tone, article_volume, pos_ratio, neg_ratio, source`
      (PK symbol+date). Register in `database.py`.
- [ ] `backfill_news_history(symbols, years=3)` — one-time; run on startup if
      table empty for a symbol.
- [ ] Nightly `news_history_job()` ~01:30 (before 02:00 retrain) — append
      yesterday's tone for universe + watchlist.

## Phase 2 — News features in `_build_features()`
- [ ] Promote `_align()` to module level in `market_context.py`.
- [ ] `add_news_features(df, symbol, stock_dates)` — load `news_sentiment_daily`,
      `_align()` each series, compute:
      - `news_tone_1d` — latest daily tone
      - `news_tone_3d`, `news_tone_7d` — trailing means
      - `news_tone_delta_7d` — `news_tone_1d − news_tone_7d` (sentiment shift)
      - `news_vol_z_20d` — article-volume z-score (unusual attention)
      - `news_tone_x_vol` — `news_tone_1d * clip(news_vol_z_20d, 0, 3)`
- [ ] Add 6 to `FEATURE_COLS` + `FEATURE_GROUPS` (`"news"` group).
- [ ] Horizon split:
      - 1D: `news_tone_1d`, `news_tone_3d`, `news_vol_z_20d`, `news_tone_x_vol`
      - 1W: `news_tone_7d`, `news_tone_delta_7d`, `news_tone_x_vol`
- [ ] Wire into `_build_features()` beside earnings/fundamentals.

## Phase 3 — Live inference consistency
- [ ] (If unifying) `get_news()` live path fetches GDELT "last 24–48h" tone as
      authoritative `score`; RSS kept only for displayed headlines; keyword
      scorer = offline fallback (flag on `SentimentSummary.source`).
- [ ] `predict()`: replace ±12pp block per the decision — either a ±4pp residual
      applied only for news strictly newer than `feat_df.index[-1]`, or remove.

## Phase 4 — Retrain trigger + rollout
- [ ] Add `"news_tone_7d" not in feats` to `predict()` retrain trigger.
- [ ] Depends on Fix 1 above (model-staleness catch-up) so the universe retrain
      runs as a background job, not inside a conviction scan.

## Phase 5 — Validation (DoD gate)
- [ ] Extend `_walk_forward` to report with-news vs. news-excluded accuracy,
      per horizon, across universe: mean delta, hit-rate on high-|tone| days,
      per-symbol lift table.
- [ ] Keep news features where WF delta ≥ ~+1pp and calibration not degraded;
      `_prune_features` drops per-symbol noise automatically.
- [ ] Decide ±12pp → ±4pp-residual vs. removed from held-out calibration.

## Phase 6 — Conviction + docs
- [ ] `conviction.py` Signal 4: keep the vote, source its label from the same
      (GDELT) tone used by the feature.
- [ ] Update `CLAUDE.md`: `news_*` features, GDELT dependency,
      `news_sentiment_daily` table, 01:30 job, ±12pp change, retrain key;
      mark "Paused all sentiment improvements" superseded.

## Risks
- GDELT tone is general-purpose, not finance-tuned — noisy for small caps,
  entity collisions. Mitigation: query tuning, volume weighting, per-symbol prune.
- External free service — rate limits / downtime. Mitigation: on-disk cache,
  neutral fallback, features degrade to 0.0.
- Thinly-covered names → mostly-0.0 feature; harmless (prune drops it).

## Out of scope (follow-ups)
- FinBERT / transformer scoring on CPU (RAM cost per CLAUDE.md).
- Intraday 15m model news features (needs intraday-resolution news).
- GDELT GKG event-type themes (guidance cut / M&A / litigation) as features.
