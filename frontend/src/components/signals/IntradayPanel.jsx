import { useState } from 'react'
import { Zap, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, RefreshCw, Brain } from 'lucide-react'
import { useIntradayContext, useIntradayPrediction } from '../../api/signals'
import Tooltip from '../ui/Tooltip'
import Badge from '../ui/Badge'

// ── Tooltip text ─────────────────────────────────────────────────────────────
const TIPS = {
  panel:
    'Real-time intraday context, updated every 2 minutes.\n\n' +
    'Combines 1h RSI, VWAP position, ATR extension, volume pulse, and daily ML direction into one composite score.\n\n' +
    'Answers two questions:\n' +
    '  (1) Should I take profits now?\n' +
    '  (2) Is this a good entry point?',

  signal: {
    STRONG_ENTRY:
      'Multiple indicators align bullishly.\n\n' +
      'Price is oversold on the hourly chart, below VWAP (a discount), and today has used little of the daily range.\n\n' +
      'If the daily ML also says UP, this is a high-conviction entry setup.',
    GOOD_ENTRY:
      'Conditions favour entry.\n\n' +
      'RSI is not overbought and price is near or below VWAP.\n\n' +
      'Confirm with the daily ML direction before acting.',
    WAIT_PULLBACK:
      'Stock is overbought or extended above VWAP. Poor risk/reward to enter here.\n\n' +
      'Wait for RSI to cool below 50, or for price to pull back to VWAP.',
    TAKE_PROFITS:
      'Multiple bearish signals are aligned:\n' +
      '  · RSI severely overbought\n' +
      '  · Price significantly above VWAP\n' +
      '  · Today\'s move already exceeds the average daily range\n\n' +
      'Seriously consider locking in profits.',
    NEUTRAL:
      'No extreme conditions in either direction. No clear edge for entry or exit.\n\n' +
      'Let the daily ML trend and technical signals guide your decision.',
  },

  fromOpen:
    'Percentage change from today\'s opening price to the current price.\n\n' +
    'Positive = stock is up since open.\n' +
    'Negative = trading below open.',

  compositeScore:
    'Composite Score — a −6 to +6 score combining five factors:\n' +
    '  · 1h RSI\n' +
    '  · VWAP deviation\n' +
    '  · ATR extension\n' +
    '  · Volume pulse\n' +
    '  · Daily ML direction\n\n' +
    'Positive scores favour entry. Negative scores suggest caution or exit.\n\n' +
    'Hover each component below for a plain-English explanation.',

  vwap:
    'VWAP = Volume-Weighted Average Price. Resets at market open each day.\n\n' +
    'It is the average price paid, weighted by volume — the benchmark institutions use to judge their fills.\n\n' +
    'Below VWAP → trading at a discount (bullish).\n' +
    'Above VWAP → trading at a premium (bearish).\n\n' +
    'This is the most important intraday price anchor.',

  vwapDev:
    'VWAP Deviation — how far the current price is from VWAP, as a percentage.\n\n' +
    'Negative = below VWAP (bullish discount).\n' +
    'Positive = above VWAP (bearish premium).\n\n' +
    'Deviations beyond ±1.5% are significant and often mean-revert back to VWAP.',

  timeOfDay: {
    OPEN:
      'Market Open (9:30–10:00 ET).\n\n' +
      'The first 30 minutes are extremely volatile. Spreads are wide, algorithms are battling for fills, and many signals are false.\n\n' +
      'Professional traders often wait for the 10am bar before acting. Signals are capped in weight during this window.',
    MID_MORNING:
      'Mid-Morning (10:00–11:00 ET).\n\n' +
      'The best directional window of the day. Volume is high, institutional orders are flowing, and trends established here often persist through midday.\n\n' +
      'This is when signals are most reliable.',
    MIDDAY:
      'Midday (11:00–14:00 ET) — the "dead zone."\n\n' +
      'Volume drops significantly as traders step away. Price often chops sideways and breakouts frequently fail.\n\n' +
      'Signals are less reliable. Wait for Power Hour.',
    POWER_HOUR:
      'Power Hour (14:00–15:30 ET).\n\n' +
      'Institutions place the bulk of their end-of-day orders. Volume surges and trends accelerate or reverse sharply.\n\n' +
      'A great window for momentum trading. Signals are reliable again.',
    CLOSE:
      'Market Close (15:30–16:00 ET).\n\n' +
      'Erratic last-minute position squaring. Mutual funds rebalance, options expire, and algorithmic strategies dominate.\n\n' +
      'Price moves are often not sustainable. Treat signals with extra caution.',
    AFTER_HOURS:
      'After Hours / Pre-Market.\n\n' +
      'Low liquidity, wide spreads, and limited participants. VWAP and intraday signals are based on the last trading session\'s data.\n\n' +
      'Do not act on intraday signals during this window.',
    '24H_MARKET':
      'Crypto trades 24/7 — no fixed session boundaries.\n\n' +
      'Volume and activity vary by timezone. The US session (9am–4pm ET) and the Asian session tend to be most active.',
    UNKNOWN:
      'Time of day could not be determined from the data timestamp.',
  },

  rsi1h:
    'RSI on 1-hour bars — measures momentum over the last 14 hourly candles.\n\n' +
    'Above 65 → overbought (selling pressure likely).\n' +
    'Below 35 → oversold (buying pressure likely).\n\n' +
    'The hourly RSI reacts much faster than the daily RSI. It tells you what is happening right now, not what happened yesterday.',

  atrExtension:
    'ATR Extension — how much of today\'s average daily move has already been used.\n\n' +
    '0.5× = halfway through the typical range (plenty of room to move).\n' +
    '1.0× = full average range used.\n' +
    '1.5× = 50% more than average — extended, risky to chase.\n' +
    '2.0× = extraordinary move, very high reversal risk.',

  volumePulse:
    'Volume Pulse — today\'s total volume vs the 20-day average daily volume.\n\n' +
    'Above 1.5× → institutional money is active; confirms the move.\n' +
    'Below 0.7× → retail-only trading; weak conviction, price may not follow through.',

  support:
    'Support = the lowest price in the last 24 hourly bars.\n\n' +
    'Buyers have historically defended this level.\n\n' +
    'A common stop-loss placement for long trades is just below support.',

  resistance:
    'Resistance = the highest price in the last 24 hourly bars.\n\n' +
    'Sellers have historically stepped in at this level.\n\n' +
    'A common profit-target for long trades, or entry point for short trades.',

  combinedVerdict:
    'Combined Verdict — fuses the daily ML direction with the current intraday signal.\n\n' +
    'This is the most actionable output: it tells you whether the daily trend and the intraday timing are aligned, conflicting, or neutral.\n\n' +
    'Aligned = stronger signal. Conflicting = wait for better timing.',

  intraML:
    '15-minute LightGBM model — a second, independent ML model trained on 15-minute bars.\n\n' +
    'Question it answers: "Will price be higher in ~1 hour (4 bars × 15 min)?"\n\n' +
    'Features it uses:\n' +
    '  · RSI, MACD, Bollinger Bands on 15m bars\n' +
    '  · VWAP deviation (intraday discount/premium)\n' +
    '  · Open-range position (where price sits in today\'s range)\n' +
    '  · Time-of-day encoding\n' +
    '  · Daily RSI as higher-timeframe context\n\n' +
    'Retrained nightly from 60 days of intraday data.\n' +
    'Compare against the daily ML direction for confluence.\n\n' +
    'CAL badge = confidence has been isotonic-regression calibrated on walk-forward held-out predictions.\n' +
    'A calibrated 65% means the model was right ~65% of the time historically on unseen data.',

  intraWF:
    'Walk-Forward Accuracy of the 15m model.\n\n' +
    'Each bar = one test window covering ~2 trading days of 15-minute data.\n\n' +
    'Bars run oldest → most recent (left to right).\n\n' +
    'Colour key:\n' +
    '  · Green  ≥ 55%\n' +
    '  · Yellow ≥ 50%\n' +
    '  · Red    < 50%\n\n' +
    'Hover each bar to see how far back that test was and how much training data was used.',
}

