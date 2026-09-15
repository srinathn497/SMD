import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Target, TrendingUp, TrendingDown, Clock, Shield, Zap, ChevronRight,
  RefreshCw, AlertTriangle, BarChart2, Layers,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useTradeIdeas, useGenerateTradeIdeas, useScanStatus } from '../api/tradeIdeas'
import { useOpenTrade } from '../api/trades'
import { useMarketStore } from '../store/marketStore'
import { useSmartMoney } from '../api/smartMoney'

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tooltip({ text, children, wide = false }) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const width = wide ? 224 : 176

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

// ── Helpers ───────────────────────────────────────────────────────────────────

const HORIZON_CONFIG = {
  MOMENTUM_1_2D:   { label: 'Momentum · 1–2d', color: 'text-yellow-400',  bg: 'bg-yellow-400/10', Icon: Zap },
  SWING_3_7D:      { label: 'Swing · 3–7d',    color: 'text-brand-400',   bg: 'bg-brand-400/10',  Icon: TrendingUp },
  POSITIONAL_2_4W: { label: 'Position · 2–4w', color: 'text-purple-400',  bg: 'bg-purple-400/10', Icon: Layers },
}

const LABEL_COLOR = {
  HIGH_CONVICTION: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  MODERATE:        'text-brand-400   bg-brand-400/10   border-brand-400/30',
  WEAK:            'text-yellow-400  bg-yellow-400/10  border-yellow-400/30',
}

function pct(a, b) {
  if (!b || b === 0) return '—'
  return ((a - b) / b * 100).toFixed(1) + '%'
}

