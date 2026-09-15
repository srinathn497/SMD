import { useState } from 'react'
import { TrendingUp, TrendingDown, Brain, AlertTriangle, Newspaper, Zap, Info, RefreshCw } from 'lucide-react'
import Badge, { toneFromSignal } from '../ui/Badge'
import Tooltip from '../ui/Tooltip'
import ExpandableSection from '../ui/ExpandableSection'
import FeatureImportanceChart from './FeatureImportanceChart'
import { usePrediction, useClearPredictionCache } from '../../api/signals'

// ── Feature tooltip dictionary ─────────────────────────────────────────────────
const FEATURE_TIPS = {
  rsi_14:
    'RSI (14-day) — momentum oscillator. Above 70 = overbought (price ran up too fast, may reverse). Below 30 = oversold (may bounce). Between 30-70 = neutral.',
  macd_hist:
    'MACD Histogram — difference between the MACD line and its signal line. Positive & growing = strong bullish momentum. Negative & shrinking = momentum losing steam.',
  macd_signal:
    'MACD Signal Line — 9-day smoothed MACD. When MACD crosses above this line it\'s a classic buy signal; crossing below is a sell signal.',
  bb_pct:
    'Bollinger Band % — where price sits inside the bands. Near 0 = at the lower band (oversold zone, potential bounce). Near 1 = at the upper band (overbought zone, potential pullback).',
  bb_width:
    'Bollinger Band Width — how wide the bands are. Very narrow = volatility squeeze, a big move is coming (direction unknown). Wide = already in a volatile phase.',
  ema_diff:
    'EMA Difference (20 vs 50-day) — normalized gap between short and long-term averages. Positive = short-term trend is above long-term (uptrend). Negative = downtrend.',
  ema_slope:
    'EMA Slope — how steeply the 20-day average is rising or falling over the last 5 bars. Steep positive = strong upward momentum. Flat or negative = trend weakening.',
  ret_1d:
    '1-Day Return — today\'s price change vs yesterday\'s close. Captures the immediate momentum going into tomorrow. A big negative day often leads to continuation or oversold bounce.',
  ret_3d:
    '3-Day Return — price change over 3 trading days. Short-term trend context. Helps the model see if recent strength/weakness is building.',
  ret_5d:
    '5-Day Return — one full week\'s price change. Shows the weekly momentum direction and whether it\'s consistent with the daily picture.',
  ret_10d:
    '10-Day Return — two-week price change. Medium-term trend. Useful for catching sustained moves vs short-term noise.',
  ret_20d:
    '20-Day Return — roughly one month\'s price change. Gives the model context on whether the stock has been trending or mean-reverting at the monthly level.',
  volume_ratio:
    'Volume Ratio — today\'s volume divided by the 20-day average. Above 1.5 = unusually high activity, signals a real institutional move. Below 0.5 = quiet day, price move may not be meaningful.',
  volume_trend:
    'Volume Trend — 5-day average volume vs 20-day average. Rising ratio = increasing interest/accumulation. Falling = declining conviction in the current move.',
  atr_pct:
    'ATR % (Average True Range / Price) — 14-day average of daily high-low ranges, as a % of price. High ATR = volatile stock moving big each day. Low ATR = calm. Model uses this to gauge how "noisy" the stock currently is.',
  volatility_20d:
    '20-Day Volatility — statistical standard deviation of daily returns over 20 days. Complements ATR. Rising volatility often precedes trend changes.',
  dist_52w_high:
    '52-Week High Distance — how far the current price is below its 52-week peak. Near 0% = at all-time high (momentum). Near 30% = significant pullback from highs (potential value or continued weakness).',
  dist_52w_low:
    '52-Week Low Distance — how far the current price is above its 52-week trough. Near 0% = dangerously close to yearly lows. High % = well above lows, strong recovery or extended move.',
  gap_open:
    'Gap Open — overnight jump between yesterday\'s close and today\'s open price. Positive gap = stock opened higher (bullish overnight news/sentiment). Negative gap = opened lower. Gaps often get "filled" — the price returns to fill the gap.',
  close_position:
    'Close Position in Day\'s Range — where the closing price landed within today\'s high-low range. Score of 1.0 = closed at the exact HIGH (bulls completely dominated). Score of 0.0 = closed at the exact LOW (bears took over by end of day). This is one of the most powerful next-day predictors.',
  daily_range:
    'Daily Range % — the intraday spread (high minus low) as a percentage of price. Wide range = highly contested day, lots of volatility. Narrow range = quiet, low-conviction day.',
  body_size:
    'Candle Body Size — gap between open and close as % of price. Large body = strong conviction (clear bull or bear day). Tiny body (doji) = indecision between buyers and sellers, often signals an upcoming reversal.',
  upper_shadow:
    'Upper Shadow (Upper Wick) — the tail above the candle body. Price ran up intraday to the high, but sellers pushed it back down before close. Long upper shadow = sellers rejected the rally. Bearish signal.',
  lower_shadow:
    'Lower Shadow (Lower Wick) — the tail below the candle body. Price dipped intraday to the low, but buyers pushed it back up. Long lower shadow = buyers defended the lows. Bullish signal.',
  // ── Market context features ────────────────────────────────────────────────
  spy_ret_1d:
    'SPY 1-Day Return — yesterday\'s S&P 500 return. When the broad market fell, individual stocks tend to follow. The model learned whether this stock moves with or against the market on a daily basis.',
  spy_ret_5d:
    'SPY 5-Day Return — the S&P 500\'s return over the past week. Shows whether the broad market is in a short-term upswing or pullback. Stocks in a rising market have more tailwind, falling market = headwind.',
  spy_ret_20d:
    'SPY 20-Day Return — the S&P 500\'s monthly trend. Positive = bull-market regime (risk-on). Negative = bear-market or correction phase (risk-off). One of the strongest macro context signals the model uses.',
  vix_level:
    'VIX Level (normalised ÷ 30) — the "fear gauge." VIX below 20 (score <0.67) = calm market, traders are complacent, trends persist. VIX above 30 (score >1.0) = crisis/high fear, stocks are more volatile and reversals are common. The model learned different behaviour in each regime.',
  vix_change_5d:
    'VIX 5-Day Change — is fear rising or calming this week? Rising VIX = increasing uncertainty, adds caution to bullish signals. Falling VIX = market calming down, supports upside momentum. Directional change is often more informative than the absolute level.',
  rs_vs_spy_5d:
    'Relative Strength vs SPY (5-Day) — this stock\'s 5-day return minus SPY\'s 5-day return. Positive = stock is outperforming the market this week (sector rotation into this stock, or strong earnings). Negative = lagging the market (weakness, distribution). Strong relative strength = bullish tilt.',
  rs_vs_spy_20d:
    'Relative Strength vs SPY (20-Day) — this stock\'s monthly return minus SPY\'s monthly return. Persistent outperformance over 20 days signals sustained institutional accumulation or sector leadership — one of the strongest momentum signals. Persistent underperformance = avoid.',
  sector_ret_5d:
    'Sector ETF 5-Day Return — the weekly return of this stock\'s sector (e.g., XLK for tech, XLF for financials). Rising sector = rising tide that lifts all stocks in it. Falling sector = headwind even for strong individual stocks. Separates stock-specific strength from sector-wide moves.',
  // ── Earnings proximity features ────────────────────────────────────────────
  days_to_next_earnings:
    'Days to Next Earnings — calendar days until the next scheduled earnings announcement (capped at 30). Near 0 = earnings are imminent.\n\nThe model learned to reduce confidence close to earnings: price will react to EPS surprise, not RSI or MACD.',
  days_since_earnings:
    'Days Since Last Earnings — calendar days since the most recent earnings announcement (capped at 90). The model learned different patterns immediately after a report (post-earnings drift) vs. the quiet mid-cycle period (technicals more reliable).',
  earnings_in_5d:
    'Earnings in 5 Days — binary flag: 1 = an earnings announcement is expected within the next 5 calendar days. The strongest earnings signal.\n\nThe model learned that RSI, MACD, and Bollinger Band setups lose reliability when earnings are imminent — price will react to EPS surprise, not chart patterns.',
  // ── Macro features ──────────────────────────────────────────────────────────
  yield_curve:
    'Yield Curve (10Y − 13W Treasury spread). Positive = normal upward slope. Negative = inverted = bond market pricing in recession risk. Strongly inverted curves historically precede slowdowns by 12–18 months.',
  dxy_ret_5d:
    'US Dollar 5-Day Return — how much the dollar has strengthened or weakened this week. Strong dollar = headwind for multinationals and commodities. Weak dollar = tailwind for export-heavy sectors and crypto.',
  credit_spread:
    'Credit Spread (HYG vs LQD 5-day return difference). Positive = high-yield bonds outperforming investment-grade = risk-on. Negative = credit stress, investors fleeing to safety = risk-off signal.',
  vix_term_structure:
    'VIX Term Structure — VIX / VIX3M ratio. Above 1 = near-term panic spike (short-dated options more expensive than 3-month). Below 1 = normal calm contango. Sharp spikes above 1.2 = crisis-level fear.',
  // ── Regime features ─────────────────────────────────────────────────────────
  regime_bull:
    'Bull Regime flag — SPY gained more than 3% over the past 20 trading days. Risk-on environment. The ensemble model learned that bullish setups have higher follow-through in this regime.',
  regime_bear:
    'Bear Regime flag — SPY lost more than 3% over the past 20 trading days. Risk-off environment. Mean-reversion setups often backfire during bear regimes as selling pressure overwhelms technical signals.',
}