// ── Signal config ─────────────────────────────────────────────────────────────
const SIGNAL_CFG = {
  STRONG_ENTRY:  { label: 'Strong Entry',    color: 'text-emerald-300', bg: 'bg-emerald-500/15 border-emerald-400/40', dot: 'bg-emerald-400' },
  GOOD_ENTRY:    { label: 'Good Entry',      color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400' },
  WAIT_PULLBACK: { label: 'Wait — Pullback', color: 'text-yellow-400',  bg: 'bg-yellow-500/10  border-yellow-500/30',  dot: 'bg-yellow-400' },
  TAKE_PROFITS:  { label: 'Take Profits',    color: 'text-purple-400',  bg: 'bg-purple-500/10  border-purple-500/30',  dot: 'bg-purple-400' },
  NEUTRAL:       { label: 'Neutral',         color: 'text-slate-400',   bg: 'bg-dark-700       border-dark-600',       dot: 'bg-slate-500'  },
}

const ACTION_CFG = {
  BUY:     { label: 'BUY SETUP',  color: 'text-emerald-300', bg: 'bg-emerald-500/15 border-emerald-400/40' },
  SELL:    { label: 'SELL/EXIT',  color: 'text-red-300',     bg: 'bg-red-500/15 border-red-400/40'         },
  WAIT:    { label: 'WAIT',       color: 'text-yellow-400',  bg: 'bg-yellow-500/10 border-yellow-500/30'   },
  NEUTRAL: { label: 'NEUTRAL',    color: 'text-slate-400',   bg: 'bg-dark-700 border-dark-600'             },
}

const TIME_LABELS = {
  OPEN:        { label: 'Market Open',   caution: true  },
  MID_MORNING: { label: 'Mid-Morning',   caution: false },
  MIDDAY:      { label: 'Midday Lull',   caution: true  },
  POWER_HOUR:  { label: 'Power Hour',    caution: false },
  CLOSE:       { label: 'Market Close',  caution: true  },
  AFTER_HOURS: { label: 'After Hours',   caution: true  },
  '24H_MARKET':{ label: '24h Market',    caution: false },
  UNKNOWN:     { label: '',              caution: false },
}

// ── Hourly candle sparkline ───────────────────────────────────────────────────
function HourlySpark({ bars }) {
  if (!bars?.length) return null
  const prices = bars.flatMap(b => [b.high, b.low])
  const lo = Math.min(...prices), hi = Math.max(...prices)
  const range = hi - lo || 1
  const W = 200, H = 44, bw = W / bars.length
  const py = v => H - ((v - lo) / range) * (H - 4) - 2
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full">
      {bars.map((b, i) => {
        const isGreen = b.close >= b.open
        const color   = isGreen ? '#10b981' : '#ef4444'
        const cx      = i * bw + bw / 2
        const bTop    = py(Math.max(b.open, b.close))
        const bBot    = py(Math.min(b.open, b.close))
        return (
          <g key={i}>
            <line x1={cx} y1={py(b.high)} x2={cx} y2={py(b.low)} stroke={color} strokeWidth={0.8} opacity={0.6} />
            <rect x={i * bw + bw * 0.2} y={bTop} width={bw * 0.6} height={Math.max(1.5, bBot - bTop)} fill={color} rx={0.5} />
          </g>
        )
      })}
    </svg>
  )
}

