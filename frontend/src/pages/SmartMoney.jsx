import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Zap, TrendingUp, TrendingDown, BarChart2, RefreshCw,
  ChevronRight, Activity, Shield, Target, HelpCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useSmartMoney } from '../api/smartMoney'
import { useOpenTrade } from '../api/trades'
import { useMarketStore } from '../store/marketStore'

// ── Tooltip ───────────────────────────────────────────────────────────────────
// Uses fixed positioning so it escapes overflow-x-auto table containers.

function Tooltip({ text, children, wide = false }) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const width = wide ? 240 : 192

  return (
    <span
      className="inline-flex items-center"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onMouseMove={e => setPos({ x: e.clientX, y: e.clientY })}
    >
      {children}
      {visible && (
        <span
          className="fixed z-[9999] pointer-events-none bg-dark-900 border border-dark-600 text-slate-300 text-xs rounded-lg px-2.5 py-2 leading-snug shadow-xl whitespace-normal"
          style={{ width, left: pos.x - width / 2, top: pos.y - 12, transform: 'translateY(-100%)' }}
        >
          {text}
        </span>
      )}
    </span>
  )
}

function ColHeader({ label, tip, wide }) {
  return (
    <Tooltip text={tip} wide={wide}>
      <span className="inline-flex items-center gap-1 cursor-default">
        {label}
        <HelpCircle size={11} className="text-slate-600" />
      </span>
    </Tooltip>
  )
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SIGNAL_META = {
  STRONG_BUY:  { label: 'Strong Buy',  color: 'text-emerald-300', bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', dot: 'bg-emerald-400' },
  BUY:         { label: 'Buy',         color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-500' },
  NEUTRAL:     { label: 'Neutral',     color: 'text-slate-400',   bg: 'bg-slate-500/10',   border: 'border-slate-500/20',   dot: 'bg-slate-500'   },
  SELL:        { label: 'Sell',        color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30',     dot: 'bg-red-500'     },
  STRONG_SELL: { label: 'Strong Sell', color: 'text-red-300',     bg: 'bg-red-500/20',     border: 'border-red-500/40',     dot: 'bg-red-400'     },
}

const BIAS_META = {
  BULLISH:       { label: 'Bullish',       color: 'text-emerald-400' },
  BEARISH:       { label: 'Bearish',       color: 'text-red-400'     },
  NEUTRAL:       { label: 'Neutral',       color: 'text-slate-400'   },
  'N/A':         { label: 'N/A',           color: 'text-slate-600'   },
  ACCUMULATION:  { label: 'Accumulation',  color: 'text-emerald-400' },
  DISTRIBUTION:  { label: 'Distribution',  color: 'text-red-400'     },
}

const FILTERS = ['All', 'Strong Buy', 'Buy', 'Neutral', 'Sell', 'Strong Sell']
const FILTER_SIGNAL = {
  'All': null,
  'Strong Buy': 'STRONG_BUY',
  'Buy': 'BUY',
  'Neutral': 'NEUTRAL',
  'Sell': 'SELL',
  'Strong Sell': 'STRONG_SELL',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n, d = 2) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function fmtPrice(n) {
  if (n == null) return '—'
  return n < 1 ? `$${n.toFixed(6)}` : `$${fmt(n)}`
}

function fmtVol(n) {
  if (n == null || n === 0) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

// ── Signal Badge ──────────────────────────────────────────────────────────────

function SignalBadge({ signal }) {
  const m = SIGNAL_META[signal] || SIGNAL_META.NEUTRAL
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${m.bg} ${m.border} ${m.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  )
}

// ── Score Bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ score }) {
  // score: -4 to +4, map to 0–100%
  const pct = ((score + 4) / 8) * 100
  const color = score > 0 ? 'bg-emerald-500' : score < 0 ? 'bg-red-500' : 'bg-slate-500'
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-dark-600 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <Tooltip text="Signal score −4 to +4. Each condition adds ±1: P/C ratio, IV skew, max pain distance, volume surge × VWAP position." wide>
        <span className={`text-xs tabular-nums cursor-default ${score > 0 ? 'text-emerald-400' : score < 0 ? 'text-red-400' : 'text-slate-500'}`}>
          {score > 0 ? '+' : ''}{score}
        </span>
      </Tooltip>
    </div>
  )
}

// ── Open Trade Modal ──────────────────────────────────────────────────────────

function OpenTradeModal({ item, onClose, onConfirm, opening }) {
  const isBuy = item.signal.includes('BUY')
  const direction = isBuy ? 'BUY' : 'SELL'
  const [qty, setQty] = useState(1)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-dark-800 border border-dark-600 rounded-2xl w-full max-w-sm mx-4 p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-100">Open Trade — {item.symbol}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg">✕</button>
        </div>

        <div className="flex gap-2 flex-wrap">
          <SignalBadge signal={item.signal} />
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${isBuy ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
            {direction}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="bg-dark-700 rounded-lg p-2">
            <p className="text-slate-500">Options Bias</p>
            <p className={`font-medium mt-0.5 ${BIAS_META[item.options_bias]?.color || 'text-slate-400'}`}>{item.options_bias}</p>
          </div>
          <div className="bg-dark-700 rounded-lg p-2">
            <p className="text-slate-500">Volume Surge</p>
            <p className="font-medium text-slate-200 mt-0.5">{fmt(item.volume_surge_ratio)}×</p>
          </div>
          <div className="bg-dark-700 rounded-lg p-2">
            <p className="text-slate-500">VWAP</p>
            <p className={`font-medium mt-0.5 ${item.above_vwap ? 'text-emerald-400' : 'text-red-400'}`}>
              {item.above_vwap ? 'Above' : 'Below'} {fmtPrice(item.vwap)}
            </p>
          </div>
          <div className="bg-dark-700 rounded-lg p-2">
            <p className="text-slate-500">Current Price</p>
            <p className="font-medium text-slate-200 mt-0.5">{fmtPrice(item.price)}</p>
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-500 block mb-1">Quantity</label>
          <input
            type="number" value={qty} min="1" step="1"
            onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-brand-500"
          />
        </div>

        <button
          onClick={() => onConfirm({ direction, qty })}
          disabled={opening}
          className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 ${
            isBuy ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-red-600 hover:bg-red-500 text-white'
          }`}
        >
          {opening ? 'Opening…' : `Open ${direction} ${item.symbol}`}
        </button>
      </div>
    </div>
  )
}

// ── Summary Stats ─────────────────────────────────────────────────────────────

function StatCard({ label, value, color, icon: Icon, tip }) {
  return (
    <div className="bg-dark-800 border border-dark-700 rounded-xl px-4 py-3 flex items-center gap-3">
      <div className={`p-2 rounded-lg bg-dark-700 ${color}`}>
        <Icon size={16} />
      </div>
      <div>
        <p className={`text-lg font-bold ${color}`}>{value}</p>
        {tip ? (
          <Tooltip text={tip} wide>
            <p className="text-xs text-slate-500 cursor-default">{label}</p>
          </Tooltip>
        ) : (
          <p className="text-xs text-slate-500">{label}</p>
        )}
      </div>
    </div>
  )
}

// ── Table Row ─────────────────────────────────────────────────────────────────

function SmartMoneyRow({ item, onOpenTrade, onNavigate }) {
  const isBullish = item.signal === 'STRONG_BUY' || item.signal === 'BUY'
  return (
    <tr className="border-b border-dark-700/60 hover:bg-dark-700/30 transition-colors">
      {/* Symbol */}
      <td className="py-3 pl-4 pr-3">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-8 rounded-full ${isBullish ? 'bg-emerald-500' : item.signal === 'NEUTRAL' ? 'bg-slate-600' : 'bg-red-500'}`} />
          <div>
            <p className="font-semibold text-slate-100 text-sm">{item.symbol}</p>
            <p className="text-xs text-slate-500">{fmtPrice(item.price)}</p>
          </div>
        </div>
      </td>

      {/* Signal */}
      <td className="py-3 px-3">
        <div className="space-y-1">
          <SignalBadge signal={item.signal} />
          <ScoreBar score={item.signal_score} />
        </div>
      </td>

      {/* Options */}
      <td className="py-3 px-3">
        {item.options_bias === 'N/A' ? (
          <Tooltip text="No listed options for this symbol (crypto or thinly traded). Signal is based on volume only.">
            <span className="text-xs text-slate-600 cursor-default">No options</span>
          </Tooltip>
        ) : (
          <div className="space-y-0.5">
            <p className={`text-xs font-medium ${BIAS_META[item.options_bias]?.color}`}>{item.options_bias}</p>
            <Tooltip text="Put/Call volume ratio. <0.7 = more calls bought (bullish sweep). >1.5 = more puts bought (bearish hedge). ~1.0 = balanced." wide>
              <p className="text-xs text-slate-500 cursor-default">P/C {fmt(item.put_call_vol_ratio)} vol</p>
            </Tooltip>
            <Tooltip text="At-The-Money Implied Volatility (annualised). >30% = elevated uncertainty. >50% = high fear or event-driven." wide>
              <p className="text-xs text-slate-500 cursor-default">IV {fmt(item.atm_iv_pct)}%</p>
            </Tooltip>
          </div>
        )}
      </td>

      {/* Volume */}
      <td className="py-3 px-3">
        <div className="space-y-0.5">
          <Tooltip text="Today's volume ÷ 20-day average. ≥2× = significant institutional activity in progress." wide>
            <p className={`text-xs font-semibold cursor-default ${item.volume_surge_ratio >= 2 ? (isBullish ? 'text-emerald-400' : 'text-red-400') : 'text-slate-300'}`}>
              {fmt(item.volume_surge_ratio)}× avg
            </p>
          </Tooltip>
          <p className="text-xs text-slate-500">{fmtVol(item.volume_today)} today</p>
          <Tooltip text="Accumulation = volume surge with price above VWAP (institutions buying). Distribution = surge below VWAP (selling pressure)." wide>
            <p className={`text-xs font-medium cursor-default ${BIAS_META[item.volume_bias]?.color}`}>{item.volume_bias}</p>
          </Tooltip>
        </div>
      </td>

      {/* VWAP */}
      <td className="py-3 px-3">
        <div className="space-y-0.5">
          <Tooltip text="Volume-Weighted Average Price for today. Institutions use VWAP as an execution benchmark. Price above VWAP = buyers in control." wide>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full cursor-default ${item.above_vwap ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
              {item.above_vwap ? '↑ Above' : '↓ Below'}
            </span>
          </Tooltip>
          <p className="text-xs text-slate-500 mt-1">{fmtPrice(item.vwap)}</p>
        </div>
      </td>

      {/* Max Pain */}
      <td className="py-3 px-3">
        {item.max_pain_strike ? (
          <Tooltip text="Max pain = strike where most options expire worthless. Price gravitates here as expiry approaches. Positive % = max pain above current price (bullish pull)." wide>
            <div className="space-y-0.5 cursor-default">
              <p className="text-xs text-slate-300">{fmtPrice(item.max_pain_strike)}</p>
              <p className={`text-xs ${item.max_pain_distance_pct > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {item.max_pain_distance_pct > 0 ? '+' : ''}{fmt(item.max_pain_distance_pct)}%
              </p>
            </div>
          </Tooltip>
        ) : (
          <span className="text-xs text-slate-600">—</span>
        )}
      </td>

      {/* Actions */}
      <td className="py-3 pl-3 pr-4">
        <div className="flex gap-1.5">
          {item.signal !== 'NEUTRAL' && (
            <button
              onClick={() => onOpenTrade(item)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                isBullish
                  ? 'bg-emerald-600/80 hover:bg-emerald-600 text-white'
                  : 'bg-red-600/80 hover:bg-red-600 text-white'
              }`}
            >
              {isBullish ? 'Buy' : 'Sell'}
            </button>
          )}
          <button
            onClick={() => onNavigate(item.symbol, item.asset_type)}
            className="p-1.5 rounded-lg bg-dark-700 hover:bg-dark-600 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ filter }) {
  return (
    <div className="text-center py-16">
      <Activity size={36} className="mx-auto text-slate-600 mb-3" />
      <p className="text-slate-300 font-medium">
        {filter === 'All' ? 'No results yet' : `No ${filter} signals found`}
      </p>
      <p className="text-slate-500 text-sm mt-1">
        {filter === 'All'
          ? 'Click Refresh to run the scan'
          : 'Try a different filter or wait for the next auto-refresh'}
      </p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SmartMoney() {
  const [filter, setFilter]         = useState('All')
  const [includeCrypto, setCrypto]  = useState(false)
  const [modal, setModal]           = useState(null)
  const [openingSymbol, setOpening] = useState(null)

  const setSymbol  = useMarketStore(s => s.setSymbol)
  const navigate   = useNavigate()
  const openTrade  = useOpenTrade()

  const { data: results = [], isLoading, isFetching, refetch, dataUpdatedAt } = useSmartMoney('', includeCrypto)

  const filtered = filter === 'All'
    ? results
    : results.filter(r => r.signal === FILTER_SIGNAL[filter])

  const bullishCount  = results.filter(r => r.signal === 'STRONG_BUY' || r.signal === 'BUY').length
  const bearishCount  = results.filter(r => r.signal === 'STRONG_SELL' || r.signal === 'SELL').length
  const surgeCount    = results.filter(r => r.volume_surge_ratio >= 2).length
  const avgIv         = results.filter(r => r.atm_iv_pct).reduce((s, r) => s + r.atm_iv_pct, 0) / (results.filter(r => r.atm_iv_pct).length || 1)

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  const handleOpenTrade = (item) => setModal(item)

  const confirmTrade = (item, { direction, qty }) => {
    setOpening(item.symbol)
    openTrade.mutate(
      {
        symbol:      item.symbol,
        asset_type:  item.asset_type,
        direction,
        entry_price: item.price,
        take_profit: direction === 'BUY' ? item.price * 1.05 : item.price * 0.95,
        stop_loss:   direction === 'BUY' ? item.price * 0.97 : item.price * 1.03,
        quantity:    qty,
        signal:      `SMART MONEY — ${item.signal}`,
        top_reason:  `Options: ${item.options_bias} · Volume: ${item.volume_bias} · Surge ${item.volume_surge_ratio}×`,
      },
      {
        onSuccess: () => {
          toast.success(`Trade opened: ${direction} ${item.symbol} @ ${item.price}`)
          setOpening(null)
          setModal(null)
        },
        onError: () => {
          toast.error(`Failed to open trade for ${item.symbol}`)
          setOpening(null)
        },
      }
    )
  }

  const handleNavigate = (symbol, assetType) => {
    setSymbol(symbol, assetType)
    navigate('/market')
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Zap size={22} className="text-yellow-400" />
            Smart Money
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Real-time institutional activity — options flow + volume accumulation signals.
            {lastUpdated && (
              <span className="ml-2 text-slate-600">Updated {lastUpdated}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Crypto toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => setCrypto(v => !v)}
              className={`w-9 h-5 rounded-full transition-colors ${includeCrypto ? 'bg-brand-600' : 'bg-dark-600'}`}
            >
              <div className={`w-3.5 h-3.5 bg-white rounded-full mt-0.75 transition-transform ${includeCrypto ? 'translate-x-4' : 'translate-x-0.5'}`}
                style={{ marginTop: '3px', marginLeft: includeCrypto ? '18px' : '3px' }}
              />
            </div>
            <span className="text-xs text-slate-400">Include Crypto</span>
          </label>

          {/* Live indicator */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            {isFetching
              ? <><RefreshCw size={11} className="animate-spin text-brand-400" /><span className="text-brand-400">Refreshing…</span></>
              : <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" /><span>Auto-refresh 3 min</span></>
            }
          </div>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn-ghost flex items-center gap-1.5 text-sm"
          >
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary stats */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Bullish Signals" value={bullishCount} color="text-emerald-400" icon={TrendingUp}  tip="Stocks with BUY or STRONG BUY signals — options flow and/or volume accumulation pointing up." />
          <StatCard label="Bearish Signals" value={bearishCount} color="text-red-400"     icon={TrendingDown} tip="Stocks with SELL or STRONG SELL signals — put sweeps and/or distribution volume detected." />
          <StatCard label="Volume Surges"   value={surgeCount}   color="text-yellow-400"  icon={BarChart2}   tip="Stocks trading at ≥2× their 20-day average volume today — a key footprint of institutional block activity." />
          <StatCard label="Avg ATM IV"      value={`${fmt(avgIv)}%`} color="text-purple-400" icon={Activity} tip="Average At-The-Money Implied Volatility across scanned stocks. >30% = elevated uncertainty. >50% = high fear or pending catalyst." />
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {FILTERS.map(f => {
          const sig = FILTER_SIGNAL[f]
          const count = sig ? results.filter(r => r.signal === sig).length : results.length
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-brand-600 text-white'
                  : 'bg-dark-700 text-slate-400 hover:bg-dark-600 hover:text-slate-200'
              }`}
            >
              {f} {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
            </button>
          )
        })}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 border-b border-dark-700 animate-pulse bg-dark-700/30" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-dark-800 border border-dark-700 rounded-xl">
          <EmptyState filter={filter} />
        </div>
      ) : (
        <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-600 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="text-left py-3 pl-4 pr-3">Symbol</th>
                  <th className="text-left py-3 px-3">
                    <ColHeader label="Signal" tip="Composite score −4 to +4. Each bullish condition (call sweep, negative IV skew, max pain above price, vol surge above VWAP) adds +1. Bearish subtracts. ≥3 = Strong Buy, ≤−3 = Strong Sell." wide />
                  </th>
                  <th className="text-left py-3 px-3">
                    <ColHeader label="Options Flow" tip="Derived from the nearest monthly options chain. Low put/call ratio = institutions buying calls (bullish). High ratio = hedging with puts (bearish). 15-min delayed." wide />
                  </th>
                  <th className="text-left py-3 px-3">
                    <ColHeader label="Volume" tip="Today's traded volume vs the 20-day daily average. A ≥2× surge is the footprint of institutional block activity." wide />
                  </th>
                  <th className="text-left py-3 px-3">
                    <ColHeader label="VWAP" tip="Volume-Weighted Average Price for the current session. Institutions benchmark all executions against VWAP — price above it means buyers are dominant." wide />
                  </th>
                  <th className="text-left py-3 px-3">
                    <ColHeader label="Max Pain" tip="The options strike where the most contracts expire worthless. Market makers are incentivised to push price here near expiry. % shows distance from current price." wide />
                  </th>
                  <th className="text-left py-3 pl-3 pr-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <SmartMoneyRow
                    key={item.symbol}
                    item={item}
                    onOpenTrade={handleOpenTrade}
                    onNavigate={handleNavigate}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-dark-700 text-xs text-slate-600">
            {filtered.length} symbol{filtered.length !== 1 ? 's' : ''} · Options data 15-min delayed · Volume data intraday
          </div>
        </div>
      )}

      {/* Open Trade Modal */}
      {modal && (
        <OpenTradeModal
          item={modal}
          onClose={() => setModal(null)}
          onConfirm={(vals) => confirmTrade(modal, vals)}
          opening={openingSymbol === modal.symbol}
        />
      )}
    </div>
  )
}