// Tooltips for section headers and labels
const SECTION_TIPS = {
  wf_accuracy:
    'Historical Report Card — how often did this model correctly predict direction on data it had never seen before?\n\nInstead of one train/test split, we roll a window forward through time: train on months 1-6, test month 7, then train 1-7 test month 8, etc. Each bar = one test window.\n\nThis is a PAST performance measure. The actual prediction above is for the FUTURE — it was made on today\'s live data, not on any of these historical windows.',
  wf_std:
    'Standard Deviation across rounds — how consistent the model is. ±3% = very stable (trustworthy). ±15% = erratic, meaning the model works in some market conditions but fails in others.',
  confidence:
    'Confidence after isotonic regression calibration on walk-forward held-out predictions.\n\nA calibrated 70% means the model was historically correct ~70% of the time on out-of-sample data — not just in training.\n\nCalibration is fitted automatically using all the probability scores from walk-forward test windows. If fewer than 30 test samples are available, raw LightGBM output is shown instead (marked uncalibrated).',
  adjusted_confidence:
    'This confidence has been adjusted by the current news sentiment. If sentiment agrees with the ML direction → confidence boosted (max +12pp). If sentiment contradicts → confidence reduced. Neutral news = no change.',
  expected_move:
    'Expected Move — a second model (regression) trained on the same features predicts the magnitude of tomorrow\'s price move in %. This is independent from the direction model — both are trained separately.',
  static_accuracy:
    'Static Accuracy — old-style backtest accuracy on 20% held-out data. Less reliable than Walk-Forward because the train/test split is fixed, not rolling. Included for reference only.',
}