// ── RSI arc gauge ─────────────────────────────────────────────────────────────
function RsiGauge({ rsi }) {
  const angle = (rsi / 100) * 180
  const r = 28, cx = 36, cy = 32
  const rad = (angle - 180) * (Math.PI / 180)
  const nx = cx + r * Math.cos(rad), ny = cy + r * Math.sin(rad)
  const color = rsi >= 65 ? '#f59e0b' : rsi <= 35 ? '#10b981' : '#64748b'
  return (
    <svg width={72} height={36} viewBox="0 0 72 36">
      <path d="M 8 32 A 28 28 0 0 1 64 32" fill="none" stroke="#334155" strokeWidth={5} strokeLinecap="round" />
      <path d={`M 8 32 A 28 28 0 0 1 ${nx.toFixed(1)} ${ny.toFixed(1)}`} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={2.5} fill={color} />
    </svg>
  )
}

// ── Composite score bar ───────────────────────────────────────────────────────
function ScoreBar({ score }) {
  // score: -6 to +6 → map to 0–100% with 50% = 0
  const pct = Math.round(((score + 6) / 12) * 100)
  const color = score >= 2 ? 'bg-emerald-500' : score <= -2 ? 'bg-red-400' : 'bg-yellow-500'
  return (
    <div className="relative w-full h-2 bg-dark-600 rounded-full overflow-hidden">
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-dark-400 z-10" />
      <div
        className={`absolute top-0 bottom-0 ${color} rounded-full transition-all duration-500`}
        style={score >= 0
          ? { left: '50%', width: `${pct - 50}%` }
          : { left: `${pct}%`, width: `${50 - pct}%` }
        }
      />
    </div>
  )
}

// ── Intraday WF sparkline ─────────────────────────────────────────────────────
// Cap at 24 rounds — covers all typical stock scenarios (stocks produce ~16-22 rounds).
// Still prevents overflow for crypto which can produce 50+ rounds.
// Each round covers ~2 trading days (52 bars × 15 min = 13 h ≈ 2 trading days).
const INTRA_WF_MAX       = 24
const DAYS_PER_ROUND     = 2    // fallback estimate when dates not available
const TRAIN_DAYS_INITIAL = 10   // min_train = 260 bars ÷ 26 bars/day = 10 days

