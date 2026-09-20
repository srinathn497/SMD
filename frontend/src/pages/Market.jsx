import { useState, useEffect, useRef } from 'react'
import {
  Search, HelpCircle, TrendingUp, TrendingDown, Minus,
  Target, Activity, Building2, Layers, Sparkles, BarChart2,
} from 'lucide-react'
import { useMarketStore } from '../store/marketStore'
import HelpModal from '../components/ui/HelpModal'
import SegmentedControl from '../components/ui/SegmentedControl'
import { useQuote, searchSymbols } from '../api/market'
import { usePrediction } from '../api/signals'
import CandlestickChart from '../components/charts/CandlestickChart'
import SignalCard from '../components/signals/SignalCard'
import PredictionCard from '../components/signals/PredictionCard'
import IntradayPanel from '../components/signals/IntradayPanel'
import ConvictionBadge from '../components/signals/ConvictionBadge'
import OptionsFlowPanel from '../components/signals/OptionsFlowPanel'
import NewsPanel from '../components/news/NewsPanel'
import FundamentalCard from '../components/signals/FundamentalCard'
import VolumeHistoryCard from '../components/signals/VolumeHistoryCard'

const SIGNALS_SUBTABS = [
  { key: 'intraday', label: 'Intraday' },
  { key: 'daily',    label: 'Daily Technicals' },
]

const VIEWS = [
  { key: 'chart',  label: 'Price Chart',    icon: TrendingUp },
  { key: 'volume', label: 'Volume History', icon: BarChart2  },
]

const INTERVALS = [
  { key: '5m',  label: '5m'  },
  { key: '15m', label: '15m' },
  { key: '1h',  label: '1H'  },
  { key: '1d',  label: '1D'  },
  { key: '1wk', label: '1W'  },
]

const RIGHT_TABS = [
  { key: 'conviction',   label: 'Conviction',    icon: Target    },
  { key: 'signals',      label: 'Signals',        icon: Activity  },
  { key: 'fundamentals', label: 'Fundamentals',   icon: Building2 },
  { key: 'options',      label: 'Options Flow',   icon: Layers    },
  { key: 'prediction',   label: 'ML & Forecast',  icon: Sparkles  },
]