function fmt(n, decimals = 2) {
  if (!n && n !== 0) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

// ── Open Trade Modal ──────────────────────────────────────────────────────────

function OpenIdeaModal({ idea, onClose, onConfirm, opening }) {
  const [qty, setQty] = useState(idea.position_size_1pct || 1)
  const [ep, setEp]   = useState(((idea.entry_low + idea.entry_high) / 2).toFixed(4))
  const isBuy = idea.direction === 'BUY'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-800 border border-dark-600 rounded-2xl w-full max-w-sm mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-100">Open Trade — {idea.symbol}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg">✕</button>
        </div>

        <div className="flex gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${isBuy ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
            {idea.direction}
          </span>
          <span className="px-3 py-1 rounded-full text-xs border border-dark-500 text-slate-400">
            {idea.conviction_label}
          </span>
        </div>

        <p className="text-xs text-slate-400 italic leading-relaxed">{idea.thesis}</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Entry Price</label>
            <input
              type="number" value={ep} step="0.01" min="0"
              onChange={e => setEp(e.target.value)}
              className="w-full bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-brand-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Quantity</label>
            <input
              type="number" value={qty} step="1" min="1"
              onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-brand-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="bg-dark-700 rounded-lg py-2">
            <p className="text-slate-500">Stop</p>
            <p className="text-red-400 font-medium">${fmt(idea.stop_loss)}</p>
          </div>
          <div className="bg-dark-700 rounded-lg py-2">
            <p className="text-slate-500">Target 1</p>
            <p className="text-brand-400 font-medium">${fmt(idea.target1)}</p>
          </div>
          <div className="bg-dark-700 rounded-lg py-2">
            <p className="text-slate-500">Target 2</p>
            <p className="text-emerald-400 font-medium">${fmt(idea.target2)}</p>
          </div>
        </div>

        <div className="text-xs text-slate-500 bg-dark-700 rounded-lg px-3 py-2">
          <span className="text-slate-400">Exposure:</span>{' '}
          ${(parseFloat(ep) * qty).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          {' · '}
          <span className="text-slate-400">R:R</span> {idea.risk_reward}:1
        </div>

        <button
          onClick={() => onConfirm({ ep: parseFloat(ep), qty })}
          disabled={opening || !qty || !ep}
          className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
            isBuy
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
              : 'bg-red-600   hover:bg-red-500   text-white'
          } disabled:opacity-40`}
        >
          {opening ? 'Opening…' : `Open ${idea.direction} ${idea.symbol}`}
        </button>
      </div>
    </div>
  )
}

// ── Conviction bar ────────────────────────────────────────────────────────────

function ConvictionBar({ score, max }) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0
  const color = pct >= 75 ? 'bg-emerald-500' : pct >= 55 ? 'bg-brand-500' : 'bg-yellow-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-dark-600 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <Tooltip text={`${score} of ${max} signals align with this trade direction. Higher = stronger setup.`}>
        <span className="text-xs text-slate-400 tabular-nums cursor-default">{score}/{max}</span>
      </Tooltip>
    </div>
  )
}

// ── Trade Idea Card ───────────────────────────────────────────────────────────

const BULLISH_SM = new Set(['STRONG_BUY', 'BUY'])
const BEARISH_SM = new Set(['STRONG_SELL', 'SELL'])

function TradeIdeaCard({ idea, onOpenTrade, onNavigate, smartSignal }) {
  const isBuy   = idea.direction === 'BUY'
  const horizon = HORIZON_CONFIG[idea.time_horizon] || HORIZON_CONFIG.SWING_3_7D
  const HorizonIcon = horizon.Icon

  const stopPct   = pct(idea.stop_loss, idea.price)
  const t1Pct     = pct(idea.target1,   idea.price)
  const t2Pct     = pct(idea.target2,   idea.price)

  const isDoubleConfirmed = idea.conviction_label === 'HIGH_CONVICTION' && (
    (isBuy  && BULLISH_SM.has(smartSignal)) ||
    (!isBuy && BEARISH_SM.has(smartSignal))
  )

  return (
    <div className={`relative bg-dark-800 rounded-2xl transition-shadow hover:shadow-lg hover:shadow-black/30 border border-t-2 ${
      isDoubleConfirmed
        ? 'border-violet-500/40 border-t-violet-500'
        : isBuy ? 'border-emerald-500/20 border-t-emerald-500' : 'border-red-500/20 border-t-red-500'
    }`}>

      <div className="p-5 space-y-4">

        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-slate-100">{idea.symbol}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                isBuy ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
              }`}>
                {idea.direction}
              </span>
              <Tooltip
                text={
                  idea.conviction_label === 'HIGH_CONVICTION' ? 'High Conviction: ≥75% of signals agree. Strongest setup quality.' :
                  idea.conviction_label === 'MODERATE'         ? 'Moderate: 55–74% of signals agree. Decent setup, use tighter sizing.' :
                                                                 'Weak: <55% of signals agree. Higher risk — reduce position size.'
                }
                wide
              >
                <span className={`px-2 py-0.5 rounded-full text-xs border cursor-default ${LABEL_COLOR[idea.conviction_label] || LABEL_COLOR.WEAK}`}>
                  {idea.conviction_label.replace('_', ' ')}
                </span>
              </Tooltip>
              {isDoubleConfirmed && (
                <Tooltip text="Smart Money + High Conviction both agree on this direction. Highest-quality setup — options flow, volume, and ML all aligned." wide>
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border bg-violet-500/20 text-violet-300 border-violet-400/30 cursor-default font-semibold">
                    <Zap size={10} />
                    Smart + Conviction
                  </span>
                </Tooltip>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">${fmt(idea.price)} current</p>
          </div>
          <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs ${horizon.bg} ${horizon.color}`}>
            <HorizonIcon size={11} />
            <span>{horizon.label}</span>
          </div>
        </div>

        {/* Thesis */}
        <p className="text-sm text-slate-300 leading-relaxed italic">&ldquo;{idea.thesis}&rdquo;</p>

        {/* Conviction bar */}
        <ConvictionBar score={idea.conviction_score} max={idea.conviction_max} />

        {/* Entry zone */}
        <div className="bg-dark-700/60 rounded-xl p-3 space-y-1">
          <Tooltip text="Price range where this setup is valid. Entering outside this zone degrades the risk/reward." wide>
            <p className="text-xs text-slate-500 uppercase tracking-wide cursor-default">Entry Zone</p>
          </Tooltip>
          <p className="text-sm font-semibold text-slate-100">
            ${fmt(idea.entry_low)} – ${fmt(idea.entry_high)}
          </p>
        </div>

        {/* Levels */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-dark-700/60 rounded-xl p-2.5">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Shield size={10} className="text-red-400" />
              <Tooltip text="Stop loss — exit price if the trade moves against you. % is distance from current price.">
                <p className="text-xs text-slate-500 cursor-default">Stop</p>
              </Tooltip>
            </div>
            <p className="text-sm font-semibold text-red-400">${fmt(idea.stop_loss)}</p>
            <p className="text-xs text-red-400/70">{stopPct}</p>
          </div>
          <div className="bg-dark-700/60 rounded-xl p-2.5">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Target size={10} className="text-brand-400" />
              <Tooltip text="Target 1 — first profit-taking level. Consider exiting 50–75% of position here.">
                <p className="text-xs text-slate-500 cursor-default">T1</p>
              </Tooltip>
            </div>
            <p className="text-sm font-semibold text-brand-400">${fmt(idea.target1)}</p>
            <p className="text-xs text-brand-400/70">{t1Pct}</p>
          </div>
          <div className="bg-dark-700/60 rounded-xl p-2.5">
            <div className="flex items-center justify-center gap-1 mb-1">
              <TrendingUp size={10} className="text-emerald-400" />
              <Tooltip text="Target 2 — full target for maximum gain. The R:R ratio is calculated against this level.">
                <p className="text-xs text-slate-500 cursor-default">T2</p>
              </Tooltip>
            </div>
            <p className="text-sm font-semibold text-emerald-400">${fmt(idea.target2)}</p>
            <p className="text-xs text-emerald-400/70">{t2Pct}</p>
          </div>
        </div>

        {/* R:R + Position size */}
        <div className="flex gap-2">
          <div className="flex-1 bg-dark-700/60 rounded-xl px-3 py-2 text-center">
            <Tooltip text="Risk-to-Reward to Target 2. A 2:1 means $2 potential gain for every $1 risked. Aim for ≥ 2:1." wide>
              <p className="text-xs text-slate-500 cursor-default">R:R (T2)</p>
            </Tooltip>
            <p className={`text-base font-bold ${idea.risk_reward >= 2 ? 'text-emerald-400' : 'text-yellow-400'}`}>
              {idea.risk_reward}:1
            </p>
          </div>
          <div className="flex-1 bg-dark-700/60 rounded-xl px-3 py-2 text-center">
            <Tooltip text="Shares to risk exactly 1% ($100) of a $10,000 account. Scale proportionally for your account size." wide>
              <p className="text-xs text-slate-500 cursor-default">1% risk / $10k</p>
            </Tooltip>
            <p className="text-base font-bold text-slate-200">{idea.position_size_1pct} shares</p>
          </div>
        </div>

        {/* Key signals */}
        {idea.key_signals?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {idea.key_signals.map(sig => (
              <span key={sig} className="px-2 py-0.5 bg-dark-600 text-slate-400 text-xs rounded-full">
                {sig}
              </span>
            ))}
          </div>
        )}

        {/* Invalidation */}
        <Tooltip text="Condition that invalidates this setup. If this occurs, exit immediately — the trade thesis no longer holds." wide>
          <div className="flex items-start gap-2 text-xs text-slate-500 bg-dark-700/40 rounded-lg px-3 py-2 w-full cursor-default">
            <AlertTriangle size={11} className="text-yellow-500 mt-0.5 shrink-0" />
            <span>{idea.invalidation}</span>
          </div>
        </Tooltip>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onOpenTrade(idea)}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
              isBuy
                ? 'bg-emerald-600/80 hover:bg-emerald-600 text-white'
                : 'bg-red-600/80   hover:bg-red-600   text-white'
            }`}
          >
            Open {idea.direction}
          </button>
          <button
            onClick={() => onNavigate(idea.symbol, idea.asset_type)}
            className="px-3 py-2 rounded-xl bg-dark-700 hover:bg-dark-600 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onGenerate, generating }) {
  return (
    <div className="card text-center py-16 max-w-md mx-auto">
      <BarChart2 size={40} className="mx-auto text-slate-600 mb-4" />
      <p className="text-slate-300 font-medium text-lg">No trade ideas yet</p>
      <p className="text-slate-500 text-sm mt-2">
        Ideas are generated daily at 06:30 AM after the conviction scan.<br />
        Click below to generate them now.
      </p>
      <button
        onClick={onGenerate}
        disabled={generating}
        className="mt-6 btn-primary flex items-center gap-2 mx-auto"
      >
        <RefreshCw size={14} className={generating ? 'animate-spin' : ''} />
        {generating ? 'Generating…' : 'Generate Now'}
      </button>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TradeIdeas() {
  const [scanning, setScanning]     = useState(false)
  const [scanTimer, setScanTimer]   = useState(null)

  const { data: ideas = [], isLoading, refetch: refetchIdeas } = useTradeIdeas(scanning)
  const generateMutation  = useGenerateTradeIdeas()
  const { data: scanStatus } = useScanStatus(scanning)
  const openTradeMutation = useOpenTrade()
  const [modal, setModal]           = useState(null)
  const [openingSymbol, setOpening] = useState(null)
  const setSymbol = useMarketStore(s => s.setSymbol)
  const navigate  = useNavigate()

  // Smart Money cross-reference for double-confirmed badge
  const { data: smData = [] } = useSmartMoney('', false)
  const smartMap = useMemo(() =>
    Object.fromEntries(smData.map(d => [d.symbol, d.signal])),
    [smData]
  )

  // When scan status reports done, stop polling and refresh ideas
  const prevScanningRef = useState(null)
  useEffect(() => {
    if (scanning && scanStatus && !scanStatus.scanning) {
      setScanning(false)
      if (scanTimer) { clearTimeout(scanTimer); setScanTimer(null) }
      refetchIdeas()
      toast.success('Scan complete — trade ideas updated', { id: 'gen' })
    }
  }, [scanStatus, scanning])

  const handleOpenTrade = (idea) => setModal(idea)

  const confirmTrade = (idea, { ep, qty }) => {
    setOpening(idea.symbol)
    openTradeMutation.mutate(
      {
        symbol:      idea.symbol,
        asset_type:  idea.asset_type,
        direction:   idea.direction,
        entry_price: ep,
        take_profit: idea.target1,
        stop_loss:   idea.stop_loss,
        quantity:    qty,
        signal:      `TRADE IDEA — ${idea.conviction_label}`,
        top_reason:  idea.thesis,
      },
      {
        onSuccess: () => {
          toast.success(`Trade opened: ${idea.direction} ${idea.symbol} @ $${ep} × ${qty}`)
          setOpening(null)
          setModal(null)
        },
        onError: () => {
          toast.error(`Failed to open trade for ${idea.symbol}`)
          setOpening(null)
        },
      }
    )
  }

  const handleNavigate = (symbol, assetType) => {
    setSymbol(symbol, assetType)
    navigate('/market')
  }

  const handleGenerate = () => {
    if (scanning) return
    toast.loading('Scanning markets… ~30–60s', { id: 'gen', duration: 120000 })
    generateMutation.mutate(undefined, {
      onSuccess: (d) => {
        if (d.status === 'already_scanning') {
          toast('Scan already running — results coming shortly', { id: 'gen', icon: '⏳' })
          setScanning(true)
          return
        }
        // Scan started — begin polling
        setScanning(true)
        // Safety timeout: give up after 2 minutes
        const t = setTimeout(() => {
          setScanning(false)
          toast.error('Scan timed out — try again', { id: 'gen' })
        }, 120000)
        setScanTimer(t)
      },
      onError: () => {
        toast.error('Failed to start scan — check backend', { id: 'gen' })
        setScanning(false)
      },
    })
  }

  const generatedAt = ideas[0]?.generated_at
    ? new Date(ideas[0].generated_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
    : null

  const buys  = ideas.filter(i => i.direction === 'BUY').length
  const sells = ideas.filter(i => i.direction === 'SELL').length

  return (
    <div className="p-6 space-y-6 max-w-7xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Target size={22} className="text-brand-400" />
            Trade Ideas
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Top actionable setups — conviction-ranked with full entry, stop, and targets.
            {generatedAt && <span className="ml-2 text-slate-600">Generated {generatedAt}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {ideas.length > 0 && (
            <div className="flex gap-2 text-sm">
              <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full">{buys} BUY</span>
              <span className="px-3 py-1 bg-red-500/10 text-red-400 rounded-full">{sells} SELL</span>
            </div>
          )}
          <button
            onClick={handleGenerate}
            disabled={scanning || generateMutation.isPending}
            className="btn-ghost flex items-center gap-1.5 text-sm"
          >
            <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning…' : 'Fresh Scan'}
          </button>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="flex items-start gap-2 text-xs text-slate-600 bg-dark-800 border border-dark-700 rounded-xl px-4 py-3">
        <AlertTriangle size={13} className="text-yellow-600 mt-0.5 shrink-0" />
        <span>
          Trade ideas are generated by algorithmic signals and ML models. They are not financial advice.
          Always apply your own judgement, respect your risk limits, and never risk more than you can afford to lose.
        </span>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-96 animate-pulse bg-dark-700" />
          ))}
        </div>
      ) : ideas.length === 0 ? (
        <EmptyState onGenerate={handleGenerate} generating={scanning} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {ideas.map(idea => (
            <TradeIdeaCard
              key={idea.id}
              idea={idea}
              onOpenTrade={handleOpenTrade}
              onNavigate={handleNavigate}
              smartSignal={smartMap[idea.symbol] ?? null}
            />
          ))}
        </div>
      )}

      {/* Open Trade Modal */}
      {modal && (
        <OpenIdeaModal
          idea={modal}
          onClose={() => setModal(null)}
          onConfirm={(vals) => confirmTrade(modal, vals)}
          opening={openingSymbol === modal.symbol}
        />
      )}
    </div>
  )
}
