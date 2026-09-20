import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useMarketStore } from '../../store/marketStore'
import {
  TrendingUp, TrendingDown, Clock, CheckCircle2, XCircle, Minus,
  BarChart2, Loader2, ChevronDown, ChevronRight, RefreshCw,
} from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import VixRegimeBanner from '../ui/VixRegimeBanner'
import {
  usePredictionHistory,
  useAllPredictionHistory,
  usePredictionAccuracy,
  useTriggerPopulate,
  useTriggerNextDayPopulate,
  usePopulateStatus,
  useTriggerResolve,
} from '../../api/predictionHistory'

// ── Tooltip text constants ─────────────────────────────────────────────────────

const TIPS = {
  accuracy:
    'Overall prediction accuracy across all resolved 1D and 1W predictions.\n\nCORRECT = predicted direction matched actual close price movement.\nWRONG = direction was opposite.\nPUSH = actual move < 0.3% — too small to call, excluded from accuracy %.',

  highConf:
    'Accuracy when the model\'s calibrated confidence was ≥58%.\n\nPredictions below 58% are near coin-flips — the model has weak signal and these are no longer logged.\nHigh-confidence predictions reflect stronger agreement across signals and are meaningfully more reliable.\n\nFocus on ★ predictions when making trading decisions.',

  todayCalls:
    'ML model predictions logged by the most recent conviction scan.\n\n1D = model\'s view on next trading day\'s close direction.\n1W = model\'s view over the next 5 trading days.\n\nUpdates nightly at 06:00 when the conviction scan runs, or instantly when you trigger a manual scan.',

  horizon1d:
    '1-Day Horizon — model predicts whether tomorrow\'s close will be higher or lower than today\'s close.\n\nResolved the next trading day after logging.',

  horizon1w:
    '5-Day Horizon — model predicts whether the close 5 trading days from now will be higher or lower than the close when logged.\n\nResolved after 5 trading days.',

  highConfStar:
    'High confidence — model\'s calibrated probability ≥58%.\n\nRegime-aware calibration is applied: in bear markets the model compresses overconfident UP signals. In bull markets it amplifies strong UP signals.\n\nThese predictions have historically been more accurate than low-confidence ones. Predictions below 58% are no longer logged.',

  trackRecord:
    'Historical predictions logged by the nightly conviction scan, grouped by date.\n\nEach row shows both 1D and 1W predictions for a symbol on that date, along with the actual outcome once the target date\'s close was available.\n\nExpand a date group to see individual symbol results.',

  groupStats:
    'Correct and Wrong counts for resolved predictions in this date group.\nPUSH outcomes (move < 0.3%) are excluded.\nPending = target date not yet reached.',

  colPrediction:
    'Direction the model predicted (UP/DOWN) and its calibrated confidence %.\n\n★ = high confidence (≥58%) — more actionable signal.\nOutcome shown once the target trading day\'s close is available.',

  outcomeCorrect:
    'CORRECT — predicted direction matched actual price move.\nShows the actual % move on the target trading day.',

  outcomeWrong:
    'WRONG — predicted direction was opposite to actual price move.\nShows the actual % move (opposite to what the model expected).',

  outcomePush:
    'PUSH — actual price move was less than 0.3%.\nToo small to call — excluded from accuracy calculation.',

  outcomePending:
    'Pending — the target trading day hasn\'t arrived yet, or the close price data isn\'t available.\nWill auto-resolve the next time you open this tab.',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function localDateStr(offset = 0) {
  const d = new Date(Date.now() - offset * 864e5)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const TODAY     = localDateStr(0)
const YESTERDAY = localDateStr(1)

function nextTradingDay() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const TOMORROW      = nextTradingDay()
const NEXT_CAL_DAY  = localDateStr(-1)
const IS_LITERAL_TOMORROW = TOMORROW === NEXT_CAL_DAY  // false on Fri/Sat/Sun

function shortDate(isoStr) {
  return new Date(isoStr + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function fmtDate(d) {
  if (d === TOMORROW)  return IS_LITERAL_TOMORROW ? 'Tomorrow' : new Date(d + 'T00:00:00').toLocaleDateString([], { weekday: 'long' })
  if (d === TODAY)     return 'Today'
  if (d === YESTERDAY) return 'Yesterday'
  return new Date(d + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// Group flat rows → [ { date, symbolEntries: [ { symbol, '1d': row|null, '1w': row|null } ] } ]
function groupByDateAndSymbol(rows) {
  const dateMap = {}
  for (const row of rows) {
    if (!dateMap[row.logged_date]) dateMap[row.logged_date] = {}
    if (!dateMap[row.logged_date][row.symbol]) {
      dateMap[row.logged_date][row.symbol] = { symbol: row.symbol, asset_type: row.asset_type, '1d': null, '1w': null }
    }
    dateMap[row.logged_date][row.symbol][row.horizon] = row
  }
  return Object.keys(dateMap)
    .sort((a, b) => b.localeCompare(a))
    .map(date => ({
      date,
      symbolEntries: Object.values(dateMap[date]).sort((a, b) => a.symbol.localeCompare(b.symbol)),
    }))
}

// ── Tiny sub-components ───────────────────────────────────────────────────────

function DirIcon({ direction, size = 11 }) {
  if (direction === 'UP')   return <TrendingUp   size={size} className="text-emerald-400" />
  if (direction === 'DOWN') return <TrendingDown size={size} className="text-red-400" />
  return <Minus size={size} className="text-slate-500" />
}

function OutcomeDot({ outcome, movePct }) {
  if (!outcome) return (
    <Tooltip text={TIPS.outcomePending}>
      <span className="flex items-center gap-1 text-slate-500 text-xs cursor-help"><Clock size={11} /> Pending</span>
    </Tooltip>
  )
  if (outcome === 'CORRECT') return (
    <Tooltip text={TIPS.outcomeCorrect}>
      <span className="flex items-center gap-1 text-emerald-400 text-xs font-semibold cursor-help">
        <CheckCircle2 size={11} />
        {movePct != null ? `${movePct > 0 ? '+' : ''}${movePct.toFixed(1)}%` : 'Correct'}
      </span>
    </Tooltip>
  )
  if (outcome === 'WRONG') return (
    <Tooltip text={TIPS.outcomeWrong}>
      <span className="flex items-center gap-1 text-red-400 text-xs font-semibold cursor-help">
        <XCircle size={11} />
        {movePct != null ? `${movePct > 0 ? '+' : ''}${movePct.toFixed(1)}%` : 'Wrong'}
      </span>
    </Tooltip>
  )
  return (
    <Tooltip text={TIPS.outcomePush}>
      <span className="text-slate-500 text-xs cursor-help">Push</span>
    </Tooltip>
  )
}

// ── Today's Call card ─────────────────────────────────────────────────────────

function TodayCard({ entry, onSymbolClick }) {
  const { symbol, '1d': d1, '1w': d1w } = entry

  // Highlight border if any horizon is high confidence
  const hasHighConf = [d1, d1w].some(r => r && r.confidence_pct >= 58)
  const borderCls = hasHighConf
    ? 'border-amber-500/40 bg-amber-500/5'
    : 'border-dark-500 bg-dark-700/40'

  function HorizonRow({ row, label }) {
    if (!row) return null
    const is1w = label === '1W'
    const dirColor = row.direction === 'UP' ? 'text-emerald-400' : row.direction === 'DOWN' ? 'text-red-400' : 'text-slate-400'
    const isHigh = row.confidence_pct >= 58
    const horizonTip = is1w ? TIPS.horizon1w : TIPS.horizon1d
    return (
      <div className={`flex items-center justify-between gap-2 ${!is1w ? 'opacity-70' : ''}`}>
        <Tooltip text={horizonTip}>
          <span className={`font-mono cursor-help underline decoration-dotted w-5 ${is1w ? 'text-xs text-brand-400 font-semibold' : 'text-xs text-slate-500'}`}>
            {label}
          </span>
        </Tooltip>
        <div className="flex items-center gap-1">
          <DirIcon direction={row.direction} size={is1w ? 11 : 10} />
          <span className={`font-bold ${dirColor} ${is1w ? 'text-sm' : 'text-xs'}`}>{row.direction}</span>
        </div>
        <span className={`tabular-nums font-semibold ${isHigh ? 'text-amber-300' : 'text-slate-300'} ${is1w ? 'text-sm' : 'text-xs'}`}>
          {row.confidence_pct.toFixed(1)}%
        </span>
        {isHigh ? (
          <Tooltip text={TIPS.highConfStar}>
            <span className="text-xs text-amber-400 font-bold cursor-help">★</span>
          </Tooltip>
        ) : (
          <span className="w-2" />
        )}
        <div className="ml-auto">
          <OutcomeDot outcome={row.outcome} movePct={row.actual_move_pct} />
        </div>
      </div>
    )
  }

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${borderCls}`}>
      <div className="flex items-center justify-between">
        <button
          onClick={() => onSymbolClick(symbol, entry.asset_type)}
          className="font-bold text-slate-100 text-sm hover:text-brand-400 transition-colors text-left"
        >
          {symbol}
        </button>
        {entry.asset_type === 'crypto' && (
          <span className="text-[11px] text-slate-500 uppercase">crypto</span>
        )}
      </div>
      <div className="space-y-1.5 border-t border-dark-600/50 pt-2">
        <HorizonRow row={d1w} label="1W" />
        <HorizonRow row={d1}  label="1D" />
      </div>
    </div>
  )
}

// ── Track Record date group ───────────────────────────────────────────────────

function DateGroup({ group, defaultOpen, onSymbolClick }) {
  const [open, setOpen] = useState(defaultOpen)

  // Compute group-level stats (resolved rows only)
  const resolved = group.symbolEntries.flatMap(e =>
    [e['1d'], e['1w']].filter(r => r && r.resolved && r.outcome !== 'PUSH')
  )
  const correct = resolved.filter(r => r.outcome === 'CORRECT').length
  const wrong   = resolved.filter(r => r.outcome === 'WRONG').length

  const statsEl = resolved.length > 0 ? (
    <Tooltip text={TIPS.groupStats} align="right">
      <span className="text-sm text-slate-500 cursor-help">
        <span className="text-emerald-400 font-medium">{correct}✓</span>
        {' / '}
        <span className="text-red-400 font-medium">{wrong}✗</span>
        {' resolved'}
      </span>
    </Tooltip>
  ) : (
    <span className="text-xs text-slate-600">pending</span>
  )

  return (
    <div className="border border-dark-600/40 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-dark-700/60 hover:bg-dark-700 transition-colors"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronRight size={13} className="text-slate-500" />}
          <span className="text-sm font-semibold text-slate-200">{fmtDate(group.date)}</span>
          <span className="text-xs text-slate-500">{group.symbolEntries.length} symbols</span>
        </div>
        {statsEl}
      </button>

      {/* Rows */}
      {open && (
        <table className="w-full">
          <thead>
            <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-dark-600/40 bg-dark-800/40">
              <th className="pl-4 pr-2 py-2 text-left font-medium w-24">Symbol</th>
              <th className="px-3 py-2 text-left font-medium">
                <Tooltip text={TIPS.colPrediction}>
                  <span className="cursor-help underline decoration-dotted">1D Prediction</span>
                </Tooltip>
              </th>
              <th className="px-3 py-2 text-left font-medium">
                <Tooltip text={TIPS.colPrediction}>
                  <span className="cursor-help underline decoration-dotted">1W Prediction</span>
                </Tooltip>
              </th>
            </tr>
          </thead>
          <tbody>
            {group.symbolEntries.map(entry => (
              <SymbolRow key={entry.symbol} entry={entry} onSymbolClick={onSymbolClick} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function SymbolRow({ entry, onSymbolClick }) {
  const { symbol, '1d': d1, '1w': d1w } = entry

  function HorizonCell({ row }) {
    if (!row) return <td className="px-3 py-2 text-sm text-slate-600">—</td>
    const dirColor = row.direction === 'UP' ? 'text-emerald-400' : row.direction === 'DOWN' ? 'text-red-400' : 'text-slate-400'
    const isHigh = row.confidence_pct >= 58
    return (
      <td className="px-3 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          <DirIcon direction={row.direction} size={12} />
          <span className={`text-sm font-bold ${dirColor}`}>{row.direction}</span>
          <span className={`text-sm tabular-nums font-medium ${isHigh ? 'text-amber-300' : 'text-slate-400'}`}>
            {row.confidence_pct.toFixed(1)}%
          </span>
          {isHigh && (
            <Tooltip text={TIPS.highConfStar}>
              <span className="text-xs text-amber-400 font-bold cursor-help">★</span>
            </Tooltip>
          )}
          <span className="text-slate-600">·</span>
          <OutcomeDot outcome={row.outcome} movePct={row.actual_move_pct} />
        </div>
      </td>
    )
  }

  return (
    <tr
      className="border-b border-dark-600/20 hover:bg-dark-700/30 cursor-pointer transition-colors"
      onClick={() => onSymbolClick(symbol, entry.asset_type)}
    >
      <td className="pl-4 pr-2 py-2.5 text-sm font-semibold text-slate-200 hover:text-brand-400 transition-colors">{symbol}</td>
      <HorizonCell row={d1} />
      <HorizonCell row={d1w} />
    </tr>
  )
}

// ── Symbol accuracy table ─────────────────────────────────────────────────────

// Best Overall = accuracy × log(calls) — rewards both reliability and sample size
const bestScore = r => (r.accuracy_pct ?? 0) * Math.log1p(r.total)

const SORT_OPTIONS = [
  { key: 'best',      fn: (a, b) => bestScore(b) - bestScore(a) },
  { key: 'accuracy',  fn: (a, b) => (b.accuracy_pct ?? 0)    - (a.accuracy_pct ?? 0) },
  { key: 'hc',        fn: (a, b) => (b.hc_accuracy_pct ?? 0) - (a.hc_accuracy_pct ?? 0) },
  { key: 'correct',   fn: (a, b) => b.correct - a.correct },
  { key: 'wrong',     fn: (a, b) => b.wrong   - a.wrong },
  { key: 'calls',     fn: (a, b) => b.total   - a.total },
  { key: 'symbol',    fn: (a, b) => a.sym.localeCompare(b.sym) },
]

function SymbolAccuracyTable({ bySymbol }) {
  const [open,     setOpen]     = useState(false)
  const [filter,   setFilter]   = useState('all')
  const [minCalls, setMinCalls] = useState(10)
  const [sortKey,  setSortKey]  = useState('best')

  const sortFn = SORT_OPTIONS.find(o => o.key === sortKey)?.fn ?? SORT_OPTIONS[0].fn

  const allRows = Object.entries(bySymbol)
    .filter(([, s]) => s.total >= minCalls && s.accuracy_pct != null)
    .map(([sym, s]) => ({
      sym, ...s,
      tier: s.accuracy_pct >= 65 ? 'strong' : s.accuracy_pct >= 52 ? 'marginal' : 'weak',
    }))
    .sort(sortFn)

  const strong   = allRows.filter(r => r.tier === 'strong')
  const marginal = allRows.filter(r => r.tier === 'marginal')
  const weak     = allRows.filter(r => r.tier === 'weak')
  const displayed = filter === 'strong' ? strong : filter === 'marginal' ? marginal : filter === 'weak' ? weak : allRows

  if (Object.keys(bySymbol).length === 0) return null

  const TIER_CONFIG = {
    strong:   { label: 'Reliable',  desc: '≥65% accurate — trust these signals',          color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30', dot: 'bg-emerald-400' },
    marginal: { label: 'Marginal',  desc: '52–65% — use only ★ high-confidence calls',    color: 'text-amber-400',   bg: 'bg-amber-500/15   border-amber-500/30',   dot: 'bg-amber-400'   },
    weak:     { label: 'No Edge',   desc: '<52% — model has no edge, ignore its signals',  color: 'text-red-400',     bg: 'bg-red-500/15     border-red-500/30',     dot: 'bg-red-400'     },
  }

  return (
    <div className="border-t border-dark-600/40 pt-4 space-y-3">

      {/* Toggle header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between group"
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-slate-400 group-hover:text-slate-200 uppercase tracking-wider transition-colors">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Signal Reliability by Symbol
        </span>
        <span className="text-xs text-slate-600">{allRows.length} symbols · min {minCalls} predictions</span>
      </button>

      {open && (
        <div className="space-y-4">

          {/* Tier summary pills */}
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(TIER_CONFIG).map(([key, cfg]) => {
              const count = key === 'strong' ? strong.length : key === 'marginal' ? marginal.length : weak.length
              const active = filter === key
              return (
                <button
                  key={key}
                  onClick={() => setFilter(f => f === key ? 'all' : key)}
                  className={`rounded-xl border p-3 text-left transition-all hover:scale-[1.03] hover:shadow-lg hover:shadow-black/40 ${active ? cfg.bg : 'bg-dark-700/40 border-dark-600/50 hover:border-dark-500 hover:bg-dark-600/60'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                    <span className={`text-xs font-bold ${active ? cfg.color : 'text-slate-300'}`}>{cfg.label}</span>
                  </div>
                  <p className={`text-2xl font-black tabular-nums ${active ? cfg.color : 'text-slate-100'}`}>{count}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{cfg.desc}</p>
                </button>
              )
            })}
          </div>

          {/* Min-calls toggle */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Min predictions:</span>
            {[5, 10, 20].map(n => (
              <button
                key={n}
                onClick={() => setMinCalls(n)}
                className={`px-2.5 py-0.5 rounded-full text-xs border transition-colors ${
                  minCalls === n
                    ? 'bg-brand-500/20 border-brand-500/40 text-brand-300 font-semibold'
                    : 'border-dark-600 text-slate-500 hover:border-dark-500'
                }`}
              >
                {n}+
              </button>
            ))}
          </div>

          {/* Rows */}
          {displayed.length === 0 ? (
            <p className="text-xs text-slate-600 italic py-2">No symbols match this filter.</p>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
              {/* Clickable column headers */}
              <div className="flex items-center gap-3 pb-1.5 border-b border-dark-600/40">
                <span className="w-5 text-[10px] text-slate-600">#</span>
                {[
                  { key: 'symbol',   label: 'Symbol',         cls: 'w-16 text-left' },
                  { key: 'accuracy', label: 'Accuracy Bar',   cls: 'flex-1 text-left' },
                  { key: 'accuracy', label: 'Overall %',      cls: 'w-12 text-right' },
                  { key: 'hc',       label: '★ Conf %',       cls: 'w-14 text-right' },
                  { key: 'correct',  label: '✓ Right',        cls: 'w-12 text-right' },
                  { key: 'wrong',    label: '✗ Wrong',        cls: 'w-12 text-right' },
                  { key: 'calls',    label: 'Calls',          cls: 'w-10 text-right' },
                  { key: 'best',     label: '🏆 Best',        cls: 'w-14 text-right' },
                ].map(col => (
                  <button
                    key={col.key + col.label}
                    onClick={() => setSortKey(col.key)}
                    className={`${col.cls} text-[10px] uppercase tracking-wide transition-colors flex items-center gap-0.5 ${
                      sortKey === col.key ? 'text-brand-400 font-bold' : 'text-slate-600 hover:text-slate-300'
                    } ${col.cls.includes('right') ? 'justify-end' : ''}`}
                  >
                    {col.label}
                    {sortKey === col.key && <span className="text-brand-400">↓</span>}
                  </button>
                ))}
              </div>
              {displayed.map((row, i) => {
                const pct      = row.accuracy_pct ?? 0
                const cfg      = TIER_CONFIG[row.tier]
                const barColor = row.tier === 'strong' ? 'bg-emerald-500' : row.tier === 'marginal' ? 'bg-amber-500' : 'bg-red-500'
                return (
                  <div key={row.sym} className="flex items-center gap-3 py-1.5 rounded-lg px-1 transition-all cursor-default hover:bg-dark-600/60 hover:scale-[1.01] hover:shadow-md hover:shadow-black/30">
                    <span className="w-5 text-xs text-slate-600 tabular-nums text-right">{i + 1}</span>
                    <span className="w-16 text-sm font-bold text-slate-100 font-mono truncate">{row.sym}</span>
                    <div className="flex-1 h-2 bg-dark-600 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${barColor} transition-all duration-500`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <span className={`w-12 text-right text-sm font-black tabular-nums ${cfg.color}`}>{pct}%</span>
                    <span className="w-14 text-right text-xs tabular-nums text-amber-400 font-semibold">
                      {row.hc_accuracy_pct != null ? `${row.hc_accuracy_pct}%` : '—'}
                    </span>
                    <span className="w-12 text-right text-xs tabular-nums text-emerald-400 font-semibold">{row.correct}</span>
                    <span className="w-12 text-right text-xs tabular-nums text-red-400 font-semibold">{row.wrong}</span>
                    <span className="w-10 text-right text-xs tabular-nums text-slate-500">{row.total}</span>
                    <span className={`w-14 text-right text-xs tabular-nums font-semibold ${sortKey === 'best' ? 'text-brand-400' : 'text-slate-600'}`}>
                      {bestScore(row).toFixed(1)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

        </div>
      )}
    </div>
  )
}

// ── Accuracy bar ──────────────────────────────────────────────────────────────

function AccuracyBar({ label, accuracy, total, icon }) {
  const pct = accuracy ?? 0
  const barColor = pct >= 60 ? 'bg-emerald-500' : pct >= 52 ? 'bg-yellow-500' : 'bg-red-500'
  const textColor = pct >= 60 ? 'text-emerald-400' : pct >= 52 ? 'text-yellow-400' : 'text-red-400'
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400 flex items-center gap-1">
          {icon}
          {label}
        </span>
        <div className="flex items-center gap-2">
          <span className={`font-bold tabular-nums ${textColor}`}>
            {accuracy != null ? `${accuracy}%` : '—'}
          </span>
          <span className="text-slate-600">{total ?? 0} calls</span>
        </div>
      </div>
      <div className="h-2 bg-dark-600 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-500`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  )
}

// ── Compact single-symbol row (used when embedded in the Market tab) ─────────

function CompactRow({ date, label, row }) {
  if (!row) return null
  const dirColor = row.direction === 'UP' ? 'text-emerald-400' : row.direction === 'DOWN' ? 'text-red-400' : 'text-slate-400'
  const isHigh   = row.confidence_pct >= 58
  const horizonTip = label === '1W' ? TIPS.horizon1w : TIPS.horizon1d
  return (
    <div className="flex items-center gap-3 py-2 border-b border-dark-600/30 last:border-0">
      <span className="text-xs text-slate-500 w-14 shrink-0">{fmtDate(date)}</span>
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <Tooltip text={horizonTip}>
          <span className="text-[10px] font-semibold text-slate-600 uppercase cursor-help underline decoration-dotted w-6 shrink-0">
            {label}
          </span>
        </Tooltip>
        <DirIcon direction={row.direction} size={11} />
        <span className={`text-xs font-bold ${dirColor}`}>{row.direction}</span>
        <span className="text-xs tabular-nums text-slate-400">{row.confidence_pct.toFixed(1)}%</span>
        {isHigh && (
          <Tooltip text={TIPS.highConfStar}>
            <span className="text-xs text-amber-400 font-bold cursor-help">★</span>
          </Tooltip>
        )}
      </div>
      <OutcomeDot outcome={row.outcome} movePct={row.actual_move_pct} />
    </div>
  )
}

// ── Accuracy card ─────────────────────────────────────────────────────────────

function AccuracyCard({ symbols }) {
  const { data, isPending } = usePredictionAccuracy(symbols, null)

  if (isPending) return (
    <div className="card flex items-center gap-2 py-4">
      <Loader2 size={14} className="animate-spin text-brand-400" />
      <span className="text-sm text-slate-500">Loading stats…</span>
    </div>
  )
  if (!data || data.total === 0) return null

  const {
    total, correct, wrong, push, accuracy_pct,
    hc_accuracy_pct, hc_total, hc_correct,
    by_horizon = {}, by_direction = {}, by_symbol = {},
  } = data

  const d1   = by_horizon['1d']    ?? {}
  const d1w  = by_horizon['1w']    ?? {}
  const dUp  = by_direction['UP']  ?? {}
  const dDwn = by_direction['DOWN'] ?? {}

  const hcColor = hc_accuracy_pct == null ? 'text-slate-500'
    : hc_accuracy_pct >= 62 ? 'text-emerald-400'
    : hc_accuracy_pct >= 55 ? 'text-yellow-400'
    : 'text-red-400'

  const allColor = accuracy_pct == null ? 'text-slate-500'
    : accuracy_pct >= 57 ? 'text-emerald-400'
    : accuracy_pct >= 50 ? 'text-yellow-400'
    : 'text-red-400'

  return (
    <div className="card p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 size={16} className="text-brand-400" />
          <h3 className="text-sm font-semibold text-slate-100">Prediction Accuracy</h3>
        </div>
        <span className="text-xs text-slate-600 bg-dark-700 border border-dark-600 rounded px-2 py-0.5">
          {total} predictions · {correct + wrong} decisive
        </span>
      </div>

      {/* Hero row: actionable accuracy + overall */}
      <div className="grid grid-cols-2 gap-4 border-b border-dark-600/40 pb-5">
        <div className="text-center space-y-1">
          <Tooltip text={TIPS.highConf} wide>
            <p className={`text-4xl font-black tabular-nums ${hcColor} cursor-help`}>
              {hc_accuracy_pct != null ? `${hc_accuracy_pct}%` : '—'}
            </p>
          </Tooltip>
          <p className="text-xs font-semibold text-amber-400">★ Actionable Accuracy</p>
          <p className="text-xs text-slate-500">≥58% confidence · {hc_correct}/{hc_total} correct</p>
        </div>
        <div className="text-center space-y-1 border-l border-dark-600/40 pl-4">
          <Tooltip text={TIPS.accuracy} wide>
            <p className={`text-4xl font-black tabular-nums ${allColor} cursor-help`}>
              {accuracy_pct != null ? `${accuracy_pct}%` : '—'}
            </p>
          </Tooltip>
          <p className="text-xs font-semibold text-slate-400">Overall Accuracy</p>
          <p className="text-xs text-slate-500">{correct}✓ · {wrong}✗ · {push} push</p>
        </div>
      </div>

      {/* By Horizon */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">By Horizon</p>
        <div className="grid grid-cols-2 gap-4">
          <AccuracyBar
            label="1-Week ⭐"
            accuracy={d1w.accuracy_pct}
            total={d1w.total}
            icon={<BarChart2 size={10} className="text-brand-400" />}
          />
          <AccuracyBar
            label="1-Day"
            accuracy={d1.accuracy_pct}
            total={d1.total}
            icon={<Clock size={10} />}
          />
        </div>
        <p className="text-xs text-slate-600">⭐ 1-Week is more reliable — 1-Day has higher daily noise. Use 1W for trade decisions.</p>
      </div>

      {/* By Direction */}
      {(dUp.total > 0 || dDwn.total > 0) && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">By Direction</p>
          <div className="grid grid-cols-2 gap-4">
            <AccuracyBar
              label="BUY (UP)"
              accuracy={dUp.accuracy_pct}
              total={dUp.total}
              icon={<TrendingUp size={10} className="text-emerald-400" />}
            />
            <AccuracyBar
              label="SELL (DOWN)"
              accuracy={dDwn.accuracy_pct}
              total={dDwn.total}
              icon={<TrendingDown size={10} className="text-red-400" />}
            />
          </div>
        </div>
      )}

      {/* Per-symbol breakdown */}
      <SymbolAccuracyTable bySymbol={by_symbol} />

      {/* Confidence floor note */}
      <p className="text-xs text-slate-600 pt-1">
        ℹ New predictions: only ≥58% confidence is logged going forward. Historical data includes pre-floor predictions which lower the overall %.
      </p>
    </div>
  )
}

// ── Collapsible section wrapper for Today / Tomorrow ─────────────────────────

function CollapsibleCallsSection({ title, subtitle, accentClass, defaultOpen, headerRight, tip, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-dark-600/40 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-dark-700/60 hover:bg-dark-700 transition-colors"
      >
        {open ? <ChevronDown size={13} className="text-slate-500 shrink-0" /> : <ChevronRight size={13} className="text-slate-500 shrink-0" />}
        <BarChart2 size={13} className={`${accentClass} shrink-0`} />
        {tip ? (
          <Tooltip text={tip} wide>
            <span className="text-sm font-semibold text-slate-100 cursor-help underline decoration-dotted">{title}</span>
          </Tooltip>
        ) : (
          <span className="text-sm font-semibold text-slate-100">{title}</span>
        )}
        {subtitle && <span className="text-xs text-slate-500">{subtitle}</span>}
        <div className="ml-auto" onClick={e => e.stopPropagation()}>{headerRight}</div>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

// `compact`: renders a trimmed single-symbol view for embedding in the Market
// tab's right panel — accuracy card + a plain call/track-record list, no VIX
// banner and no populate/refresh-outcomes admin controls (those stay on the
// Recommendations page; data still auto-populates/auto-resolves in the
// background via the effects below either way). Expects `symbols` to be a
// single-symbol array, e.g. symbols={[selectedSymbol]}.
export default function PredictionHistoryTab({ symbols, compact = false }) {
  const navigate    = useNavigate()
  const setSymbol   = useMarketStore(s => s.setSymbol)
  const qc = useQueryClient()
  const populate        = useTriggerPopulate()
  const nextDayPopulate = useTriggerNextDayPopulate()
  const resolve         = useTriggerResolve()
  const [isPopulating,        setIsPopulating]        = useState(false)
  const [isNextDayPopulating, setIsNextDayPopulating] = useState(false)
  const [isResolving,         setIsResolving]         = useState(false)

  const handleSymbolClick = (symbol, assetType) => {
    setSymbol(symbol, assetType)
    navigate('/market')
  }

  const handleRefreshOutcomes = () => {
    setIsResolving(true)
    resolve.mutate(undefined, {
      onSettled: () => {
        qc.refetchQueries({ queryKey: ['prediction-history'] })
        qc.refetchQueries({ queryKey: ['prediction-history-all'] })
        qc.refetchQueries({ queryKey: ['prediction-accuracy'] })
        setIsResolving(false)
      },
    })
  }

  const handleNextDayPopulate = () => {
    setIsNextDayPopulating(true)
    nextDayPopulate.mutate(symbols ?? null)
    // spinner stays until popStatus.running flips to false (polled every 3s)
  }

  const alreadyTriggered = useRef(false)
  const alreadyResolved  = useRef(false)
  const { data: popStatus } = usePopulateStatus(isPopulating || isNextDayPopulating)

  const perSymbol  = usePredictionHistory(symbols, null)
  const allSymbols = useAllPredictionHistory(null)
  const { data: rows = [], isPending } = symbols ? perSymbol : allSymbols

  // ── Auto-populate on mount ────────────────────────────────────────────────
  useEffect(() => {
    if (isPending || alreadyTriggered.current) return

    let symsToPop = null   // null = full default universe

    if (symbols) {
      // Interests page: only populate symbols missing today's entry
      const alreadyLogged = new Set(
        rows.filter(r => r.logged_date === TODAY).map(r => r.symbol.toUpperCase())
      )
      const missing = symbols.filter(s => !alreadyLogged.has(s.toUpperCase()))
      if (missing.length === 0) return   // all symbols already have today's data
      symsToPop = missing
    } else {
      // Recommendations page: only if nothing logged at all
      if (rows.length > 0) return
    }

    alreadyTriggered.current = true
    populate.mutate(symsToPop)
    setIsPopulating(true)
  }, [isPending, rows.length])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (popStatus === undefined || popStatus.running) return
    if (isPopulating) {
      setIsPopulating(false)
      resolve.mutate(undefined, {
        onSettled: () => {
          qc.refetchQueries({ queryKey: ['prediction-history'] })
          qc.refetchQueries({ queryKey: ['prediction-history-all'] })
          qc.refetchQueries({ queryKey: ['prediction-accuracy'] })
        },
      })
    }
    if (isNextDayPopulating) {
      setIsNextDayPopulating(false)
      qc.refetchQueries({ queryKey: ['prediction-history'] })
      qc.refetchQueries({ queryKey: ['prediction-history-all'] })
    }
  }, [isPopulating, isNextDayPopulating, popStatus?.running, qc])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-resolve due predictions ──────────────────────────────────────────
  useEffect(() => {
    if (!isPending && rows.length > 0 && !alreadyResolved.current) {
      const hasUnresolved = rows.some(r => !r.resolved)
      if (hasUnresolved) {
        alreadyResolved.current = true
        resolve.mutate(undefined, {
          onSettled: () => {
            qc.refetchQueries({ queryKey: ['prediction-history'] })
            qc.refetchQueries({ queryKey: ['prediction-history-all'] })
            qc.refetchQueries({ queryKey: ['prediction-accuracy'] })
          },
        })
      }
    }
  }, [isPending, rows.length])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading state — only block on initial fetch, not background populate ────
  if (isPending) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="card text-center py-12 space-y-2">
        <Clock size={28} className="mx-auto text-slate-600" />
        <p className="text-slate-400 text-sm font-medium">No prediction history yet</p>
        <p className="text-xs text-slate-600 max-w-sm mx-auto">
          The nightly conviction scan at 06:00 logs 1D and 1W predictions for all symbols.
        </p>
      </div>
    )
  }

  const groups = groupByDateAndSymbol(rows)
  const tomorrowGroup = groups.find(g => g.date === TOMORROW)
  const todayGroup    = groups.find(g => g.date === TODAY)
  const historyGroups = groups.filter(g => g.date !== TODAY && g.date !== TOMORROW)

  if (compact) {
    const tomorrowEntry = tomorrowGroup?.symbolEntries[0]
    const todayEntry    = todayGroup?.symbolEntries[0]
    return (
      <div className="space-y-3">
        <AccuracyCard symbols={symbols} />

        {(tomorrowEntry || todayEntry) && (
          <div className="card space-y-0 p-4">
            <Tooltip text={TIPS.todayCalls} wide>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 cursor-help underline decoration-dotted inline-block">
                Today's / Upcoming Calls
              </p>
            </Tooltip>
            {tomorrowEntry && (
              <>
                <CompactRow date={TOMORROW} label="1W" row={tomorrowEntry['1w']} />
                <CompactRow date={TOMORROW} label="1D" row={tomorrowEntry['1d']} />
              </>
            )}
            {todayEntry && (
              <>
                <CompactRow date={TODAY} label="1W" row={todayEntry['1w']} />
                <CompactRow date={TODAY} label="1D" row={todayEntry['1d']} />
              </>
            )}
          </div>
        )}

        {historyGroups.length > 0 && (
          <div className="card space-y-0 p-4 max-h-80 overflow-y-auto">
            <Tooltip text={TIPS.trackRecord} wide>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 cursor-help underline decoration-dotted inline-block sticky -top-4 bg-dark-800 pt-4 pb-1 -mx-4 px-4">
                Track Record
              </p>
            </Tooltip>
            {historyGroups.map(g => {
              const entry = g.symbolEntries[0]
              return entry ? (
                <div key={g.date}>
                  <CompactRow date={g.date} label="1W" row={entry['1w']} />
                  <CompactRow date={g.date} label="1D" row={entry['1d']} />
                </div>
              ) : null
            })}
          </div>
        )}

        <p className="text-xs text-slate-600">
          Full multi-symbol track record and manual refresh controls are on the Recommendations tab.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── VIX regime warning ── */}
      <VixRegimeBanner />

      {/* ── Background populate banner ── */}
      {isPopulating && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-dark-700/60 border border-dark-600/40 text-slate-400 text-sm">
          <Loader2 size={13} className="animate-spin shrink-0" />
          <span>Fetching latest predictions — results will appear shortly…</span>
        </div>
      )}

      {/* ── Section 1: Accuracy ── */}
      <AccuracyCard symbols={symbols} />

      {/* ── Tomorrow's Calls ── */}
      <CollapsibleCallsSection
        title={`${IS_LITERAL_TOMORROW ? "Tomorrow's" : new Date(TOMORROW + 'T00:00:00').toLocaleDateString([], { weekday: 'long' }) + "'s"} Calls — ${shortDate(TOMORROW)}`}
        subtitle={tomorrowGroup ? `${tomorrowGroup.symbolEntries.length} symbols · based on today's close` : null}
        accentClass="text-indigo-400"
        defaultOpen={true}
        headerRight={
          !tomorrowGroup ? (
            <button
              onClick={handleNextDayPopulate}
              disabled={isNextDayPopulating}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={11} className={isNextDayPopulating ? 'animate-spin' : ''} />
              {isNextDayPopulating ? 'Generating…' : 'Generate now'}
            </button>
          ) : (
            <span className="text-xs text-slate-600">1D resolves tomorrow · 1W in 5 days</span>
          )
        }
      >
        {tomorrowGroup ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 pt-3">
            {tomorrowGroup.symbolEntries.map(entry => (
              <TodayCard key={entry.symbol} entry={entry} onSymbolClick={handleSymbolClick} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-600 pt-2">
            Auto-generated at 4:35 PM ET after market close.
          </p>
        )}
      </CollapsibleCallsSection>

      {/* ── Today's Calls ── */}
      {todayGroup && (
        <CollapsibleCallsSection
          title={`Today's Calls — ${shortDate(TODAY)}`}
          subtitle={`${todayGroup.symbolEntries.length} symbols`}
          accentClass="text-brand-400"
          defaultOpen={!tomorrowGroup}
          headerRight={
            <Tooltip text={TIPS.highConfStar} wide>
              <span className="text-xs text-amber-400 cursor-help">★ = high confidence (≥58%)</span>
            </Tooltip>
          }
          tip={TIPS.todayCalls}
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 pt-3">
            {todayGroup.symbolEntries.map(entry => (
              <TodayCard key={entry.symbol} entry={entry} onSymbolClick={handleSymbolClick} />
            ))}
          </div>
        </CollapsibleCallsSection>
      )}

      {/* ── Section 3: Track Record ── */}
      {historyGroups.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Tooltip text={TIPS.trackRecord} wide>
              <h3 className="text-sm font-semibold text-slate-100 cursor-help underline decoration-dotted">Track Record</h3>
            </Tooltip>
            <span className="text-xs text-slate-500">past predictions</span>
            <button
              onClick={handleRefreshOutcomes}
              disabled={isResolving}
              className="ml-auto flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={11} className={isResolving ? 'animate-spin' : ''} />
              {isResolving ? 'Checking…' : 'Refresh outcomes'}
            </button>
          </div>
          <div className="space-y-2">
            {historyGroups.map((group, i) => (
              <DateGroup key={group.date} group={group} defaultOpen={i === 0} onSymbolClick={handleSymbolClick} />
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