const INTRA_AXIS_TIP_LEFT  =
  'Oldest 15m WF test window shown. Each bar covers ~2 trading days of 15-minute data.\n\nBars run left (oldest) → right (most recent).\n\n⚠ These dates are HISTORICAL test windows — they do NOT represent the data used for the current prediction. The live prediction always uses the most recent 15m bar (see "as of HH:MM" in the header).'
const INTRA_AXIS_TIP_RIGHT =
  'Most recent historical test window — the hardest test. Model trained on earlier intraday data, tested on the latest complete session.\n\nIf red, the model\'s intraday patterns are not matching recent market behaviour.\n\n⚠ This is NOT the current prediction bar. The current prediction uses the live bar shown as "as of HH:MM" in the header above.'
const INTRA_OVERFLOW_TIP   =
  'Crypto trades 24/7 and produces more WF rounds than stocks (96-bar test windows vs 52). Only the most recent rounds are shown to keep the display compact.'

function IntraWFSparkline({ history, dates, diagnostics }) {
  if (!history?.length) return null

  const total    = history.length
  const visible  = history.slice(-INTRA_WF_MAX)
  const visDates = dates?.slice(-INTRA_WF_MAX) ?? []
  const visDiag  = diagnostics?.slice(-INTRA_WF_MAX) ?? []
  const offset   = total - visible.length   // hidden rounds on the left
  const max      = Math.max(...visible, 60)

  // Axis label helpers
  const leftLabel  = visDates[0]?.[0]
    ?? (total > INTRA_WF_MAX
      ? `oldest shown (~${(visible.length - 1) * DAYS_PER_ROUND + DAYS_PER_ROUND} days ago)`
      : `~${(visible.length - 1) * DAYS_PER_ROUND + DAYS_PER_ROUND} days ago`)
  const rightLabel = visDates[visDates.length - 1]?.[1] ?? 'most recent'

  return (
    <div className="space-y-1">

      {/* Bars */}
      <div className="flex items-end gap-0.5 h-6">
        {visible.map((acc, i) => {
          const roundNum = offset + i + 1

          // Actual date range from backend (preferred) or fallback approximation
          const dPair     = visDates[i]
          const trainDays = TRAIN_DAYS_INITIAL + (roundNum - 1) * DAYS_PER_ROUND

          const recencyLabel = dPair
            ? `${dPair[0]} – ${dPair[1]}`
            : (visible.length - 1 - i) === 0
              ? 'most recent test period (last 2 trading days)'
              : `~${(visible.length - 1 - i) * DAYS_PER_ROUND}–${(visible.length - i) * DAYS_PER_ROUND} trading days ago`

          const diag = visDiag[i]
          const tip =
            `Round ${roundNum} of ${total} — ${recencyLabel}\n\n` +
            `Accuracy: ${acc}%\n` +
            `Trained on: ~${trainDays} trading days of 15m data.\n` +
            `Tested on: ~2 trading days of 15m data.` +
            (diag ? `\n\n${diag}` : '')

          const h     = Math.max(4, (acc / max) * 24)
          const color = acc >= 55 ? 'bg-emerald-500' : acc >= 50 ? 'bg-yellow-500' : 'bg-red-400'
          const align = i >= visible.length - 3 ? 'right' : 'center'

          return (
            <Tooltip key={i} text={tip} align={align} xwide>
              <div
                className={`w-3 rounded-sm ${color} opacity-80 cursor-help flex-shrink-0`}
                style={{ height: `${h}px` }}
              />
            </Tooltip>
          )
        })}
      </div>

      {/* Axis labels — with tooltips */}
      <div className="flex justify-between text-xs text-slate-500">
        <Tooltip text={INTRA_AXIS_TIP_LEFT} wide>
          <span className="cursor-help">{leftLabel}</span>
        </Tooltip>
        <Tooltip text={INTRA_AXIS_TIP_RIGHT} wide align="right">
          <span className="cursor-help">{rightLabel}</span>
        </Tooltip>
      </div>

      {total > INTRA_WF_MAX && (
        <Tooltip text={INTRA_OVERFLOW_TIP} wide>
          <p className="text-xs text-slate-500 cursor-help">
            Showing last {INTRA_WF_MAX} of {total} rounds · covering ~{INTRA_WF_MAX * DAYS_PER_ROUND} trading days
          </p>
        </Tooltip>
      )}

    </div>
  )
}