// ── Period selector ────────────────────────────────────────────────────────────
const PERIODS = [
  { value: '6mo', label: '6M', warn: true,  tip: 'Only ~78 filtered samples after warmup — borderline. Model may be unreliable.' },
  { value: '1y',  label: '1Y', warn: true,  tip: '~150 filtered samples. Produces only ~7 WF rounds — borderline. Use 2y+ for more reliable accuracy measurement.' },
  { value: '2y',  label: '2Y', warn: false, tip: '~300 filtered samples, ~28 WF rounds. Good fallback for volatile symbols.' },
  { value: '3y',  label: '3Y', warn: false, tip: '~450 filtered samples across multiple regimes. Default — best accuracy for the ensemble model.' },
]

// ── Horizon selector ───────────────────────────────────────────────────────────
const HORIZONS = [
  { value: '1d', label: '1D', tip: 'Next-day prediction — will tomorrow\'s close be higher than today? Best for swing traders acting on a 1-2 day view.' },
  { value: '1w', label: '1W', tip: '1-week prediction (5 trading days) — trained on whether price is higher in ~1 week. Fewer WF rounds but captures multi-day momentum.' },
  { value: '1m', label: '1M', tip: '1-month prediction (21 trading days) — trained on 21-day forward close direction. Best for position traders with a 3-4 week horizon.' },
]

