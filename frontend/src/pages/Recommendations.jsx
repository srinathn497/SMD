import { useState } from 'react'
import {
  Search, TrendingUp, TrendingDown, Minus, X, RefreshCw,
  Trophy, History, Brain, Target, ShieldAlert, CheckCircle,
  XCircle, ChevronDown, ChevronRight, AlertCircle, Zap, Activity,
} from 'lucide-react'
import toast from 'react-hot-toast'
import ConvictionLeaderboard from '../components/signals/ConvictionLeaderboard'
import PredictionHistoryTab from '../components/signals/PredictionHistoryTab'
import SignalIntelligence from '../components/signals/SignalIntelligence'
import { useOpenTrade } from '../api/trades'
import { useSearchSymbols } from '../api/market'

const BASE = 'http://localhost:8000/api/v1'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt$ = v => {
  if (v == null) return '—'
  const n = Number(v)
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const fmtPct = (v, d = 1) => v == null ? '—' : `${Number(v).toFixed(d)}%`

const LABEL_CFG = {
  HIGH_CONVICTION: { color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30', emoji: '🔥' },
  MODERATE:        { color: 'text-brand-400',  bg: 'bg-brand-500/10 border-brand-500/30',   emoji: '⚡' },
  WEAK:            { color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30', emoji: '〰' },
  NEUTRAL:         { color: 'text-slate-500',  bg: 'bg-dark-700 border-dark-600',            emoji: '—'  },
}
const DIR_CFG = {
  BUY:     { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', Icon: TrendingUp    },
  SELL:    { color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30',         Icon: TrendingDown  },
  NEUTRAL: { color: 'text-slate-500',   bg: 'bg-dark-700 border-dark-600',              Icon: Minus         },
}

// ── Open Trade Modal ──────────────────────────────────────────────────────────

function OpenTradeModal({ item, onConfirm, onClose, opening }) {
  const isBuy = item.direction === 'BUY'
  const fmt = n => n < 1 ? n.toFixed(6) : n.toFixed(2)
  const [quantity, setQuantity]     = useState('1')
  const [entryPrice, setEntryPrice] = useState(fmt(item.entry_price || item.stock_price || 0))

  const qty = parseFloat(quantity) || 0
  const ep  = parseFloat(entryPrice) || 0
  const valid = qty > 0 && ep > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-dark-800 border border-dark-600 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5 space-y-4"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Open Trade</p>
            <h3 className="text-lg font-bold text-slate-100">{item.symbol}</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold px-2 py-0.5 rounded-full border ${isBuy ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
              {isBuy ? 'BUY' : 'SELL'}
            </span>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-500 block mb-1">Entry Price ($)</label>
          <input type="number" min="0" step="any" className="input w-full text-sm"
            value={entryPrice} onChange={e => setEntryPrice(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Quantity (shares)</label>
          <input type="number" min="0.0001" step="any" className="input w-full text-sm"
            value={quantity} onChange={e => setQuantity(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs bg-dark-700/50 rounded-lg p-3">
          <div>
            <p className="text-slate-600 mb-0.5 flex items-center gap-1"><Target size={9} /> Take Profit</p>
            <p className="font-medium text-emerald-400">{fmt$(item.take_profit)}</p>
          </div>
          <div>
            <p className="text-slate-600 mb-0.5 flex items-center gap-1"><ShieldAlert size={9} /> Stop Loss</p>
            <p className="font-medium text-red-400">{fmt$(item.stop_loss)}</p>
          </div>
        </div>

        {valid && (
          <p className="text-xs text-slate-500 text-right">
            Total: <span className="text-slate-300 font-semibold">${(qty * ep).toFixed(2)}</span>
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost flex-1 text-sm">Cancel</button>
          <button disabled={!valid || opening}
            onClick={() => onConfirm({ ...item, entry_price: ep, quantity: qty })}
            className={`flex-1 text-sm px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 ${isBuy ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-red-600 hover:bg-red-500 text-white'}`}>
            {opening ? 'Opening…' : `Confirm ${isBuy ? 'BUY' : 'SELL'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Signal row ────────────────────────────────────────────────────────────────

function SignalChip({ sig }) {
  return (
    <div className={`flex items-start gap-1.5 px-2 py-1.5 rounded-lg border text-xs ${sig.passed ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
      <div className="shrink-0 mt-0.5">
        {sig.passed
          ? <CheckCircle size={10} className="text-emerald-400" />
          : <XCircle size={10} className="text-red-400" />}
      </div>
      <div className="min-w-0">
        <p className={`font-medium leading-tight ${sig.passed ? 'text-emerald-300' : 'text-red-300'}`}>{sig.name}</p>
        <p className="text-slate-600 leading-tight truncate" title={sig.detail}>{sig.detail}</p>
      </div>
    </div>
  )
}

// ── Conviction analysis card (on-demand result) ───────────────────────────────

function ConvictionCard({ symbol, data, error, loading, onRemove, onOpenTrade }) {
  const [sigExpanded, setSigExpanded] = useState(false)

  if (loading) {
    return (
      <div className="bg-dark-800 border border-dark-700 rounded-xl p-5 space-y-3 animate-pulse">
        <div className="flex items-center gap-3">
          <RefreshCw size={15} className="animate-spin text-brand-400 shrink-0" />
          <div>
            <p className="text-sm font-bold text-slate-200">{symbol}</p>
            <p className="text-xs text-slate-500">Running 17-signal analysis — ~5-10 seconds…</p>
          </div>
        </div>
        <div className="h-1.5 bg-dark-700 rounded-full w-full" />
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-dark-700 rounded-lg" />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-dark-800 border border-red-500/20 rounded-xl p-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-200">{symbol}</p>
          <p className="text-xs text-red-400 mt-0.5">{error}</p>
        </div>
        <button onClick={() => onRemove(symbol)} className="text-slate-600 hover:text-slate-300 shrink-0"><X size={14} /></button>
      </div>
    )
  }

  if (!data) return null

  const labelCfg  = LABEL_CFG[data.label] ?? LABEL_CFG.NEUTRAL
  const dirCfg    = DIR_CFG[data.direction] ?? DIR_CFG.NEUTRAL
  const DirIcon   = dirCfg.Icon
  const scorePct  = data.max_score > 0 ? (data.score / data.max_score) * 100 : 0
  const barColor  = data.direction === 'BUY' ? 'bg-emerald-500' : data.direction === 'SELL' ? 'bg-red-500' : 'bg-slate-500'
  const isBuy     = data.direction === 'BUY'
  const isSell    = data.direction === 'SELL'
  const hasLevels = data.take_profit > 0 && data.stop_loss > 0
  const tpPct     = hasLevels && data.entry_price > 0
    ? ((Math.abs(data.take_profit - data.entry_price) / data.entry_price) * 100).toFixed(1)
    : null
  const slPct     = hasLevels && data.entry_price > 0
    ? ((Math.abs(data.stop_loss - data.entry_price) / data.entry_price) * 100).toFixed(1)
    : null
  const canTrade  = isBuy || isSell

  return (
    <div className={`bg-dark-800 border rounded-xl overflow-hidden ${labelCfg.bg}`}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xl font-bold text-slate-100">{data.symbol}</span>
            {data.stock_price > 0 && (
              <span className="text-base font-mono text-slate-300">{fmt$(data.stock_price)}</span>
            )}
            <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${dirCfg.bg} ${dirCfg.color}`}>
              <DirIcon size={10} /> {data.direction}
            </span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${labelCfg.bg} ${labelCfg.color}`}>
              {labelCfg.emoji} {data.label.replace('_', ' ')}
            </span>
          </div>
          <button onClick={() => onRemove(symbol)} className="text-slate-600 hover:text-slate-300 shrink-0 mt-0.5">
            <X size={14} />
          </button>
        </div>

        {/* Score bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Signal strength</span>
            <span className="font-medium text-slate-300">{data.score}/{data.max_score} signals · {fmtPct(data.confidence_pct)} confidence</span>
          </div>
          <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
            <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${scorePct}%` }} />
          </div>
        </div>

        {/* Quick stats */}
        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
          {data.iv_rank != null && (
            <span>
              IV Rank: <span className={`font-medium ${data.iv_rank >= 50 ? 'text-emerald-400' : data.iv_rank <= 30 ? 'text-blue-400' : 'text-slate-300'}`}>
                {data.iv_rank.toFixed(0)}%{data.iv_rank >= 50 ? ' — sell premium' : data.iv_rank <= 30 ? ' — buy options' : ''}
              </span>
            </span>
          )}
          {data.next_earnings_date && (
            <span className={data.days_to_earnings <= 14 ? 'text-yellow-400 font-medium' : ''}>
              Earnings: {data.next_earnings_date} ({data.days_to_earnings}d)
            </span>
          )}
        </div>

        {/* Risk flags */}
        {data.risk_flags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {data.risk_flags.map((f, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/30 text-red-300 flex items-center gap-1">
                <AlertCircle size={9} /> {f}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Signals grid (collapsible) */}
      <div className="px-4 pb-3 border-t border-dark-700 pt-3">
        <button onClick={() => setSigExpanded(v => !v)}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-2">
          {sigExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {sigExpanded ? 'Hide' : 'Show'} all {data.signals.length} signals
        </button>
        {sigExpanded && (
          <div className="grid grid-cols-2 gap-1.5">
            {data.signals.map((sig, i) => <SignalChip key={i} sig={sig} />)}
          </div>
        )}
        {!sigExpanded && (
          <div className="grid grid-cols-2 gap-1.5">
            {data.signals.slice(0, 6).map((sig, i) => <SignalChip key={i} sig={sig} />)}
            {data.signals.length > 6 && (
              <button onClick={() => setSigExpanded(true)}
                className="col-span-2 text-xs text-slate-600 hover:text-slate-400 text-center py-1">
                +{data.signals.length - 6} more signals
              </button>
            )}
          </div>
        )}
      </div>

      {/* Trade levels + Open Trade */}
      {hasLevels && canTrade && (
        <div className="px-4 pb-4 pt-3 border-t border-dark-700 space-y-3">
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div className="bg-dark-700/60 rounded-lg p-2.5">
              <p className="text-slate-600 mb-0.5">Entry</p>
              <p className="font-bold text-slate-200">{fmt$(data.entry_price)}</p>
            </div>
            <div className="bg-dark-700/60 rounded-lg p-2.5">
              <p className="text-slate-600 mb-0.5 flex items-center gap-1"><Target size={8} /> TP</p>
              <p className="font-bold text-emerald-400">{fmt$(data.take_profit)}</p>
              {tpPct && <p className="text-emerald-600">+{tpPct}%</p>}
            </div>
            <div className="bg-dark-700/60 rounded-lg p-2.5">
              <p className="text-slate-600 mb-0.5 flex items-center gap-1"><ShieldAlert size={8} /> SL</p>
              <p className="font-bold text-red-400">{fmt$(data.stop_loss)}</p>
              {slPct && <p className="text-red-600">-{slPct}%</p>}
            </div>
            <div className="bg-dark-700/60 rounded-lg p-2.5">
              <p className="text-slate-600 mb-0.5">R/R</p>
              <p className="font-bold text-slate-200">{data.risk_reward}:1</p>
            </div>
          </div>
          <div className="flex items-center justify-end">
            <button
              onClick={() => onOpenTrade(data)}
              className={`text-sm px-4 py-2 rounded-lg font-semibold transition-colors ${
                isBuy
                  ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-600/40 hover:bg-emerald-600/30'
                  : 'bg-red-600/20 text-red-300 border border-red-600/40 hover:bg-red-600/30'
              }`}
            >
              {isBuy ? '↑ Open BUY Trade' : '↓ Open SELL Trade'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Search box ────────────────────────────────────────────────────────────────

function SearchBox({ onAdd, analyzing }) {
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const { data: suggestions = [] } = useSearchSymbols(query.trim())

  const select = s => { setQuery(''); setOpen(false); onAdd(s.symbol, s.asset_type) }

  const handleKey = e => {
    if (e.key === 'Enter' && query.trim()) {
      const q = query.trim().toUpperCase()
      setQuery(''); setOpen(false)
      onAdd(q, q.endsWith('-USD') ? 'crypto' : 'stock')
    }
    if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="relative w-full max-w-lg">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          className="input w-full pl-9 pr-10 text-sm"
          placeholder="Type a symbol — AAPL, NVDA, TSLA…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => query && setOpen(true)}
          onKeyDown={handleKey}
          disabled={analyzing}
        />
        {query && (
          <button className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            onClick={() => { setQuery(''); setOpen(false) }}>
            <X size={14} />
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-dark-800 border border-dark-600 rounded-lg shadow-xl overflow-hidden">
          {suggestions.map(s => (
            <button key={s.symbol}
              className="w-full text-left px-4 py-2.5 hover:bg-dark-700 flex items-center justify-between group"
              onMouseDown={e => { e.preventDefault(); select(s) }}>
              <div className="flex items-center gap-3">
                <span className="font-mono font-semibold text-slate-200 w-20">{s.symbol}</span>
                <span className="text-sm text-slate-400 truncate">{s.name}</span>
              </div>
              <span className="text-xs text-slate-600 group-hover:text-slate-500">
                {s.asset_type === 'crypto' ? 'Crypto' : s.exchange || 'Stock'}
              </span>
            </button>
          ))}
          {query.trim() && (
            <button
              className="w-full text-left px-4 py-2.5 border-t border-dark-700 hover:bg-dark-700 flex items-center gap-3"
              onMouseDown={e => {
                e.preventDefault()
                const q = query.trim().toUpperCase()
                onAdd(q, q.endsWith('-USD') ? 'crypto' : 'stock')
                setQuery(''); setOpen(false)
              }}>
              <Search size={13} className="text-brand-400" />
              <span className="text-sm text-slate-400">
                Analyse <span className="text-slate-200 font-semibold">{query.trim().toUpperCase()}</span> (17 signals)
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Recommendations() {
  // analyses: { [symbol]: { loading, data, error } }
  const [analyses, setAnalyses] = useState({})
  const [tradeModal, setTradeModal] = useState(null)
  const [openingSymbol, setOpeningSymbol] = useState(null)
  const [activeTab, setActiveTab] = useState('research')
  const openTradeMutation = useOpenTrade()

  const analyzeSymbol = async (symbol, assetType = 'stock') => {
    const sym = symbol.toUpperCase()
    if (analyses[sym]?.loading) return
    setAnalyses(prev => ({ ...prev, [sym]: { loading: true } }))
    // scroll to analyzer section
    document.getElementById('analyzer-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    try {
      const res = await fetch(`${BASE}/income/analyze?symbol=${encodeURIComponent(sym)}&asset_type=${assetType}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.detail ?? 'Analysis failed')
      setAnalyses(prev => ({ ...prev, [sym]: { loading: false, data: json } }))
    } catch (e) {
      setAnalyses(prev => ({ ...prev, [sym]: { loading: false, error: e.message } }))
      toast.error(`${sym}: ${e.message.slice(0, 60)}`)
    }
  }

  const removeAnalysis = symbol => setAnalyses(prev => {
    const next = { ...prev }; delete next[symbol]; return next
  })

  const confirmTrade = item => {
    setOpeningSymbol(item.symbol)
    openTradeMutation.mutate(
      {
        symbol: item.symbol,
        asset_type: item.asset_type ?? 'stock',
        direction: item.direction,
        entry_price: item.entry_price,
        take_profit: item.take_profit,
        stop_loss: item.stop_loss,
        quantity: item.quantity,
        signal: item.label,
        top_reason: `${item.label} · ${item.score}/${item.max_score} signals`,
      },
      {
        onSuccess: () => {
          toast.success(`Trade opened: ${item.direction} ${item.symbol} @ ${fmt$(item.entry_price)} × ${item.quantity}`)
          setOpeningSymbol(null); setTradeModal(null)
        },
        onError: () => {
          toast.error(`Failed to open trade for ${item.symbol}`)
          setOpeningSymbol(null)
        },
      }
    )
  }

  const symbolList = Object.keys(analyses)
  const anyAnalyzing = Object.values(analyses).some(a => a.loading)

  const TABS = [
    { id: 'research',     label: 'Stock Research',      Icon: Activity  },
    { id: 'history',      label: 'Prediction History',  Icon: History   },
    { id: 'intelligence', label: 'Signal Intelligence', Icon: Brain     },
  ]

  return (
    <div className="p-6 space-y-5 max-w-7xl">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2.5">
          <Trophy size={22} className="text-yellow-400" />
          Recommendations
        </h2>
        <p className="text-slate-500 text-sm mt-1">
          Full 17-signal analysis — ML model, technicals, fundamentals, sentiment, volume, and more
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-dark-600/60">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 text-sm px-4 py-2.5 border-b-2 transition-colors -mb-px ${
              activeTab === id
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}>
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'history' && <PredictionHistoryTab />}
      {activeTab === 'intelligence' && <SignalIntelligence />}

      {activeTab === 'research' && (
        <div className="space-y-6">

          {/* Conviction Leaderboard — gap info shown inline on MODERATE/WEAK rows */}
          <ConvictionLeaderboard onAnalyze={analyzeSymbol} />

          {/* On-demand Conviction Analyzer */}
          <div id="analyzer-section" className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-dark-600/60" />
              <span className="text-xs text-slate-500 uppercase tracking-wider whitespace-nowrap flex items-center gap-1.5">
                <Search size={11} /> On-demand 17-signal analyzer
              </span>
              <div className="flex-1 border-t border-dark-600/60" />
            </div>

            <div className="space-y-3">
              <SearchBox onAdd={analyzeSymbol} analyzing={anyAnalyzing} />
              <p className="text-xs text-slate-600">
                Runs live: ML prediction, RSI/MACD/BB, fundamentals (FCF, D/E, P/E), sentiment, volume, breakout, mean reversion · ~5-10 seconds
              </p>
            </div>

            {/* Quick chips */}
            {symbolList.length === 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'META'].map(sym => (
                  <button key={sym}
                    onClick={() => analyzeSymbol(sym, 'stock')}
                    className="px-3 py-1.5 text-xs rounded-full border border-dark-600 text-slate-400 hover:border-brand-500 hover:text-brand-400 transition-colors">
                    {sym}
                  </button>
                ))}
              </div>
            )}

            {/* Clear all */}
            {symbolList.length > 1 && (
              <div className="flex justify-end">
                <button onClick={() => setAnalyses({})}
                  className="text-xs text-slate-600 hover:text-slate-400 transition-colors">
                  Clear all
                </button>
              </div>
            )}

            {/* Result cards */}
            {symbolList.length > 0 && (
              <div className="space-y-4">
                {symbolList.map(sym => {
                  const state = analyses[sym]
                  return (
                    <ConvictionCard
                      key={sym}
                      symbol={sym}
                      data={state.data}
                      error={state.error}
                      loading={state.loading}
                      onRemove={removeAnalysis}
                      onOpenTrade={item => setTradeModal(item)}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Trade confirmation modal */}
      {tradeModal && (
        <OpenTradeModal
          item={tradeModal}
          onConfirm={confirmTrade}
          onClose={() => setTradeModal(null)}
          opening={openingSymbol === tradeModal.symbol}
        />
      )}
    </div>
  )
}