// ── Intraday ML prediction box (15m LightGBM) ─────────────────────────────────
function IntradayMLBox({ symbol, assetType }) {
  const { data, isPending, error } = useIntradayPrediction(symbol, assetType)

  if (isPending) {
    return (
      <div className="bg-dark-700/40 rounded-lg px-3 py-2.5 animate-pulse space-y-2">
        <div className="h-3 w-32 bg-dark-600 rounded" />
        <div className="h-6 w-48 bg-dark-600 rounded" />
      </div>
    )
  }
  if (error || !data) return null   // 15m not available for this symbol — hide silently

  const isUp     = data.direction === 'UP'
  const dirColor = isUp ? 'text-emerald-400' : 'text-red-400'
  const dirBg    = isUp
    ? 'bg-emerald-500/10 border-emerald-500/30'
    : 'bg-red-500/10 border-red-500/30'

  // Confidence colour — higher = more certain
  const confColor = data.confidence_pct >= 70 ? (isUp ? 'text-emerald-300' : 'text-red-300')
                  : data.confidence_pct >= 60 ? (isUp ? 'text-emerald-400' : 'text-red-400')
                  : 'text-slate-400'

  const topNames = (data.top_features ?? []).slice(0, 3).map(([name]) => name).join(', ')

  const wfColor = data.wf_accuracy >= 55 ? 'text-emerald-400'
               : data.wf_accuracy >= 50 ? 'text-yellow-400'
               : 'text-red-400'

  return (
    <div className="bg-dark-700/40 rounded-lg px-3 py-2.5 border border-dark-600/60 space-y-2.5">

      {/* Header row */}
      <div className="flex items-center gap-1.5">
        <Brain size={12} className="text-brand-400" />
        <Tooltip text={TIPS.intraML} wide>
          <span className="text-xs text-slate-500 font-medium cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
            15m ML Prediction
          </span>
        </Tooltip>
        <span className="text-xs text-slate-500">· ~{data.horizon_minutes} min horizon</span>
        {data.scored_bar_time && (() => {
          const t = new Date(data.scored_bar_time)
          const hhmm = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
          return (
            <Tooltip text={`Scored on bar: ${data.scored_bar_time}\n\nThe WF dates in the sparkline below show historical test windows used to measure accuracy — they are NOT the input to this prediction.\n\nThis prediction was made on the most recent 15m bar (${hhmm}).`} wide align="right">
              <span className="ml-auto text-xs text-slate-600 cursor-help underline decoration-dotted decoration-slate-700 underline-offset-2">
                as of {hhmm}
              </span>
            </Tooltip>
          )
        })()}
      </div>

      {/* Direction + confidence */}
      <div className="flex items-center gap-3">
        <span className={`text-xs font-bold px-2.5 py-1 rounded border ${dirBg} ${dirColor}`}>
          {isUp ? '▲ UP' : '▼ DOWN'}
        </span>
        <span className={`text-xl font-bold leading-none ${confColor}`}>
          {data.confidence_pct}%
        </span>
        {data.is_calibrated ? (
          <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-900/50 text-cyan-400 border border-cyan-700/40">
            CAL
          </span>
        ) : (
          <span className="text-xs px-1.5 py-0.5 rounded bg-dark-600 text-slate-600 border border-dark-500/40">
            RAW
          </span>
        )}
        <span className="text-xs text-slate-600">confidence</span>
        <span className="ml-auto text-xs text-slate-500">
          {data.trained_on_bars.toLocaleString()} bars · {data.wf_history?.length ?? 0} WF rounds
        </span>
      </div>

      {/* Walk-forward accuracy + sparkline */}
      {data.wf_history?.length > 0 && (
        <div className="border-t border-dark-600/50 pt-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <Tooltip text={TIPS.intraWF} wide>
              <span className="text-xs text-slate-500 cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
                Walk-Forward Accuracy
              </span>
            </Tooltip>
            <span className={`text-sm font-bold ${wfColor}`}>
              {data.wf_accuracy}%
              {data.wf_accuracy_std > 0 && (
                <span className="text-xs font-normal text-slate-600 ml-1">
                  ±{data.wf_accuracy_std}%
                </span>
              )}
            </span>
          </div>
          <IntraWFSparkline history={data.wf_history} dates={data.wf_dates} diagnostics={data.wf_diagnostics} />
          <Tooltip
            text={
              data.wf_accuracy >= 55
                ? 'The 15m model correctly predicted whether price was higher ~1 hour later in most test windows. Use alongside the daily ML direction — when both agree, confidence is higher.'
                : data.wf_accuracy >= 50
                ? 'The 15m model is only slightly better than a coin-flip on recent intraday data. Check the rightmost bars — if red, the current intraday regime is harder to predict.'
                : '15m patterns in recent sessions are not matching the model\'s learned behaviour. Common causes: low volume, news-driven day, or unusual volatility. Hover red bars for context.'
            }
            wide
          >
            <p className="text-xs text-slate-600 cursor-help">
              {data.wf_accuracy >= 55
                ? '✓ Generalises well on out-of-sample 15m data'
                : data.wf_accuracy >= 50
                ? '⚠ Near coin-flip — treat as one input among several'
                : '✗ Below random — 15m patterns noisy in current regime'}
            </p>
          </Tooltip>
        </div>
      )}

      {/* Top drivers */}
      {topNames && (
        <p className="text-xs text-slate-600 border-t border-dark-600/50 pt-2">
          Top drivers: <span className="text-slate-500">{topNames}</span>
        </p>
      )}

    </div>
  )
}


