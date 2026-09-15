import { useNavigate } from 'react-router-dom'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useWatchlist } from '../../api/alerts'
import { useQuote } from '../../api/market'
import { useConvictionLeaderboard } from '../../api/conviction'
import { useMarketStore } from '../../store/marketStore'

// Background + border colour based on daily % change
function heatStyle(pct) {
  if (pct >=  3) return { background: 'rgba(21,128,61,0.32)',  borderColor: 'rgba(34,197,94,0.40)' }
  if (pct >=  1) return { background: 'rgba(21,128,61,0.16)',  borderColor: 'rgba(34,197,94,0.22)' }
  if (pct >   0) return { background: 'rgba(21,128,61,0.07)',  borderColor: 'rgba(34,197,94,0.12)' }
  if (pct >  -1) return { background: 'rgba(153,27,27,0.07)',  borderColor: 'rgba(239,68,68,0.12)' }
  if (pct >  -3) return { background: 'rgba(153,27,27,0.16)',  borderColor: 'rgba(239,68,68,0.22)' }
  return              { background: 'rgba(153,27,27,0.32)',  borderColor: 'rgba(239,68,68,0.40)' }
}

const CONV = {
  HIGH_CONVICTION: { icon: '🔥', color: 'text-yellow-400' },
  MODERATE:        { icon: '⚡', color: 'text-emerald-400' },
  WEAK:            { icon: '〰', color: 'text-orange-400' },
  NEUTRAL:         { icon: '—', color: 'text-slate-600' },
}

function SymbolTile({ symbol, assetType, conviction, onClick }) {
  const livePrices = useMarketStore(s => s.livePrices)
  const { data: quote, isPending } = useQuote(symbol, assetType)

  // WebSocket prices override quote when available
  const live       = livePrices[symbol]
  const price      = live?.price      ?? quote?.price
  const changePct  = live?.change_pct ?? quote?.change_pct
  const change     = live?.change     ?? quote?.change
  const name       = quote?.name || symbol

  const loading = isPending && price == null
  const isPos   = (changePct ?? 0) >= 0
  const Icon    = changePct == null ? Minus : isPos ? TrendingUp : TrendingDown
  const numColor = changePct == null ? 'text-slate-500' : isPos ? 'text-emerald-400' : 'text-red-400'

  const conv = conviction ? CONV[conviction.label] : null
  const style = { ...heatStyle(changePct ?? 0), borderWidth: 1, borderStyle: 'solid' }

  return (
    <div
      onClick={onClick}
      style={style}
      className="rounded-xl p-3 cursor-pointer hover:brightness-125 active:scale-95 transition-all duration-150 select-none min-w-0"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-1 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-100 truncate leading-tight">{symbol}</p>
          <p className="text-[10px] text-slate-500 truncate leading-tight">{name !== symbol ? name : assetType}</p>
        </div>
        {conv && (
          <span className={`text-sm shrink-0 ${conv.color}`} title={conviction.label}>
            {conv.icon}
          </span>
        )}
      </div>

      {/* Price */}
      {loading ? (
        <div className="h-6 w-16 bg-dark-700 rounded animate-pulse mb-1.5" />
      ) : (
        <p className="text-base font-bold text-slate-100 tabular-nums leading-tight">
          {price == null ? '—' : price < 1 ? `$${price.toFixed(4)}` : `$${price.toFixed(2)}`}
        </p>
      )}

      {/* Change */}
      <div className={`flex items-center gap-0.5 mt-0.5 ${numColor}`}>
        <Icon size={10} strokeWidth={2.5} />
        {loading ? (
          <div className="h-3 w-10 bg-dark-700 rounded animate-pulse" />
        ) : changePct == null ? (
          <span className="text-[11px]">—</span>
        ) : (
          <span className="text-[11px] font-semibold tabular-nums">
            {isPos ? '+' : ''}{changePct.toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  )
}

export default function MarketHeatmap() {
  const { data: watchlist } = useWatchlist()
  const { data: leaderboard } = useConvictionLeaderboard(50, 0, 'all')
  const navigate  = useNavigate()
  const setSymbol = useMarketStore(s => s.setSymbol)

  if (!watchlist?.length) return null

  const convMap = Object.fromEntries(
    (leaderboard ?? []).map(item => [item.symbol, item])
  )

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-slate-200">Watchlist Pulse</h3>
          <p className="text-xs text-slate-500 mt-0.5">Daily performance · click any tile to open chart</p>
        </div>
        <div className="hidden sm:flex items-center gap-3 text-[10px] text-slate-600">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(21,128,61,0.32)' }} />
            up
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(153,27,27,0.32)' }} />
            down
          </span>
          <span>🔥⚡ conviction</span>
        </div>
      </div>

      {/* Heatmap grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
        {watchlist.map(item => (
          <SymbolTile
            key={item.symbol}
            symbol={item.symbol}
            assetType={item.asset_type}
            conviction={convMap[item.symbol] ?? null}
            onClick={() => {
              setSymbol(item.symbol, item.asset_type)
              navigate('/market')
            }}
          />
        ))}
      </div>
    </div>
  )
}