// ── Symbol search ─────────────────────────────────────────────────────────────
function SymbolSearch({ onSelect }) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen]       = useState(false)

  const doSearch = async (q) => {
    setQuery(q)
    if (q.length < 1) { setResults([]); setOpen(false); return }
    try {
      const res = await searchSymbols(q)
      setResults(res)
      setOpen(res.length > 0)
    } catch { setResults([]); setOpen(false) }
  }

  return (
    <div className="relative w-60">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        <input
          className="input pl-8 h-9 text-sm"
          placeholder="Search symbol…"
          value={query}
          onChange={e => doSearch(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => results.length && setOpen(true)}
        />
      </div>
      {open && (
        <div className="absolute z-30 w-full mt-1 bg-dark-800 border border-dark-700 rounded-lg shadow-2xl max-h-64 overflow-y-auto">
          {results.map(r => (
            <button
              key={r.symbol}
              className="w-full text-left px-3 py-2.5 hover:bg-dark-700 flex items-center gap-2 text-sm"
              onMouseDown={() => { onSelect(r.symbol, r.asset_type); setQuery(''); setOpen(false) }}
            >
              <span className="font-semibold text-slate-200 w-14 shrink-0">{r.symbol}</span>
              <span className="text-slate-500 truncate flex-1">{r.name}</span>
              <span className="text-[10px] text-slate-600 capitalize shrink-0">{r.asset_type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Hero quote bar ────────────────────────────────────────────────────────────
function HeroQuoteBar({ symbol, assetType, onSearch, onHelp }) {
  const { data }   = useQuote(symbol, assetType)
  const livePrices = useMarketStore(s => s.livePrices)
  const live       = livePrices[symbol]

  const [flash, setFlash] = useState(null)
  const prevPriceRef = useRef(null)
  useEffect(() => {
    const p = live?.price ?? data?.price
    if (p && prevPriceRef.current !== null && p !== prevPriceRef.current) {
      setFlash(p > prevPriceRef.current ? 'up' : 'down')
      const t = setTimeout(() => setFlash(null), 700)
      prevPriceRef.current = p
      return () => clearTimeout(t)
    }
    if (p) prevPriceRef.current = p
  }, [live?.price, data?.price])

  const price     = live?.price     ?? data?.price
  const change    = live?.change    ?? data?.change
  const changePct = live?.change_pct ?? data?.change_pct
  const isPos     = (changePct ?? 0) >= 0
  const DirIcon   = changePct == null ? Minus : isPos ? TrendingUp : TrendingDown
  const isLive    = live?.price != null

  const flashColor = flash === 'up' ? 'text-brand-500' : flash === 'down' ? 'text-bad-500' : 'text-slate-100'

  return (
    <div className="card">
      <div className="flex items-center gap-6 flex-wrap justify-between">

        {/* Symbol + name + OHLC */}
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-2xl font-bold text-slate-100 tracking-tight truncate">
              {data?.name || symbol}
            </span>
            <span className="text-xs text-slate-300 ticker-num bg-dark-700 px-2 py-0.5 rounded-md border border-dark-600">
              {symbol}
            </span>
            {isLive && (
              <span className="flex items-center gap-1 text-[10px] text-brand-500 font-medium uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
                Live
              </span>
            )}
            <button
              onClick={onHelp}
              className="text-slate-600 hover:text-slate-400 transition-colors"
              title="How to read this page"
            >
              <HelpCircle size={14} />
            </button>
          </div>

          {data && (
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <OHLCStat label="Open"   value={data.open?.toFixed(2)} />
              <OHLCStat label="High"   value={data.high?.toFixed(2)}  accent="bullish" />
              <OHLCStat label="Low"    value={data.low?.toFixed(2)}   accent="bearish" />
              <OHLCStat label="Prev"   value={data.prev_close?.toFixed(2)} />
              <OHLCStat label="Volume" value={abbreviate(data.volume)} />
              {data.market_cap && <OHLCStat label="MCap" value={abbreviate(data.market_cap)} />}
            </div>
          )}
        </div>

        {/* Price hero */}
        <div className="flex items-end gap-4 shrink-0">
          <span className={`text-5xl font-bold ticker-num transition-colors duration-500 ${flashColor}`}>
            {price == null
              ? <span className="text-slate-600 animate-pulse">——</span>
              : price < 1
              ? `$${price.toFixed(4)}`
              : `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            }
          </span>
          {changePct != null && (
            <div className={`flex flex-col items-end pb-1.5 gap-0.5 ${isPos ? 'text-brand-500' : 'text-bad-500'}`}>
              <span
                className={`flex items-center gap-1.5 text-sm font-bold px-2.5 py-1 rounded-full ${
                  isPos ? 'bg-brand-500/10' : 'bg-bad-500/10'
                }`}
              >
                <DirIcon size={13} strokeWidth={2.5} />
                {isPos ? '+' : ''}{changePct.toFixed(2)}%
              </span>
              <span className="text-xs ticker-num opacity-60 text-right">
                {isPos ? '+' : ''}${change?.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {/* Search */}
        <SymbolSearch onSelect={onSearch} />
      </div>
    </div>
  )
}

function OHLCStat({ label, value, accent }) {
  const valueColor = accent === 'bullish'
    ? 'text-brand-500'
    : accent === 'bearish'
    ? 'text-bad-500'
    : 'text-slate-100'
  return (
    <div className="border border-dark-700 rounded-lg px-3 py-2 min-w-[92px]">
      <div className="text-[10px] text-slate-600 uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-semibold ticker-num mt-0.5 ${valueColor}`}>{value ?? '—'}</div>
    </div>
  )
}

function abbreviate(n) {
  if (n == null) return null
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`
  if (n >= 1e9)  return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6)  return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3)  return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString()
}

// ── Left column: chart + volume history tabbed ────────────────────────────────
function ChartPanel({ symbol, assetType, interval, setInterval }) {
  const [view, setView] = useState('chart')

  return (
    <div className="card p-0 overflow-hidden">
      {/* Top bar: chart/volume tabs + interval selector */}
      <div className="px-4 py-2.5 border-b border-dark-700 flex items-center justify-between gap-3 flex-wrap">
        <SegmentedControl options={VIEWS} value={view} onChange={setView} variant="neutral" />
        {view === 'chart' && (
          <SegmentedControl options={INTERVALS} value={interval} onChange={setInterval} variant="solid" />
        )}
      </div>

      {view === 'chart' && (
        <CandlestickChart symbol={symbol} assetType={assetType} interval={interval} height={460} />
      )}
      {view === 'volume' && (
        <div className="border-0">
          <VolumeHistoryCard symbol={symbol} assetType={assetType} embedded />
        </div>
      )}
    </div>
  )
}

// ── Signals tab: Intraday context vs. daily technical indicators ──────────────
// Two unrelated systems (intraday microstructure vs. daily RSI/MACD/BB/EMA) that
// only shared a tab because both are "signals" by name — split via sub-tabs
// instead of stacking them.
function SignalsSection({ symbol, assetType, dailyDirection, dailyConfidence }) {
  const [sub, setSub] = useState('intraday')
  return (
    <div className="space-y-3">
      <SegmentedControl options={SIGNALS_SUBTABS} value={sub} onChange={setSub} variant="neutral" />
      {sub === 'intraday' && (
        <IntradayPanel
          symbol={symbol}
          assetType={assetType}
          dailyDirection={dailyDirection}
          dailyConfidence={dailyConfidence}
        />
      )}
      {sub === 'daily' && (
        <SignalCard symbol={symbol} assetType={assetType} />
      )}
    </div>
  )
}

// ── Right column: tabbed panel ────────────────────────────────────────────────
function RightPanel({ symbol, assetType, onPeriodChange, onHorizonChange, dailyDirection, dailyConfidence }) {
  const [activeTab, setActiveTab] = useState('conviction')

  return (
    <div className="space-y-0 lg:sticky lg:top-4">

      {/* Tab bar — wraps to a second row instead of truncating labels */}
      <div className="card p-2 mb-3">
        <SegmentedControl options={RIGHT_TABS} value={activeTab} onChange={setActiveTab} variant="tint" wrap />
      </div>

      {/* Tab content */}
      <div className="space-y-3">
        {activeTab === 'conviction' && (
          <ConvictionBadge symbol={symbol} assetType={assetType} />
        )}

        {activeTab === 'signals' && (
          <SignalsSection
            symbol={symbol}
            assetType={assetType}
            dailyDirection={dailyDirection}
            dailyConfidence={dailyConfidence}
          />
        )}

        {activeTab === 'fundamentals' && (
          <FundamentalCard symbol={symbol} assetType={assetType} />
        )}

        {activeTab === 'options' && (
          <OptionsFlowPanel symbol={symbol} assetType={assetType} />
        )}

        {activeTab === 'prediction' && (
          <PredictionCard
            symbol={symbol}
            assetType={assetType}
            onPeriodChange={onPeriodChange}
            onHorizonChange={onHorizonChange}
          />
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Market() {
  const { selectedSymbol, selectedAssetType, setSymbol } = useMarketStore()
  const [interval, setInterval] = useState('1d')
  const [period, setPeriod]     = useState('3y')
  const [horizon, setHorizon]   = useState('1d')
  const [showHelp, setShowHelp] = useState(false)

  const { data: prediction } = usePrediction(selectedSymbol, selectedAssetType, period, horizon)

  return (
    <div className="p-6 max-w-7xl space-y-4">
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      <HeroQuoteBar
        symbol={selectedSymbol}
        assetType={selectedAssetType}
        onSearch={setSymbol}
        onHelp={() => setShowHelp(true)}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 items-start">

        {/* ── Left: chart panel (with volume history tab) ──────────────── */}
        <ChartPanel
          symbol={selectedSymbol}
          assetType={selectedAssetType}
          interval={interval}
          setInterval={setInterval}
        />

        {/* ── Right: tabbed analysis panel ─────────────────────────────── */}
        <RightPanel
          symbol={selectedSymbol}
          assetType={selectedAssetType}
          onPeriodChange={setPeriod}
          onHorizonChange={setHorizon}
          dailyDirection={prediction?.direction ?? 'UNKNOWN'}
          dailyConfidence={prediction?.confidence_pct ?? 0}
        />

      </div>

      {/* ── Full-width news ───────────────────────────────────────────────── */}
      <NewsPanel symbol={selectedSymbol} assetType={selectedAssetType} />
    </div>
  )
}