// ── Skeleton loader ───────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="card space-y-3 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 bg-dark-600 rounded" />
        <div className="h-4 w-36 bg-dark-600 rounded" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map(i => <div key={i} className="h-20 bg-dark-600 rounded-lg" />)}
      </div>
      <div className="h-8 bg-dark-600 rounded" />
      <div className="h-12 bg-dark-600 rounded" />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function IntradayPanel({ symbol, assetType, dailyDirection = 'UNKNOWN', dailyConfidence = 0 }) {
  const [open, setOpen] = useState(true)
  const { data, isPending, error, dataUpdatedAt, refetch, isFetching } = useIntradayContext(
    symbol, assetType, dailyDirection, dailyConfidence,
  )

  // "Updated at HH:MM" label — recompute whenever data refreshes
  const updatedLabel = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  if (!symbol)   return null
  if (isPending) return <Skeleton />
  if (error)     return null

  const cfg        = SIGNAL_CFG[data.intraday_signal]  ?? SIGNAL_CFG.NEUTRAL
  const actionCfg  = ACTION_CFG[data.combined_action]  ?? ACTION_CFG.NEUTRAL
  const signalTip  = TIPS.signal[data.intraday_signal] ?? TIPS.signal.NEUTRAL
  const timeTip    = TIPS.timeOfDay[data.time_of_day]  ?? ''
  const timeCfg    = TIME_LABELS[data.time_of_day]     ?? { label: data.time_of_day, caution: false }

  const isUp        = data.today_change_pct >= 0
  const ChangeIcon  = isUp ? TrendingUp : data.today_change_pct === 0 ? Minus : TrendingDown
  const changeColor = isUp ? 'text-emerald-400' : 'text-red-400'
  const rsiColor    = data.rsi_1h >= 65 ? 'text-yellow-400' : data.rsi_1h <= 35 ? 'text-emerald-400' : 'text-slate-300'
  const vwapColor   = data.vwap_position === 'BELOW_VWAP' ? 'text-emerald-400'
                    : data.vwap_position === 'ABOVE_VWAP' ? 'text-red-400'
                    : 'text-slate-400'
  const maxScore = 6

  return (
    <div className="card space-y-0 overflow-visible">

      {/* ── Header (always visible) ── */}
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center justify-between py-1 text-left cursor-pointer"
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) }
        }}
      >
        <div className="flex items-center gap-2.5">
          <Zap size={15} className="text-yellow-400" />
          <Tooltip text={TIPS.panel} wide>
            <span className="font-semibold text-slate-200 text-sm cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
              Intraday Context
            </span>
          </Tooltip>
          <Tooltip text={signalTip} wide>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border cursor-help ${cfg.bg} ${cfg.color}`}>
              {cfg.label}
            </span>
          </Tooltip>
        </div>
        <div className="flex items-center gap-3">
          {/* From-open change */}
          <Tooltip text={TIPS.fromOpen} align="right">
            <div className="flex items-center gap-1.5 text-xs cursor-help">
              <ChangeIcon size={12} className={changeColor} />
              <span className={`font-semibold ${changeColor}`}>
                {isUp ? '+' : ''}{data.today_change_pct}%
              </span>
              <span className="text-slate-600 underline decoration-dotted decoration-slate-700 underline-offset-2">
                from open
              </span>
            </div>
          </Tooltip>
          {/* Freshness + refresh */}
          {updatedLabel && (
            <span className="text-xs text-slate-500 hidden sm:inline">
              {isFetching ? 'Updating…' : `Updated ${updatedLabel}`}
            </span>
          )}
          <button
            onClick={e => { e.stopPropagation(); refetch() }}
            disabled={isFetching}
            className="p-0.5 rounded text-slate-700 hover:text-slate-400 disabled:opacity-40 transition-colors"
            title="Refresh intraday data"
          >
            <RefreshCw size={11} className={isFetching ? 'animate-spin text-brand-400' : ''} />
          </button>
          {open ? <ChevronUp size={14} className="text-slate-600" /> : <ChevronDown size={14} className="text-slate-600" />}
        </div>
      </div>

      {/* ── Expandable body ── */}
      {open && (
        <div className="space-y-4 pt-3 border-t border-dark-600/60">

          {/* Time of day badge + OHLC price strip */}
          <div className="flex flex-wrap items-center justify-between gap-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              {timeCfg.label && (
                <Tooltip text={timeTip} wide>
                  <span className="cursor-help">
                    <Badge tone={timeCfg.caution ? 'warning' : 'bullish'}>
                      {timeCfg.caution ? '⚠ ' : '✓ '}{timeCfg.label}
                    </Badge>
                  </span>
                </Tooltip>
              )}
              <span className="text-xs text-slate-600">
                O <span className="text-slate-300">${data.today_open.toLocaleString()}</span>
                {' '}H <span className="text-emerald-400">${data.today_high.toLocaleString()}</span>
                {' '}L <span className="text-red-400">${data.today_low.toLocaleString()}</span>
                {' '}Now <span className="text-slate-100 font-semibold">${data.current_price.toLocaleString()}</span>
              </span>
            </div>
          </div>

          {/* Three metric boxes */}
          <div className="grid grid-cols-3 gap-3">

            {/* RSI 1h */}
            <div className="bg-dark-700/60 rounded-lg p-3 space-y-1">
              <Tooltip text={TIPS.rsi1h} wide>
                <p className="text-xs text-slate-500 font-medium cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2 w-fit">
                  1h RSI
                </p>
              </Tooltip>
              <div className="flex items-end gap-2">
                <RsiGauge rsi={data.rsi_1h} />
                <div>
                  <p className={`text-lg font-bold leading-none ${rsiColor}`}>{data.rsi_1h}</p>
                  <p className={`text-xs font-medium mt-0.5 ${rsiColor}`}>{data.rsi_status}</p>
                </div>
              </div>
              <p className="text-xs text-slate-600">
                {data.rsi_1h >= 65 ? 'Sellers may step in' : data.rsi_1h <= 35 ? 'Buyers may step in' : 'No extreme'}
              </p>
            </div>

            {/* ATR Extension */}
            <div className="bg-dark-700/60 rounded-lg p-3 space-y-1">
              <Tooltip text={TIPS.atrExtension} wide>
                <p className="text-xs text-slate-500 font-medium cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2 w-fit">
                  Day Extension
                </p>
              </Tooltip>
              <p className={`text-lg font-bold ${data.atr_coverage >= 1.5 ? 'text-red-400' : data.atr_coverage >= 1.0 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                {data.atr_coverage}×
                <span className="text-xs font-normal text-slate-500 ml-1">ATR</span>
              </p>
              <div className="w-full h-1.5 bg-dark-600 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${data.atr_coverage >= 1.5 ? 'bg-red-400' : data.atr_coverage >= 1.0 ? 'bg-yellow-400' : 'bg-emerald-400'}`}
                  style={{ width: `${Math.min(data.atr_coverage / 2, 1) * 100}%` }}
                />
              </div>
              <p className="text-xs text-slate-600">
                ${data.today_move_usd.toFixed(2)} of ${data.daily_atr.toFixed(2)} avg
              </p>
            </div>

            {/* Volume Pulse */}
            <div className="bg-dark-700/60 rounded-lg p-3 space-y-1">
              <Tooltip text={TIPS.volumePulse} wide align="right">
                <p className="text-xs text-slate-500 font-medium cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2 w-fit">
                  Volume Pulse
                </p>
              </Tooltip>
              <p className={`text-lg font-bold ${data.volume_ratio >= 1.5 ? 'text-brand-400' : data.volume_ratio <= 0.7 ? 'text-slate-500' : 'text-slate-300'}`}>
                {data.volume_ratio}×
              </p>
              <div className="w-full h-1.5 bg-dark-600 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${data.volume_ratio >= 1.5 ? 'bg-brand-400' : data.volume_ratio <= 0.7 ? 'bg-slate-600' : 'bg-slate-400'}`}
                  style={{ width: `${Math.min(data.volume_ratio / 2, 1) * 100}%` }}
                />
              </div>
              <p className="text-xs text-slate-600">
                {data.volume_ratio >= 1.5 ? '✓ Institutional conviction' : data.volume_ratio <= 0.7 ? 'Low — weak conviction' : 'Normal activity'}
              </p>
            </div>

          </div>

          {/* VWAP row */}
          <div className="bg-dark-700/40 rounded-lg px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <Tooltip text={TIPS.vwap} wide>
              <span className="text-xs text-slate-500 font-medium cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
                VWAP
              </span>
            </Tooltip>
            <span className="text-sm font-semibold text-slate-200">${data.vwap.toLocaleString()}</span>
            <Tooltip text={TIPS.vwapDev} wide>
              <span className={`text-xs font-semibold cursor-help ${vwapColor}`}>
                {data.vwap_deviation_pct >= 0 ? '+' : ''}{data.vwap_deviation_pct}%
              </span>
            </Tooltip>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              data.vwap_position === 'BELOW_VWAP' ? 'bg-emerald-500/10 text-emerald-400' :
              data.vwap_position === 'ABOVE_VWAP' ? 'bg-red-500/10 text-red-400' :
              'bg-dark-600 text-slate-400'
            }`}>
              {data.vwap_position === 'BELOW_VWAP' ? '↓ Below VWAP — discount' :
               data.vwap_position === 'ABOVE_VWAP' ? '↑ Above VWAP — premium' :
               '≈ At VWAP'}
            </span>
          </div>

          {/* Composite score */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tooltip text={TIPS.compositeScore} wide>
                <span className="text-xs text-slate-500 font-medium cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
                  Composite Score
                </span>
              </Tooltip>
              <span className={`text-sm font-bold ${data.composite_score >= 2 ? 'text-emerald-400' : data.composite_score <= -2 ? 'text-red-400' : 'text-yellow-400'}`}>
                {data.composite_score > 0 ? '+' : ''}{data.composite_score} / {maxScore}
              </span>
            </div>
            <ScoreBar score={data.composite_score} />
            <div className="flex justify-between text-xs text-slate-500">
              <span>−6 bearish</span><span>0</span><span>+6 bullish</span>
            </div>
            {data.score_components?.length > 0 && (
              <ul className="space-y-0.5 mt-1">
                {data.score_components.map((c, i) => (
                  <li key={i} className="text-xs text-slate-500 flex items-start gap-1.5">
                    <span className="text-slate-700 mt-0.5">·</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 15m ML Prediction */}
          <IntradayMLBox symbol={symbol} assetType={assetType} />

          {/* Hourly sparkline */}
          {data.hourly_bars?.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-slate-600">Last {data.hourly_bars.length} hourly candles</p>
              <div className="bg-dark-700/40 rounded-lg px-2 py-1.5">
                <HourlySpark bars={data.hourly_bars} />
              </div>
            </div>
          )}

          {/* Combined Verdict — the money box */}
          {data.daily_direction !== 'UNKNOWN' && (
            <Tooltip text={TIPS.combinedVerdict} wide>
              <div className={`rounded-lg px-4 py-3 border cursor-help w-full ${actionCfg.bg} space-y-1`}>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${actionCfg.bg} ${actionCfg.color} border ${actionCfg.bg}`}>
                    {actionCfg.label}
                  </span>
                  <span className="text-xs text-slate-500">
                    Daily ML {data.daily_direction === 'UP' ? '↑' : '↓'} {data.daily_direction} ({data.daily_confidence}%)
                    {' + '}Intraday {cfg.label}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{data.combined_verdict}</p>
              </div>
            </Tooltip>
          )}

          {/* Intraday signal box (shown when no daily context yet) */}
          {data.daily_direction === 'UNKNOWN' && (
            <Tooltip text={signalTip} wide>
              <div className={`rounded-lg px-4 py-3 border cursor-help w-full ${cfg.bg} space-y-1`}>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${cfg.dot} flex-shrink-0`} />
                  <span className={`font-semibold text-sm ${cfg.color}`}>{cfg.label}</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{data.signal_reason}</p>
                <p className="text-xs text-slate-600 italic">
                  Tip: Load the ML Prediction panel to unlock the Combined Verdict with daily trend context.
                </p>
              </div>
            </Tooltip>
          )}

          {/* Support / Resistance */}
          <div className="flex items-center justify-between text-xs text-slate-500 border-t border-dark-600/40 pt-2">
            <Tooltip text={TIPS.support} wide>
              <span className="cursor-help">
                <span className="underline decoration-dotted decoration-slate-600 underline-offset-2">Support</span>
                {' '}<span className="text-emerald-400 font-medium">${data.nearest_support.toLocaleString()}</span>
              </span>
            </Tooltip>
            <span className="text-slate-700">·</span>
            <Tooltip text={TIPS.resistance} wide align="right">
              <span className="cursor-help">
                <span className="underline decoration-dotted decoration-slate-600 underline-offset-2">Resistance</span>
                {' '}<span className="text-red-400 font-medium">${data.nearest_resistance.toLocaleString()}</span>
              </span>
            </Tooltip>
            <span className="text-slate-700">·</span>
            <span className="text-slate-500 text-xs">from last 24h swings</span>
          </div>

        </div>
      )}
    </div>
  )
}