const HORIZON_WHAT = {
  '1d': { label: 'Will tomorrow\'s close be higher than today\'s?', badge: 'Next 1 trading day' },
  '1w': { label: 'Will price be higher in ~5 trading days (1 week)?', badge: 'Next 5 trading days' },
  '1m': { label: 'Will price be higher in ~21 trading days (1 month)?', badge: 'Next 21 trading days' },
}

// ── WF sparkline ──────────────────────────────────────────────────────────────
const DAILY_WF_MIN_TRAIN = 126   // WF_MIN_TRAIN_DAYS from backend
const DAILY_WF_TEST      = 10    // WF_TEST_DAYS from backend

const WF_AXIS_TIP_LEFT  =
  'Oldest WF test window shown. Each bar is one rolling test period, advancing 10 trading days forward.\n\nBars run left (oldest) → right (most recent).'
const WF_AXIS_TIP_RIGHT =
  'Most recent WF test window — the hardest test. The model was trained only on earlier data and tested on the latest market conditions.\n\nIf this bar is red, the model is struggling in the current regime.'

function WFSparkline({ history, dates, diagnostics, trainedOnDays = 0, wfRounds = 0 }) {
  if (!history?.length) return null
  const max   = Math.max(...history, 60)
  const total = history.length

  // Rows used by WF = warmup (126) + rounds × test_days (10)
  // Remaining rows = trained on but not yet tested — not enough for a full window
  const untestedDays = trainedOnDays > 0
    ? Math.max(0, trainedOnDays - (126 + wfRounds * DAILY_WF_TEST))
    : 0
  const lastTestedDate = dates?.[dates.length - 1]?.[1] ?? null

  // Axis date labels — show oldest → newest test window boundaries
  const leftLabel  = dates?.[0]?.[0]              ?? `~${total * DAILY_WF_TEST} days ago`
  const rightLabel = dates?.[dates.length - 1]?.[1] ?? 'most recent'

  return (
    <div className="space-y-1 min-w-0">
      {/* Bars + untested tail */}
      <div className="flex items-end gap-px h-6 min-w-0 overflow-hidden">
        {history.map((acc, i) => {
          const h     = Math.max(4, (acc / max) * 24)
          const color = acc >= 55 ? 'bg-emerald-500' : acc >= 50 ? 'bg-yellow-500' : 'bg-red-400'
          const align = i >= history.length - 3 ? 'right' : 'center'

          const dPair     = dates?.[i]
          const dateLabel = dPair
            ? `${dPair[0]} – ${dPair[1]}`
            : `~${(total - 1 - i) * DAILY_WF_TEST + DAILY_WF_TEST} trading days ago`
          const trainDays = DAILY_WF_MIN_TRAIN + i * DAILY_WF_TEST

          let tip =
            `Round ${i + 1} of ${total} — ${dateLabel}\n` +
            `Accuracy: ${acc}%\n` +
            `Trained on: ~${trainDays} days · Tested on: ${DAILY_WF_TEST} days`

          const diag = diagnostics?.[i]
          if (diag) tip += `\n\n${diag}`

          return (
            <Tooltip key={i} text={tip} align={align} xwide className="flex-1 min-w-0">
              <div className={`w-full rounded-sm ${color} opacity-80 cursor-help`} style={{ height: `${h}px` }} />
            </Tooltip>
          )
        })}

        {/* Untested tail — most recent days trained on but not yet in a complete test window */}
        {untestedDays > 0 && (
          <Tooltip
            text={`${untestedDays} day${untestedDays > 1 ? 's' : ''} in training, not yet validated\n\nThese days (after ${lastTestedDate ?? 'last round'}) are included when training the model — the prediction above uses all of them.\n\nThey don't appear as a scored bar because walk-forward requires ${DAILY_WF_TEST} consecutive days to produce a statistically meaningful accuracy estimate. Showing accuracy from just ${untestedDays} prediction${untestedDays > 1 ? 's' : ''} would be misleading noise, not signal.\n\nThis is intentional — the report card only shows windows where the result is trustworthy.`}
            align="right"
            xwide
          >
            <div className="flex items-end gap-px cursor-help ml-1 flex-shrink-0">
              {Array.from({ length: Math.min(untestedDays, 5) }).map((_, j) => (
                <div
                  key={j}
                  className="w-1 rounded-sm bg-slate-600 opacity-40"
                  style={{ height: `${8 + j * 2}px` }}
                />
              ))}
            </div>
          </Tooltip>
        )}
      </div>

      {/* Axis labels */}
      <div className="flex justify-between text-xs text-slate-500">
        <Tooltip text={WF_AXIS_TIP_LEFT} wide>
          <span className="cursor-help">{leftLabel}</span>
        </Tooltip>
        <div className="flex items-center gap-1.5">
          {untestedDays > 0 && (
            <span className="text-slate-600 text-xs italic">+{untestedDays}d in training</span>
          )}
          <Tooltip text={WF_AXIS_TIP_RIGHT} wide align="right">
            <span className="cursor-help">{rightLabel}</span>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

// ── Feature importance bar with tooltip ───────────────────────────────────────
function FeatureBar({ name, importance, maxImportance }) {
  const pct   = Math.round((importance / maxImportance) * 100)
  const label = name.replace(/_/g, ' ')
  const tip   = FEATURE_TIPS[name]

  return (
    <div className="flex items-center gap-2">
      {tip ? (
        <Tooltip text={tip} wide align="right">
          <span className="text-slate-400 w-24 truncate capitalize text-right text-xs cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
            {label}
          </span>
        </Tooltip>
      ) : (
        <span className="text-slate-500 w-24 truncate capitalize text-right text-xs">{label}</span>
      )}
      <div className="flex-1 h-1.5 bg-dark-600 rounded-full overflow-hidden">
        <div className="h-full bg-brand-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-slate-600 w-6 text-right text-xs">{pct}%</span>
    </div>
  )
}

// ── Sentiment adjustment ───────────────────────────────────────────────────────
function SentimentAdjustment({ raw, adjusted, sentiment_label }) {
  const diff = Math.round(adjusted - raw)
  if (Math.abs(diff) < 1) return null
  const positive     = diff > 0
  const sentimentColor = sentiment_label === 'POSITIVE' ? 'text-emerald-400'
                       : sentiment_label === 'NEGATIVE' ? 'text-red-400'
                       : 'text-yellow-400'
  return (
    <Tooltip text={SECTION_TIPS.adjusted_confidence} wide>
      <div className="flex items-center gap-1.5 text-xs cursor-help">
        <Newspaper size={10} className={sentimentColor} />
        <span className="text-slate-500">Sentiment</span>
        <span className={`font-medium ${sentimentColor}`}>{sentiment_label}</span>
        <span className={`font-semibold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
          {positive ? '+' : ''}{diff}pp
        </span>
      </div>
    </Tooltip>
  )
}

// ── WF accuracy badge ──────────────────────────────────────────────────────────
function WFBadge({ accuracy }) {
  const color = accuracy >= 55 ? 'text-emerald-400' : accuracy >= 50 ? 'text-yellow-400' : 'text-red-400'
  const bg    = accuracy >= 55 ? 'bg-emerald-500/10 border-emerald-500/30'
              : accuracy >= 50 ? 'bg-yellow-500/10 border-yellow-500/30'
              :                  'bg-red-500/10 border-red-500/30'
  return (
    <Tooltip text={SECTION_TIPS.wf_accuracy} wide>
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${bg} ${color} cursor-help`}>
        {accuracy}% WF
      </span>
    </Tooltip>
  )
}

// ── Model Insights (expandable feature importance) ────────────────────────────
function ModelInsights({ data }) {
  const has1d = data.feature_importances_1d?.length > 0
  return (
    <ExpandableSection
      className="border-t border-dark-600/60 pt-3"
      trigger={
        <div className="flex items-center gap-1.5">
          <p className="text-xs text-slate-500 font-medium">Model Insights</p>
          {!has1d && (
            <span className="text-[10px] text-slate-600 italic">(retrain to unlock)</span>
          )}
        </div>
      }
    >
      {has1d
        ? <FeatureImportanceChart
            importances1d={data.feature_importances_1d}
            importances1w={data.feature_importances_1w}
            pruned1d={data.pruned_features_1d}
            pruned1w={data.pruned_features_1w}
          />
        : (
          <div className="space-y-1.5">
            <p className="text-xs text-slate-600 mb-2">Top drivers (legacy)</p>
            {data.top_features?.map(([name, imp]) => (
              <FeatureBar key={name} name={name} importance={imp}
                maxImportance={data.top_features[0]?.[1] ?? 1} />
            ))}
          </div>
        )
      }
    </ExpandableSection>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PredictionCard({ symbol, assetType, onPeriodChange, onHorizonChange }) {
  const [period, setPeriod] = useState('3y')
  const [horizon, setHorizon] = useState('1d')
  const handlePeriodChange = (p) => { setPeriod(p); onPeriodChange?.(p) }
  const handleHorizonChange = (h) => { setHorizon(h); onHorizonChange?.(h) }
  // isFetching = true on ANY in-flight request (including background refetches after invalidate)
  // isPending  = true only on first load with no cached data
  const { data, isPending, isFetching, error } = usePrediction(symbol, assetType, period, horizon)
  const clearCache = useClearPredictionCache(symbol, assetType, period)
  const isRefreshing = clearCache.isPending || isFetching

  const isUp     = data?.direction === 'UP'
  const Icon     = isUp ? TrendingUp : TrendingDown
  const dirColor = isUp ? 'text-emerald-400' : 'text-red-400'
  const wfColor  = !data ? 'text-slate-500'
    : data.wf_accuracy >= 55 ? 'text-emerald-400'
    : data.wf_accuracy >= 50 ? 'text-yellow-400'
    : 'text-red-400'
  const maxImportance = data?.top_features?.[0]?.[1] ?? 1

  return (
    <div className="card space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-purple-400" />
          <h3 className="font-semibold text-slate-200">ML Prediction</h3>
          {data && !isRefreshing && <WFBadge accuracy={data.wf_accuracy} />}
          {isRefreshing && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-400 animate-pulse">
              Retraining…
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Tooltip text="Force retrain — deletes the saved model and runs a full retrain + walk-forward validation from scratch. Takes 10–20s." align="right">
            <button
              onClick={() => !isRefreshing && clearCache.mutate()}
              disabled={isRefreshing}
              className="p-1 rounded text-slate-600 hover:text-slate-300 hover:bg-dark-700 transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-brand-400' : ''} />
            </button>
          </Tooltip>
          <div className="flex items-center gap-1">
          <span className="text-xs text-slate-600 mr-1">Train on</span>
          {PERIODS.map(p => (
            <Tooltip key={p.value} text={p.tip} align="right">
              <button
                onClick={() => handlePeriodChange(p.value)}
                className={`px-2 py-0.5 text-xs rounded font-medium transition-colors cursor-pointer ${
                  period === p.value
                    ? p.warn ? 'bg-amber-600/30 text-amber-300 border border-amber-600/50'
                             : 'bg-brand-600 text-white'
                    : 'bg-dark-700 text-slate-400 hover:text-slate-200'
                }`}>
                {p.label}
              </button>
            </Tooltip>
          ))}
          </div>
        </div>
      </div>

      {/* ── Horizon tabs ── */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-slate-600 mr-1">Horizon</span>
        {HORIZONS.map(h => (
          <Tooltip key={h.value} text={h.tip}>
            <button
              onClick={() => handleHorizonChange(h.value)}
              className={`px-3 py-1 text-xs rounded font-medium transition-colors cursor-pointer ${
                horizon === h.value
                  ? 'bg-purple-600/70 text-purple-100 border border-purple-500/50'
                  : 'bg-dark-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {h.label}
            </button>
          </Tooltip>
        ))}
      </div>

      {/* ── 6M warning ── */}
      {period === '6mo' && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          <AlertTriangle size={12} className="flex-shrink-0" />
          6M window is borderline (~78 samples). Use 1Y+ for reliable results.
        </div>
      )}

      {/* ── Earnings blackout banner ── */}
      {data?.earnings_blackout_active && (
        <div className="flex items-center gap-2 text-xs text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2">
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span><strong>Earnings Blackout</strong> — an earnings announcement is within 5 days or just occurred. Price will react to EPS surprise, not chart patterns. Treat with extra caution.</span>
        </div>
      )}

      {/* ── Loading ── */}
      {isPending && (
        <div className="space-y-2 animate-pulse">
          <div className="h-8 bg-dark-600 rounded w-3/4" />
          <div className="h-3 bg-dark-600 rounded w-full" />
          <div className="h-3 bg-dark-600 rounded w-2/3" />
          <p className="text-xs text-slate-600 text-center pt-1">
            Training model + walk-forward validation… ~10–20s
          </p>
        </div>
      )}

      {/* ── Error ── */}
      {!isPending && error && (
        <p className="text-sm text-red-400 py-1">
          {error.response?.data?.detail || 'Model training failed — try 1Y or 2Y period.'}
        </p>
      )}

      {/* ── Results ── */}
      {!isPending && !error && data && (
      <div className={isRefreshing ? 'opacity-40 pointer-events-none select-none' : ''}>

        {/* "What this predicts" strip — makes it crystal clear this is a FUTURE prediction */}
        {(() => {
          const hw = HORIZON_WHAT[data.horizon ?? '1d']
          return (
            <div className="flex items-center gap-2 text-xs bg-dark-700/50 rounded-lg px-3 py-2 border border-dark-600/50">
              <span className="px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300 border border-purple-700/40 font-medium whitespace-nowrap">
                {hw.badge}
              </span>
              <span className="text-slate-400">{hw.label}</span>
            </div>
          )
        })()}

        {/* Regime badge */}
        {data.regime && data.regime !== 'NEUTRAL' && (
          <Tooltip
            text={data.regime === 'BULL'
              ? 'Bull Regime — S&P 500 up >3% over 20 days. Risk-on environment; bullish setups have higher follow-through.'
              : 'Bear Regime — S&P 500 down >3% over 20 days. Risk-off environment; mean-reversion setups often backfire.'}
            wide
          >
            <div className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border cursor-help mb-1 ${
              data.regime === 'BULL'
                ? 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40'
                : 'bg-red-900/40 text-red-400 border-red-700/40'
            }`}>
              {data.regime === 'BULL' ? '↑ Bull Regime' : '↓ Bear Regime'}
            </div>
          </Tooltip>
        )}

        {/* Direction + confidence */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon size={22} className={dirColor} />
            <Badge tone={toneFromSignal(data.direction)} size="lg">{data.direction}</Badge>
          </div>
          <Tooltip text={SECTION_TIPS.confidence} wide align="right">
            <div className="text-right cursor-help">
              <div className="flex items-center justify-end gap-1.5">
                <span className={`text-2xl font-bold ${dirColor}`}>{data.confidence_pct}%</span>
                {data.is_calibrated ? (
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${
                    data.regime === 'BEAR'
                      ? 'bg-red-900/40 text-red-300 border-red-700/40'
                      : data.regime === 'BULL'
                      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40'
                      : 'bg-cyan-900/50 text-cyan-400 border-cyan-700/40'
                  }`}>
                    CAL{data.regime && data.regime !== 'NEUTRAL' ? `-${data.regime}` : ''}
                  </span>
                ) : (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-dark-600 text-slate-600 border border-dark-500/40">
                    RAW
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600">confidence</p>
            </div>
          </Tooltip>
        </div>

        {/* Sentiment adjustment */}
        <SentimentAdjustment
          raw={data.raw_confidence_pct}
          adjusted={data.confidence_pct}
          sentiment_label={data.sentiment_label}
        />

        {/* Price + magnitude */}
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="bg-dark-700/50 rounded-lg p-2.5">
            <p className="text-slate-600 mb-0.5">Current</p>
            <p className="font-semibold text-slate-200">${data.current_price.toLocaleString()}</p>
          </div>
          <Tooltip text={SECTION_TIPS.expected_move} wide>
            <div className="bg-dark-700/50 rounded-lg p-2.5 w-full cursor-help">
              <p className="text-slate-600 mb-0.5 flex items-center gap-1">
                <Zap size={9} /> Expected
              </p>
              <p className={`font-semibold ${data.expected_move_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {data.expected_move_pct >= 0 ? '+' : ''}{data.expected_move_pct}%
              </p>
            </div>
          </Tooltip>
          <Tooltip text="Target Price — current price ± the magnitude model's predicted % move, applied in the direction of the classifier. A second model (LGBMRegressor) estimates how big tomorrow's move will be, independent from the UP/DOWN direction." wide align="right">
            <div className="bg-dark-700/50 rounded-lg p-2.5 w-full cursor-help">
              <p className="text-slate-600 mb-0.5">Target</p>
              <p className="font-semibold text-slate-200">
                ${data.target_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
          </Tooltip>
        </div>

        {/* Walk-forward validation — labelled as "Report Card" for non-technical users */}
        <div className="border-t border-dark-600/60 pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <Tooltip text={SECTION_TIPS.wf_accuracy} wide>
              <span className="text-xs text-slate-500 font-medium cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
                Historical Report Card
              </span>
            </Tooltip>
            <Tooltip text={SECTION_TIPS.wf_std} align="right">
              <span className="text-xs text-slate-600 cursor-help">
                {data.wf_rounds} rounds · ±{data.wf_accuracy_std}%
              </span>
            </Tooltip>
          </div>
          <div className="flex items-center gap-3 min-w-0">
            <span className={`text-xl font-bold ${wfColor} flex-shrink-0`}>{data.wf_accuracy}%</span>
            <div className="flex-1 min-w-0">
              <WFSparkline
                history={data.wf_accuracy_history}
                dates={data.wf_dates}
                diagnostics={data.wf_diagnostics}
                trainedOnDays={data.trained_on_days}
                wfRounds={data.wf_rounds}
              />
            </div>
          </div>
          <Tooltip
            text={
              data.wf_accuracy >= 55
                ? 'In most rolling test windows the model correctly predicted next-day direction on data it had never seen. You can lean on this signal, but always confirm with intraday context and news.'
                : data.wf_accuracy >= 50
                ? 'Marginally better than a coin-flip. Some windows were reliable, others were not. Check the sparkline — if recent bars (right side) are red, current conditions are hard for the model.'
                : 'Recent test windows were worse than random. Likely causes: earnings surprise, VIX spike, or sudden regime change. Hover the red bars for per-period context. Do not act on this signal alone.'
            }
            wide
          >
            <p className="text-xs text-slate-600 cursor-help">
              {data.wf_accuracy >= 55
                ? '✓ Model generalises well on out-of-sample data'
                : data.wf_accuracy >= 50
                ? '⚠ Near coin-flip — treat signals with caution'
                : '✗ Below random — market may be in unusual regime'}
            </p>
          </Tooltip>
        </div>

        {/* Model Insights — expandable feature importance chart */}
        {(data.feature_importances_1d?.length > 0 || data.top_features?.length > 0) && (
          <ModelInsights data={data} />
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-slate-600 border-t border-dark-600/40 pt-2">
          <span>Trained on {data.trained_on_days} days · {data.features_used} features</span>
          <Tooltip text={SECTION_TIPS.static_accuracy} align="right">
            <span className="cursor-help underline decoration-dotted decoration-slate-700 underline-offset-2">
              Static acc: {data.model_accuracy}%
            </span>
          </Tooltip>
        </div>

      </div>)}
    </div>
  )
}
