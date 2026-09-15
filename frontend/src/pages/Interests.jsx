import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Star, TrendingUp, TrendingDown, Search, X, Loader2, Bell, ChevronRight, Newspaper, LayoutGrid, History } from 'lucide-react'
import toast from 'react-hot-toast'
import { useWatchlist, useAddToWatchlist, useRemoveFromWatchlist } from '../api/alerts'
import PredictionHistoryTab from '../components/signals/PredictionHistoryTab'
import { useSearchSymbols } from '../api/market'
import { useScanSingle } from '../api/scan'
import { useOpenTrade } from '../api/trades'
import { useNews } from '../api/news'
import { useMarketStore } from '../store/marketStore'

const SENTIMENT_CONFIG = {
  POSITIVE: { color: 'text-emerald-400', dot: 'bg-emerald-400' },
  NEUTRAL:  { color: 'text-yellow-400',  dot: 'bg-yellow-400' },
  NEGATIVE: { color: 'text-red-400',     dot: 'bg-red-400' },
}

const SIGNAL_CONFIG = {
  'STRONG BUY':  { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  'BUY':         { color: 'text-emerald-300', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  'WEAK BUY':    { color: 'text-teal-400',    bg: 'bg-teal-500/10 border-teal-500/30' },
  'HOLD':        { color: 'text-yellow-400',  bg: 'bg-yellow-500/10 border-yellow-500/30' },
  'WEAK SELL':   { color: 'text-orange-400',  bg: 'bg-orange-500/10 border-orange-500/30' },
  'SELL':        { color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30' },
  'STRONG SELL': { color: 'text-red-500',     bg: 'bg-red-500/10 border-red-500/30' },
}

// ── Add symbol search box ──────────────────────────────────────────────────────
function AddSymbolBox({ onAdd }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)
  const { data: suggestions = [] } = useSearchSymbols(query.trim())

  useEffect(() => {
    const handler = (e) => {
      if (!dropdownRef.current?.contains(e.target) && !inputRef.current?.contains(e.target))
        setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = (s) => {
    setQuery(''); setOpen(false)
    onAdd(s.symbol, s.asset_type, s.name || s.symbol)
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && query.trim()) {
      const q = query.trim().toUpperCase()
      onAdd(q, q.endsWith('-USD') ? 'crypto' : 'stock', q)
      setQuery(''); setOpen(false)
    }
    if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="relative w-full max-w-xs">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          ref={inputRef}
          className="input w-full pl-9 pr-8 text-sm"
          placeholder="Add symbol to Interests…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => query && setOpen(true)}
          onKeyDown={handleKey}
        />
        {query && (
          <button className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            onClick={() => { setQuery(''); setOpen(false) }}>
            <X size={13} />
          </button>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div ref={dropdownRef}
          className="absolute z-50 top-full mt-1 w-full bg-dark-800 border border-dark-600 rounded-lg shadow-xl overflow-hidden">
          {suggestions.map(s => (
            <button key={s.symbol}
              className="w-full text-left px-4 py-2.5 hover:bg-dark-700 flex items-center justify-between"
              onMouseDown={e => { e.preventDefault(); select(s) }}>
              <span className="font-mono font-semibold text-slate-200 w-20 text-sm">{s.symbol}</span>
              <span className="text-xs text-slate-400 truncate flex-1">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Single interest card ───────────────────────────────────────────────────────
function InterestCard({ item, onRemove, onViewChart, onSetAlert, onOpenTrade }) {
  const scanSingle = useScanSingle()
  const [scanData, setScanData] = useState(null)
  const [scanning, setScanning] = useState(false)
  const { data: newsData } = useNews(item.symbol, item.asset_type)

  useEffect(() => {
    setScanning(true)
    scanSingle.mutate(
      { symbol: item.symbol, assetType: item.asset_type },
      {
        onSuccess: (res) => { setScanData(res); setScanning(false) },
        onError: () => setScanning(false),
      }
    )
  }, [item.symbol])

  const sigCfg = SIGNAL_CONFIG[scanData?.recommendation] ?? SIGNAL_CONFIG['HOLD']
  const sentCfg = SENTIMENT_CONFIG[newsData?.label] ?? SENTIMENT_CONFIG.NEUTRAL
  const priceUp = (scanData?.change_pct ?? 0) >= 0
  const Icon = priceUp ? TrendingUp : TrendingDown
  const topHeadline = newsData?.articles?.[0]?.title

  const isTradeable = scanData && ['STRONG BUY','BUY','WEAK BUY','STRONG SELL','SELL','WEAK SELL'].includes(scanData.recommendation)

  return (
    <div
      onClick={() => onViewChart(item.symbol, item.asset_type)}
      className="card border border-dark-600 space-y-3 relative cursor-pointer hover:border-brand-500/50 hover:bg-dark-750 transition-colors"
    >
      {/* Remove button — always visible, stops card click propagating */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(item.id) }}
        title="Remove from Interests"
        className="absolute top-2 right-2 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded p-0.5 transition-colors"
      >
        <X size={13} />
      </button>

      {/* Header row */}
      <div className="flex items-start justify-between pr-5">
        <div>
          <p className="font-bold text-slate-100">{item.symbol}</p>
          <p className="text-xs text-slate-500 mt-0.5">{item.display_name}</p>
        </div>
        {scanning ? (
          <Loader2 size={14} className="animate-spin text-brand-400 mt-1" />
        ) : scanData ? (
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${sigCfg.bg} ${sigCfg.color} whitespace-nowrap`}>
            {scanData.recommendation}
          </span>
        ) : null}
      </div>

      {/* Price row */}
      {scanData && (
        <div className="flex items-center justify-between">
          <span className="text-xl font-bold text-slate-200">
            ${scanData.price < 1 ? scanData.price.toFixed(6) : scanData.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <div className={`flex items-center gap-1 text-sm ${priceUp ? 'text-emerald-400' : 'text-red-400'}`}>
            <Icon size={13} />
            {priceUp ? '+' : ''}{scanData.change_pct?.toFixed(2)}%
          </div>
        </div>
      )}

      {/* News headline */}
      {topHeadline && (
        <div className="flex items-start gap-1.5">
          <Newspaper size={11} className={`flex-shrink-0 mt-0.5 ${sentCfg.color}`} />
          <div>
            <p className="text-xs text-slate-400 leading-snug line-clamp-2">{topHeadline}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${sentCfg.dot}`} />
              <span className={`text-xs ${sentCfg.color}`}>{newsData.label}</span>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons — stopPropagation so they don't trigger card navigation */}
      <div className="flex gap-2 pt-1 border-t border-dark-600/50" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => onViewChart(item.symbol, item.asset_type)}
          className="flex-1 text-xs px-2 py-1.5 rounded bg-dark-700 hover:bg-dark-600 text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center gap-1"
        >
          <TrendingUp size={11} /> Chart
        </button>
        <button
          onClick={() => onSetAlert(item.symbol, item.asset_type)}
          className="flex-1 text-xs px-2 py-1.5 rounded bg-dark-700 hover:bg-dark-600 text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center gap-1"
        >
          <Bell size={11} /> Alert
        </button>
        {isTradeable && (
          <button
            onClick={() => onOpenTrade(scanData)}
            className={`flex-1 text-xs px-2 py-1.5 rounded transition-colors flex items-center justify-center gap-1 ${
              scanData.recommendation.includes('BUY')
                ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-600/30 hover:bg-emerald-600/30'
                : 'bg-red-600/20 text-red-300 border border-red-600/30 hover:bg-red-600/30'
            }`}
          >
            <ChevronRight size={11} /> Trade
          </button>
        )}
      </div>
    </div>
  )
}

// ── Set Alert mini-modal ───────────────────────────────────────────────────────
function QuickAlertModal({ symbol, assetType, onClose }) {
  const navigate = useNavigate()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-dark-800 border border-dark-600 rounded-xl p-5 w-80 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-semibold text-slate-200">Set Alert for {symbol}</p>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={15} /></button>
        </div>
        <p className="text-sm text-slate-400">Go to Alerts page to create a detailed alert for this symbol.</p>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-ghost flex-1 text-sm">Cancel</button>
          <button
            onClick={() => { onClose(); navigate('/alerts') }}
            className="flex-1 text-sm px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-colors"
          >
            Go to Alerts
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Open Trade mini-modal (reused pattern from Recommendations) ────────────────
function QuickTradeModal({ item, onConfirm, onClose, opening }) {
  const isBuy = item.recommendation?.includes('BUY')
  const fmt = (n) => n < 1 ? n?.toFixed(6) : n?.toFixed(2)
  const [quantity, setQuantity] = useState('1')
  const [entryPrice, setEntryPrice] = useState(fmt(item.entry_price || item.price) || '')
  const qty = parseFloat(quantity) || 0
  const ep  = parseFloat(entryPrice) || 0
  const valid = qty > 0 && ep > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-dark-800 border border-dark-600 rounded-xl p-5 w-80 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">Open Trade</p>
            <p className="font-bold text-slate-100">{item.symbol}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${isBuy ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
              {isBuy ? 'BUY' : 'SELL'}
            </span>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={15} /></button>
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Entry Price ($)</label>
          <input type="number" min="0" step="any" className="input w-full text-sm" value={entryPrice} onChange={e => setEntryPrice(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Quantity</label>
          <input type="number" min="0.0001" step="any" className="input w-full text-sm" value={quantity} onChange={e => setQuantity(e.target.value)} />
        </div>
        {valid && (
          <p className="text-xs text-slate-500 text-right">Total: <span className="text-slate-300 font-semibold">${(qty * ep).toFixed(2)}</span></p>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-ghost flex-1 text-sm">Cancel</button>
          <button
            disabled={!valid || opening}
            onClick={() => onConfirm({ ...item, entry_price: ep, quantity: qty })}
            className={`flex-1 text-sm px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 ${isBuy ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-red-600 hover:bg-red-500 text-white'}`}
          >
            {opening ? 'Opening...' : `Confirm ${isBuy ? 'BUY' : 'SELL'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Interests() {
  const navigate = useNavigate()
  const setSymbol = useMarketStore(s => s.setSymbol)
  const { data: watchlist = [], isPending } = useWatchlist()
  const addToWatchlist = useAddToWatchlist()
  const removeFromWatchlist = useRemoveFromWatchlist()
  const openTradeMutation = useOpenTrade()

  const [alertModal, setAlertModal] = useState(null)   // { symbol, assetType }
  const [tradeModal, setTradeModal] = useState(null)   // scan item
  const [openingSymbol, setOpeningSymbol] = useState(null)
  const [activeTab, setActiveTab] = useState('interests')

  const watchlistSymbols = watchlist.map(w => w.symbol)

  const handleAdd = (symbol, assetType, name) => {
    if (watchlist.find(w => w.symbol === symbol)) {
      toast('Already in Interests', { icon: '⭐' }); return
    }
    addToWatchlist.mutate(
      { symbol, asset_type: assetType, display_name: name || symbol },
      { onError: () => toast.error(`Could not add ${symbol}`) }
    )
  }

  const handleRemove = (id) => {
    removeFromWatchlist.mutate(id, { onError: () => toast.error('Could not remove') })
  }

  const handleViewChart = (symbol, assetType) => {
    setSymbol(symbol, assetType)
    navigate('/market')
  }

  const confirmTrade = (item) => {
    const isBuy = item.recommendation?.includes('BUY')
    setOpeningSymbol(item.symbol)
    openTradeMutation.mutate(
      {
        symbol: item.symbol,
        asset_type: item.asset_type,
        direction: isBuy ? 'BUY' : 'SELL',
        entry_price: item.entry_price,
        take_profit: item.take_profit,
        stop_loss: item.stop_loss,
        quantity: item.quantity,
        signal: item.recommendation,
        top_reason: item.top_reason || '',
      },
      {
        onSuccess: () => {
          toast.success(`Trade opened: ${item.symbol}`)
          setOpeningSymbol(null)
          setTradeModal(null)
        },
        onError: () => {
          toast.error(`Failed to open trade`)
          setOpeningSymbol(null)
        },
      }
    )
  }

  return (
    <div className="p-6 space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Star size={22} className="text-yellow-400 fill-yellow-400" />
            Interests
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Pin symbols you want to monitor — live signals, news sentiment, and quick trade access.
          </p>
        </div>
        <AddSymbolBox onAdd={handleAdd} />
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-dark-600/60">
        {[
          { id: 'interests', label: 'My Interests', Icon: LayoutGrid },
          { id: 'history',   label: 'Prediction History', Icon: History },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 text-sm px-4 py-2.5 border-b-2 transition-colors -mb-px ${
              activeTab === id
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Prediction History tab */}
      {activeTab === 'history' && (
        watchlistSymbols.length === 0 ? (
          <div className="card text-center py-10">
            <p className="text-sm text-slate-400">Add symbols to Interests to see their prediction history.</p>
          </div>
        ) : (
          <PredictionHistoryTab symbols={watchlistSymbols} />
        )
      )}

      {activeTab === 'interests' && <>

      {/* Loading */}
      {isPending && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="card animate-pulse space-y-3">
              <div className="h-4 bg-dark-600 rounded w-24" />
              <div className="h-8 bg-dark-600 rounded" />
              <div className="h-10 bg-dark-600 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isPending && watchlist.length === 0 && (
        <div className="card text-center py-16">
          <Star size={40} className="mx-auto text-slate-600 mb-4" />
          <p className="text-slate-300 font-medium text-lg">No symbols added yet</p>
          <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">
            Use the search box above to add stocks or crypto you want to monitor with live signals and news.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {['AAPL', 'NVDA', 'TSLA', 'BTC-USD', 'ETH-USD', 'MSFT'].map(sym => (
              <button
                key={sym}
                onClick={() => handleAdd(sym, sym.endsWith('-USD') ? 'crypto' : 'stock', sym)}
                className="px-3 py-1.5 text-xs rounded-full border border-dark-600 text-slate-400 hover:border-brand-500 hover:text-brand-400 transition-colors"
              >
                {sym}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Interest cards grid */}
      {!isPending && watchlist.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {watchlist.map(item => (
            <InterestCard
              key={item.id}
              item={item}
              onRemove={handleRemove}
              onViewChart={handleViewChart}
              onSetAlert={(sym, at) => setAlertModal({ symbol: sym, assetType: at })}
              onOpenTrade={(scanData) => setTradeModal(scanData)}
            />
          ))}
        </div>
      )}

      </> /* end interests tab */}

      {/* Modals */}
      {alertModal && (
        <QuickAlertModal
          symbol={alertModal.symbol}
          assetType={alertModal.assetType}
          onClose={() => setAlertModal(null)}
        />
      )}
      {tradeModal && (
        <QuickTradeModal
          item={tradeModal}
          onConfirm={confirmTrade}
          onClose={() => setTradeModal(null)}
          opening={openingSymbol === tradeModal.symbol}
        />
      )}
    </div>
  )
}
