import { useState } from 'react'
import {
  TrendingUp, TrendingDown, RefreshCw, HelpCircle,
  DollarSign, Target, ShieldAlert, Clock, BarChart2,
  Zap, ChevronDown, ChevronRight, BookOpen, AlertCircle,
  PlusCircle, TrendingUp as ArrowUp, Layers, Activity,
  Info, CheckCircle, XCircle,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  useOptionsScan, useCoveredCalls, useCashSecuredPuts, useIVEnvironment,
  useStockPlaybook,
} from '../api/income'
import { useOpenOptionTrade } from '../api/optionTrades'
import { useMarketStore } from '../store/marketStore'
import toast from 'react-hot-toast'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt$ = v => v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtPct = (v, d = 1) => v == null ? '—' : `${Number(v).toFixed(d)}%`
const fmtK = v => v == null ? '—' : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : fmt$(v)

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tooltip({ text, children, wide = false }) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const width = wide ? 280 : 200
  return (
    <span className="inline-flex items-center"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onMouseMove={e => setPos({ x: e.clientX, y: e.clientY })}
    >
      {children}
      {visible && (
        <span className="fixed z-[9999] pointer-events-none bg-dark-900 border border-dark-600 text-slate-300 text-xs rounded-lg px-2.5 py-2 leading-snug shadow-xl whitespace-normal"
          style={{ width, left: pos.x - width / 2, top: pos.y - 12, transform: 'translateY(-100%)' }}>
          {text}
        </span>
      )}
    </span>
  )
}

// ── Section Banner ────────────────────────────────────────────────────────────

function SectionBanner({ icon: Icon, title, subtitle, color = 'emerald', children }) {
  const [open, setOpen] = useState(false)
  const border = color === 'emerald' ? 'border-emerald-500' : color === 'blue' ? 'border-blue-500' : 'border-purple-500'
  const iconColor = color === 'emerald' ? 'text-emerald-400' : color === 'blue' ? 'text-blue-400' : 'text-purple-400'
  const bg = color === 'emerald' ? 'bg-emerald-500/5' : color === 'blue' ? 'bg-blue-500/5' : 'bg-purple-500/5'

  return (
    <div className={`border-l-4 ${border} ${bg} rounded-r-xl px-5 py-4`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Icon size={18} className={iconColor} />
          <div>
            <h2 className="text-base font-bold text-slate-100">{title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          </div>
        </div>
        {children && (
          <button onClick={() => setOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors shrink-0 mt-0.5">
            <BookOpen size={12} />
            {open ? 'Hide guide' : 'How it works'}
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
      </div>
      {open && children && (
        <div className="mt-4 pt-4 border-t border-dark-700 text-xs text-slate-400 space-y-2">
          {children}
        </div>
      )}
    </div>
  )
}

// ── IV Pulse Bar ──────────────────────────────────────────────────────────────

function IVChip({ item }) {
  const isSell = item.recommendation === 'SELL_PREMIUM'
  const isBuy = item.recommendation === 'BUY_OPTIONS'
  const border = isSell ? 'border-emerald-500/40' : isBuy ? 'border-blue-500/40' : 'border-dark-600'
  const bg = isSell ? 'bg-emerald-500/5' : isBuy ? 'bg-blue-500/5' : 'bg-dark-800'
  const rankColor = item.iv_rank >= 50 ? 'bg-emerald-500' : item.iv_rank <= 30 ? 'bg-blue-500' : 'bg-slate-500'
  const badgeStyle = isSell
    ? 'bg-emerald-500/20 text-emerald-300'
    : isBuy
    ? 'bg-blue-500/20 text-blue-300'
    : 'bg-dark-700 text-slate-400'
  const badgeText = isSell ? '↓ SELL' : isBuy ? '↑ BUY' : 'NEUTRAL'

  return (
    <Tooltip text={item.rec_reason} wide>
      <div className={`rounded-xl border ${border} ${bg} p-3 min-w-[110px] cursor-default`}>
        <div className="font-bold text-slate-100 text-sm">{item.symbol}</div>
        <div className="text-xs text-slate-500 mt-0.5">IV {fmtPct(item.current_iv_pct)}</div>
        <div className="mt-2 space-y-1">
          <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
            <div className={`h-full ${rankColor} rounded-full transition-all`}
              style={{ width: `${Math.min(100, item.iv_rank)}%` }} />
          </div>
          <div className="text-xs text-slate-600">Rank {item.iv_rank.toFixed(0)}%</div>
        </div>
        <div className={`mt-2 text-xs px-1.5 py-0.5 rounded font-semibold inline-block ${badgeStyle}`}>
          {badgeText}
        </div>
      </div>
    </Tooltip>
  )
}

function IVPulseBar({ data, isLoading }) {
  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-1">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="min-w-[110px] h-[96px] rounded-xl bg-dark-800 border border-dark-700 animate-pulse" />
        ))}
      </div>
    )
  }
  if (!data || data.length === 0) return null

  const sellCount = data.filter(d => d.recommendation === 'SELL_PREMIUM').length
  const buyCount = data.filter(d => d.recommendation === 'BUY_OPTIONS').length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Activity size={13} />
          <span>Volatility Environment — <span className="text-slate-300">{data.length} symbols</span></span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {sellCount > 0 && (
            <span className="text-emerald-400 font-medium">{sellCount} sell premium</span>
          )}
          {buyCount > 0 && (
            <span className="text-blue-400 font-medium">{buyCount} buy options</span>
          )}
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
        {data.map(item => <IVChip key={item.symbol} item={item} />)}
      </div>
    </div>
  )
}

// ── Sell Modal (CC + CSP) ─────────────────────────────────────────────────────

function SellModal({ opp, strategy, onClose }) {
  const isCC = strategy === 'CC'
  const maxContracts = isCC ? opp.contracts_available : 50
  const [qty, setQty] = useState(isCC ? opp.contracts_available : 1)
  const openTrade = useOpenOptionTrade()

  const totalPremium = opp.premium_per_contract * qty
  const capitalRequired = isCC ? null : opp.capital_required * qty

  const handleSell = () => {
    openTrade.mutate({
      symbol: opp.symbol,
      option_type: isCC ? 'SHORT_CALL' : 'SHORT_PUT',
      trade_side: 'SHORT',
      strike: opp.strike,
      expiration: opp.expiration,
      conviction: isCC ? 'COVERED_CALL' : (opp.conviction ?? 'CSP'),
      ask_at_entry: opp.bid,
      cost_per_contract: opp.premium_per_contract,
      quantity: qty,
      stock_price_at_entry: opp.stock_price,
      profit_target: parseFloat((opp.bid * 0.5).toFixed(4)),
      stop_loss_opt: parseFloat((opp.bid * 2.0).toFixed(4)),
      time_stop_date: opp.expiration,
      breakeven_price: isCC
        ? parseFloat((opp.strike + opp.bid).toFixed(4))
        : opp.effective_buy_price,
      delta: opp.delta,
      theta_per_day: opp.theta_per_day,
      iv_pct: opp.iv_pct,
    }, {
      onSuccess: () => {
        toast.success(`Logged: Sell ${qty}× ${opp.symbol} $${opp.strike} ${isCC ? 'Call' : 'Put'}`)
        onClose()
      },
      onError: e => toast.error(e.message ?? 'Failed to log trade'),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-800 border border-dark-600 rounded-xl shadow-2xl w-full max-w-sm mx-4">
        <div className="px-5 py-4 border-b border-dark-700 flex items-center justify-between">
          <h3 className="font-semibold text-slate-100 text-sm">
            Log {isCC ? 'Covered Call' : 'Cash-Secured Put'}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="rounded-lg p-3 bg-emerald-500/10 border border-emerald-500/20 text-sm">
            <p className="font-bold text-emerald-400">
              {opp.symbol} ${opp.strike} {isCC ? 'Call' : 'Put'} — exp {opp.expiration}
            </p>
            <p className="text-slate-400 text-xs mt-1">
              Collect {fmt$(opp.bid)}/share · {fmtPct(opp.annualized_yield_pct)} annualized
            </p>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Number of contracts</label>
            <input
              type="number" min="1" max={maxContracts} value={qty}
              onChange={e => setQty(Math.max(1, Math.min(maxContracts, parseInt(e.target.value) || 1)))}
              className="input w-full"
            />
            <p className="text-xs text-slate-500 mt-1">
              Premium collected: <span className="text-emerald-400 font-semibold">{fmt$(totalPremium)}</span>
              {capitalRequired && (
                <> · Capital locked: <span className="text-slate-300">{fmtK(capitalRequired)}</span></>
              )}
            </p>
          </div>

          <div className="text-xs text-slate-500 space-y-1 bg-dark-700/50 rounded-lg p-3">
            <p className="text-slate-400 font-medium mb-1">Exit rules</p>
            <p>• Take profit: buy back at {fmt$(opp.bid * 0.5)}/share (−50% of premium = keep half)</p>
            <p>• Stop loss: buy back at {fmt$(opp.bid * 2.0)}/share (option doubles in price)</p>
            <p>• Time exit: close before expiry to avoid assignment</p>
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-dark-600 text-slate-400 text-sm hover:bg-dark-700 transition-colors">
              Cancel
            </button>
            <button onClick={handleSell} disabled={openTrade.isPending}
              className="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors disabled:opacity-50">
              {openTrade.isPending ? 'Logging…' : 'Log Trade'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── CC Card ───────────────────────────────────────────────────────────────────

function CCCard({ opp }) {
  const [sellModal, setSellModal] = useState(false)
  const profitOnCall = opp.max_profit_if_called > 0

  return (
    <div className="bg-dark-900/60 border border-emerald-500/20 rounded-xl p-4 space-y-3 hover:border-emerald-500/40 transition-colors">
      {sellModal && <SellModal opp={opp} strategy="CC" onClose={() => setSellModal(false)} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 font-semibold text-sm">Sell ${opp.strike} Call</span>
            <span className="text-slate-500 text-xs">· exp {opp.expiration} · {opp.dte}d</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {opp.upside_to_strike_pct.toFixed(1)}% above current · delta {opp.delta.toFixed(2)} (assignment risk)
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-emerald-400 leading-tight">
            {fmtPct(opp.annualized_yield_pct)}
          </div>
          <div className="text-xs text-slate-500">annualized</div>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-dark-800 rounded-lg p-2.5">
          <Tooltip text="Premium you collect per contract (bid × 100). This is yours to keep regardless of outcome.">
            <div className="text-xs text-slate-500 mb-1 cursor-default">Premium/Contract</div>
          </Tooltip>
          <div className="text-sm font-bold text-slate-100">{fmt$(opp.premium_per_contract)}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-2.5">
          <Tooltip text={`Total premium for all ${opp.contracts_available} available contracts. Collected upfront.`}>
            <div className="text-xs text-slate-500 mb-1 cursor-default">Total ({opp.contracts_available} ctrs)</div>
          </Tooltip>
          <div className="text-sm font-bold text-emerald-400">{fmt$(opp.total_premium)}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-2.5">
          <Tooltip text="After collecting premium, your effective cost per share is lower. This is your new break-even.">
            <div className="text-xs text-slate-500 mb-1 cursor-default">New Cost Basis</div>
          </Tooltip>
          <div className="text-sm font-bold text-slate-100">{fmt$(opp.new_cost_basis)}</div>
        </div>
      </div>

      {/* Plain English */}
      <div className="bg-dark-800/50 rounded-lg p-3 text-xs text-slate-400 space-y-1">
        <p>
          You sell 1 call at ${opp.strike} and <span className="text-emerald-400 font-medium">immediately collect {fmt$(opp.premium_per_contract)}</span>.
          This premium is yours no matter what.
        </p>
        <p>
          {profitOnCall
            ? <>If stock gets called away at ${opp.strike}: total profit = <span className="text-emerald-400 font-medium">{fmt$(opp.max_profit_if_called)}</span> (gains + premium).</>
            : <>If stock gets called away at ${opp.strike}: you sell at a loss vs avg cost, but premium partially offsets it.</>
          }
        </p>
        <p>IV: {fmtPct(opp.iv_pct)} · θ: {fmt$(opp.theta_per_day)}/day (decay works in your favor)</p>
      </div>

      <button onClick={() => setSellModal(true)}
        className="w-full py-2 rounded-lg border border-emerald-500/40 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/15 flex items-center justify-center gap-2 transition-colors">
        <DollarSign size={12} />
        Sell {opp.contracts_available} Contract{opp.contracts_available !== 1 ? 's' : ''} — Collect {fmt$(opp.total_premium)}
      </button>
    </div>
  )
}

function CCHoldingSection({ result }) {
  const [expanded, setExpanded] = useState(true)
  const navigate = useNavigate()
  const setSymbol = useMarketStore(s => s.setSymbol)
  const unrealizedPct = ((result.current_price - result.avg_cost) / result.avg_cost * 100)

  return (
    <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-hidden">
      <button className="w-full px-5 py-4 flex items-center justify-between hover:bg-dark-700/30 transition-colors"
        onClick={() => setExpanded(v => !v)}>
        <div className="flex items-center gap-3">
          <Layers size={15} className="text-emerald-400" />
          <span
            className="text-base font-bold text-slate-100 hover:text-brand-400 hover:underline cursor-pointer transition-colors"
            onClick={e => { e.stopPropagation(); setSymbol(result.symbol, 'stock'); navigate('/market') }}>
            {result.symbol}
          </span>
          <span className="text-xs text-slate-500">
            {result.shares_owned} shares · avg {fmt$(result.avg_cost)}
          </span>
          <span className={`text-xs font-medium ${unrealizedPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {unrealizedPct >= 0 ? '+' : ''}{unrealizedPct.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center gap-2 text-slate-500 text-xs">
          <span>{result.opportunities.length} opportunity{result.opportunities.length !== 1 ? 'ies' : 'y'}</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-1 space-y-3 border-t border-dark-700">
          {result.opportunities.length === 0 ? (
            <p className="text-slate-500 text-sm py-3 text-center">
              No liquid options in the 21–45 DTE window right now. Check back later.
            </p>
          ) : (
            result.opportunities.map(opp => (
              <CCCard key={`${opp.expiration}-${opp.strike}`} opp={opp} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── CSP Card ──────────────────────────────────────────────────────────────────

function CSPCard({ opp }) {
  const [sellModal, setSellModal] = useState(false)

  return (
    <div className="bg-dark-900/60 border border-blue-500/20 rounded-xl p-4 space-y-3 hover:border-blue-500/40 transition-colors">
      {sellModal && <SellModal opp={opp} strategy="CSP" onClose={() => setSellModal(false)} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-blue-400 font-semibold text-sm">Sell ${opp.strike} Put</span>
            <span className="text-slate-500 text-xs">· exp {opp.expiration} · {opp.dte}d</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {((opp.stock_price - opp.strike) / opp.stock_price * 100).toFixed(1)}% below current ·
            {opp.assignment_prob_pct.toFixed(0)}% assignment probability
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-blue-400 leading-tight">
            {fmtPct(opp.annualized_yield_pct)}
          </div>
          <div className="text-xs text-slate-500">annualized</div>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-dark-800 rounded-lg p-2.5">
          <Tooltip text="Premium collected per contract upfront. This is yours to keep if the stock stays above your strike.">
            <div className="text-xs text-slate-500 mb-1 cursor-default">Premium Collected</div>
          </Tooltip>
          <div className="text-sm font-bold text-blue-400">{fmt$(opp.premium_per_contract)}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-2.5">
          <Tooltip text={`Cash you need as collateral = strike × 100. If assigned, this buys you 100 shares at the strike price.`} wide>
            <div className="text-xs text-slate-500 mb-1 cursor-default">Capital Required</div>
          </Tooltip>
          <div className="text-sm font-bold text-slate-100">{fmtK(opp.capital_required)}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-2.5">
          <Tooltip text={`If assigned, you buy 100 shares at ${fmt$(opp.strike)} but net only ${fmt$(opp.effective_buy_price)} per share after keeping the premium. That's ${opp.discount_pct.toFixed(1)}% below current price.`} wide>
            <div className="text-xs text-slate-500 mb-1 cursor-default">Effective Buy Price</div>
          </Tooltip>
          <div className="text-sm font-bold text-slate-100">{fmt$(opp.effective_buy_price)}</div>
          <div className="text-xs text-blue-400">{fmtPct(opp.discount_pct)} discount</div>
        </div>
      </div>

      {/* Plain English */}
      <div className="bg-dark-800/50 rounded-lg p-3 text-xs text-slate-400 space-y-1">
        <p>
          You sell a put at ${opp.strike} and <span className="text-blue-400 font-medium">collect {fmt$(opp.premium_per_contract)} now</span>.
          Keep your {fmtK(opp.capital_required)} in cash as collateral.
        </p>
        <p>
          <span className="text-emerald-400">Best case:</span> stock stays above ${opp.strike} → you keep {fmt$(opp.premium_per_contract)} and your cash back. Repeat next month.
        </p>
        <p>
          <span className="text-yellow-400">Assigned:</span> you buy 100 shares at ${opp.strike} — but your real cost is only {fmt$(opp.effective_buy_price)} after the premium. That's {fmtPct(opp.discount_pct)} below today's price.
        </p>
      </div>

      <button onClick={() => setSellModal(true)}
        className="w-full py-2 rounded-lg border border-blue-500/40 text-blue-300 text-xs font-semibold hover:bg-blue-500/15 flex items-center justify-center gap-2 transition-colors">
        <DollarSign size={12} />
        Sell Put — Collect {fmt$(opp.premium_per_contract)} · Need {fmtK(opp.capital_required)}
      </button>
    </div>
  )
}

function CSPSymbolSection({ result }) {
  const [expanded, setExpanded] = useState(true)
  const navigate = useNavigate()
  const setSymbol = useMarketStore(s => s.setSymbol)

  return (
    <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-hidden">
      <button className="w-full px-5 py-4 flex items-center justify-between hover:bg-dark-700/30 transition-colors"
        onClick={() => setExpanded(v => !v)}>
        <div className="flex items-center gap-3">
          <TrendingUp size={15} className="text-blue-400" />
          <span
            className="text-base font-bold text-slate-100 hover:text-brand-400 hover:underline cursor-pointer transition-colors"
            onClick={e => { e.stopPropagation(); setSymbol(result.symbol, 'stock'); navigate('/market') }}>
            {result.symbol}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
            result.conviction === 'HIGH_CONVICTION'
              ? 'bg-brand-500/20 border-brand-500/40 text-brand-300'
              : 'bg-slate-500/20 border-slate-600 text-slate-400'
          }`}>
            {result.conviction.replace('_', ' ')}
          </span>
          <span className="text-xs text-slate-500">{fmt$(result.current_price)}</span>
        </div>
        <div className="flex items-center gap-2 text-slate-500 text-xs">
          <span>{result.opportunities.length} opportunity{result.opportunities.length !== 1 ? 'ies' : 'y'}</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-1 space-y-3 border-t border-dark-700">
          {result.opportunities.length === 0 ? (
            <p className="text-slate-500 text-sm py-3 text-center">
              No liquid CSP options in the 21–45 DTE window right now.
            </p>
          ) : (
            result.opportunities.map(opp => (
              <CSPCard key={`${opp.expiration}-${opp.strike}`} opp={opp} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Stock Analyzer ────────────────────────────────────────────────────────────

const DIRECTION_COLOR = {
  BUY:     { text: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  SELL:    { text: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30'         },
  NEUTRAL: { text: 'text-slate-400',   bg: 'bg-dark-700 border-dark-600'             },
}

const STRATEGY_ICON = {
  BUY_CALL:  '📈', BUY_PUT: '📉', SELL_CSP: '💰', SELL_CC: '🏦', WAIT: '⏳',
}

function PlaybookTradeCard({ rec, idx }) {
  const isPrimary = rec.priority === 1
  const isSell = rec.strategy === 'SELL_CSP' || rec.strategy === 'SELL_CC'
  const accent = isSell ? 'border-emerald-500/30 bg-emerald-500/5'
    : rec.strategy === 'BUY_CALL' ? 'border-blue-500/30 bg-blue-500/5'
    : rec.strategy === 'BUY_PUT' ? 'border-red-500/30 bg-red-500/5'
    : 'border-dark-600 bg-dark-800'
  const yieldColor = isSell ? 'text-emerald-400' : rec.strategy.startsWith('BUY') ? 'text-blue-400' : 'text-slate-400'

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${accent} ${isPrimary ? 'ring-1 ring-brand-500/30' : 'opacity-90'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-base">{STRATEGY_ICON[rec.strategy] ?? '📊'}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-100">{rec.label}</span>
              {isPrimary && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-brand-500/20 border border-brand-500/30 text-brand-300 font-medium">
                  #1 Recommended
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5 leading-snug max-w-sm">{rec.reason}</p>
          </div>
        </div>
        {rec.annualized_yield_pct && (
          <div className="text-right shrink-0">
            <div className={`text-xl font-bold ${yieldColor}`}>{fmtPct(rec.annualized_yield_pct)}</div>
            <div className="text-xs text-slate-500">annualized</div>
          </div>
        )}
        {rec.cost && (
          <div className="text-right shrink-0">
            <div className="text-xl font-bold text-blue-400">{fmt$(rec.cost)}</div>
            <div className="text-xs text-slate-500">risk/contract</div>
          </div>
        )}
      </div>

      {rec.strategy !== 'WAIT' && (rec.strike || rec.premium || rec.capital_required) && (
        <div className="grid grid-cols-3 gap-2">
          {rec.strike && (
            <div className="bg-dark-800 rounded-lg p-2.5">
              <div className="text-xs text-slate-500 mb-1">Strike</div>
              <div className="text-sm font-bold text-slate-100">${rec.strike}</div>
              {rec.expiration && <div className="text-xs text-slate-600">{rec.expiration} · {rec.dte}d</div>}
            </div>
          )}
          {rec.premium && (
            <div className="bg-dark-800 rounded-lg p-2.5">
              <div className="text-xs text-slate-500 mb-1">Premium</div>
              <div className="text-sm font-bold text-emerald-400">{fmt$(rec.premium)}</div>
              <div className="text-xs text-slate-600">per contract</div>
            </div>
          )}
          {rec.capital_required && (
            <div className="bg-dark-800 rounded-lg p-2.5">
              <div className="text-xs text-slate-500 mb-1">Capital Needed</div>
              <div className="text-sm font-bold text-slate-100">{fmtK(rec.capital_required)}</div>
            </div>
          )}
          {rec.breakeven && (
            <div className="bg-dark-800 rounded-lg p-2.5">
              <div className="text-xs text-slate-500 mb-1">Break-even</div>
              <div className="text-sm font-bold text-slate-100">{fmt$(rec.breakeven)}</div>
            </div>
          )}
        </div>
      )}

      {rec.earnings_warning && (
        <div className="flex items-start gap-2 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          {rec.earnings_warning}
        </div>
      )}
    </div>
  )
}

function SignalRow({ sig }) {
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-dark-700 last:border-0">
      <div className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${sig.passed ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
        {sig.passed
          ? <CheckCircle size={10} className="text-emerald-400" />
          : <XCircle size={10} className="text-red-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-slate-300">{sig.name}</span>
        <span className="text-xs text-slate-500 ml-2 truncate">{sig.detail}</span>
      </div>
    </div>
  )
}

function StockAnalyzer() {
  const [input, setInput] = useState('')
  const [queried, setQueried] = useState('')
  const { data, isFetching, error, refetch } = useStockPlaybook(queried)
  const [sigExpanded, setSigExpanded] = useState(false)

  const handleAnalyze = () => {
    const sym = input.trim().toUpperCase()
    if (!sym) return
    setQueried(sym)
    setTimeout(() => refetch(), 0)
  }

  const pb = data
  const dirStyle = pb ? DIRECTION_COLOR[pb.direction] ?? DIRECTION_COLOR.NEUTRAL : null
  const critical = pb?.watch_conditions.filter(w => w.importance === 'CRITICAL') ?? []
  const helpful  = pb?.watch_conditions.filter(w => w.importance === 'HELPFUL') ?? []

  return (
    <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-dark-700">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={15} className="text-brand-400" />
          <h2 className="text-sm font-bold text-slate-100">Stock Analyzer</h2>
          <span className="text-xs text-slate-500">— type any symbol and get a complete trade playbook</span>
        </div>
        <div className="flex gap-2 mt-3">
          <input
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
            placeholder="AAPL, NVDA, TSLA…"
            className="input flex-1 font-mono uppercase placeholder:normal-case placeholder:font-sans"
          />
          <button
            onClick={handleAnalyze}
            disabled={isFetching || !input.trim()}
            className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors flex items-center gap-2 shrink-0"
          >
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
            {isFetching ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>
      </div>

      {/* Loading */}
      {isFetching && (
        <div className="px-5 py-10 text-center text-slate-500 space-y-2">
          <RefreshCw size={22} className="animate-spin mx-auto text-brand-400" />
          <p className="text-sm">Running live analysis — fetching signals, IV, options data…</p>
          <p className="text-xs text-slate-600">Takes ~5-10 seconds</p>
        </div>
      )}

      {/* Error */}
      {error && !isFetching && (
        <div className="px-5 py-8 text-center">
          <p className="text-red-400 font-medium">{error.message}</p>
          <p className="text-slate-500 text-sm mt-1">Check the symbol and try again.</p>
        </div>
      )}

      {/* Playbook */}
      {pb && !isFetching && (
        <div className="divide-y divide-dark-700">

          {/* Snapshot */}
          <div className="px-5 py-4">
            <div className={`rounded-xl border p-4 ${dirStyle.bg}`}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-slate-100">{pb.symbol}</span>
                    {pb.stock_price > 0 && (
                      <span className="text-lg font-mono text-slate-300">{fmt$(pb.stock_price)}</span>
                    )}
                    <span className={`text-sm font-bold ${dirStyle.text}`}>
                      {pb.direction === 'BUY' ? '↑' : pb.direction === 'SELL' ? '↓' : '→'} {pb.label.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                    <span>Signals: <span className="text-slate-300 font-medium">{pb.score}/{pb.max_score}</span></span>
                    <span>Confidence: <span className="text-slate-300 font-medium">{fmtPct(pb.confidence_pct)}</span></span>
                    {pb.iv_rank != null && (
                      <span>IV Rank: <span className={`font-medium ${pb.iv_rank >= 50 ? 'text-emerald-400' : pb.iv_rank <= 30 ? 'text-blue-400' : 'text-slate-300'}`}>
                        {pb.iv_rank.toFixed(0)}%
                        {pb.iv_rank >= 50 ? ' (sell premium ↓)' : pb.iv_rank <= 30 ? ' (buy options ↑)' : ''}
                      </span></span>
                    )}
                    {pb.next_earnings_date && (
                      <span className={pb.days_to_earnings <= 14 ? 'text-yellow-400 font-medium' : ''}>
                        Earnings: {pb.next_earnings_date} ({pb.days_to_earnings}d)
                      </span>
                    )}
                  </div>
                </div>

                {/* Signal progress bar */}
                <div className="text-right min-w-[120px]">
                  <div className="text-xs text-slate-500 mb-1">Signal strength</div>
                  <div className="h-2 bg-dark-700 rounded-full w-32">
                    <div
                      className={`h-full rounded-full transition-all ${
                        pb.direction === 'BUY' ? 'bg-emerald-500' : pb.direction === 'SELL' ? 'bg-red-500' : 'bg-slate-500'
                      }`}
                      style={{ width: `${pb.max_score > 0 ? (pb.score / pb.max_score) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">{pb.score}/{pb.max_score} passing</div>
                </div>
              </div>

              {/* Risk flags */}
              {pb.risk_flags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {pb.risk_flags.map((f, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/30 text-red-300">
                      ⚠ {f}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Trade Recommendations */}
          <div className="px-5 py-4 space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recommended Trades</h3>
            {pb.recommendations.map((rec, i) => (
              <PlaybookTradeCard key={i} rec={rec} idx={i} />
            ))}
          </div>

          {/* What to Watch For */}
          {(critical.length > 0 || helpful.length > 0) && (
            <div className="px-5 py-4 space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">What to Watch For</h3>
              {critical.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-red-400 font-medium flex items-center gap-1"><AlertCircle size={11} /> Critical conditions not yet met</p>
                  {critical.map((w, i) => (
                    <div key={i} className="bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2.5 text-xs space-y-1">
                      <p className="text-slate-300 leading-snug">{w.condition}</p>
                      <p className="text-slate-500">Now: {w.current_state}</p>
                    </div>
                  ))}
                </div>
              )}
              {helpful.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500 font-medium flex items-center gap-1"><Info size={11} /> Helpful signals to watch</p>
                  {helpful.map((w, i) => (
                    <div key={i} className="bg-dark-700/50 border border-dark-600 rounded-lg px-3 py-2.5 text-xs space-y-1">
                      <p className="text-slate-400 leading-snug">{w.condition}</p>
                      <p className="text-slate-600">Now: {w.current_state}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Signal Breakdown (collapsible) */}
          <div className="px-5 py-3">
            <button onClick={() => setSigExpanded(v => !v)}
              className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors w-full">
              {sigExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span className="font-medium">Signal breakdown ({pb.score}/{pb.max_score} passing)</span>
            </button>
            {sigExpanded && (
              <div className="mt-3 space-y-0">
                {pb.signals.map((sig, i) => <SignalRow key={i} sig={sig} />)}
              </div>
            )}
          </div>

        </div>
      )}

      {/* Empty state */}
      {!pb && !isFetching && !error && (
        <div className="px-5 py-10 text-center text-slate-600 space-y-2">
          <Activity size={28} className="mx-auto mb-2" />
          <p className="text-slate-400 text-sm font-medium">Enter a stock symbol above</p>
          <p className="text-xs">Get direction, signals, ranked trade recommendations, and what to watch for</p>
        </div>
      )}
    </div>
  )
}

// ── Buy Options ───────────────────────────────────────────────────────────────

const _TIME_STOP_DTE = 14

function AddToTradesModal({ opp, onClose }) {
  const [qty, setQty] = useState(1)
  const openTrade = useOpenOptionTrade()
  const totalCost = opp.cost_per_contract * qty

  const handleAdd = () => {
    openTrade.mutate({
      symbol: opp.symbol,
      option_type: opp.option_type,
      strike: opp.strike,
      expiration: opp.expiration,
      conviction: opp.conviction,
      ask_at_entry: opp.ask,
      cost_per_contract: opp.cost_per_contract,
      quantity: qty,
      stock_price_at_entry: opp.stock_price,
      profit_target: opp.profit_target_option,
      stop_loss_opt: opp.stop_loss_option,
      time_stop_date: opp.time_stop_date,
      breakeven_price: opp.breakeven_price,
      delta: opp.delta,
      theta_per_day: opp.theta_per_day,
      iv_pct: opp.iv_pct,
    }, {
      onSuccess: () => {
        toast.success(`Added ${opp.symbol} ${opp.option_type} $${opp.strike} to option trades`)
        onClose()
      },
      onError: e => toast.error(e.message ?? 'Failed to add trade'),
    })
  }

  const isCall = opp.option_type === 'CALL'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-800 border border-dark-600 rounded-xl shadow-2xl w-full max-w-sm mx-4">
        <div className="px-5 py-4 border-b border-dark-700 flex items-center justify-between">
          <h3 className="font-semibold text-slate-100 text-sm">Add to Option Trades</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className={`rounded-lg p-3 text-sm ${isCall ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
            <p className={`font-bold ${isCall ? 'text-emerald-400' : 'text-red-400'}`}>
              {opp.symbol} {opp.option_type} ${opp.strike} — exp {opp.expiration}
            </p>
            <p className="text-slate-400 text-xs mt-1">
              Entry: ${opp.ask}/share · TP: ${opp.profit_target_option}/share · SL: ${opp.stop_loss_option}/share
            </p>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Number of contracts</label>
            <input type="number" min="1" max="100" value={qty}
              onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
              className="input w-full" />
            <p className="text-xs text-slate-500 mt-1">
              Capital at risk: <span className="text-slate-200 font-medium">${totalCost.toFixed(2)}</span>
            </p>
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-dark-600 text-slate-400 text-sm hover:bg-dark-700 transition-colors">Cancel</button>
            <button onClick={handleAdd} disabled={openTrade.isPending}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 ${isCall ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'} transition-colors`}>
              {openTrade.isPending ? 'Adding…' : `Add ${opp.option_type}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function BuyOptionCard({ opp, isTop }) {
  const [showModal, setShowModal] = useState(false)
  const isCall = opp.option_type === 'CALL'
  const accentBg   = isCall ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'
  const accentText = isCall ? 'text-emerald-400' : 'text-red-400'
  const TypeIcon   = isCall ? TrendingUp : TrendingDown

  return (
    <div className={`rounded-xl border p-4 space-y-4 ${accentBg} ${isTop ? 'ring-1 ring-brand-500/40' : ''}`}>
      {showModal && <AddToTradesModal opp={opp} onClose={() => setShowModal(false)} />}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <TypeIcon size={15} className={accentText} />
            <span className={`text-sm font-bold ${accentText}`}>{isCall ? 'Long Call' : 'Long Put'}</span>
            <span className="text-slate-400 text-sm font-mono">{fmt$(opp.strike)} strike</span>
            <span className="text-slate-500 text-xs">· exp {opp.expiration} ({opp.dte}d)</span>
          </div>
          <p className="text-xs text-slate-400 leading-snug">
            {isCall
              ? `Buy the right to purchase ${opp.symbol} at ${fmt$(opp.strike)}. Profit if stock rises above ${fmt$(opp.breakeven_price)}. Max loss = entry cost only.`
              : `Buy the right to sell ${opp.symbol} at ${fmt$(opp.strike)}. Profit if stock falls below ${fmt$(opp.breakeven_price)}. Max loss = entry cost only.`
            }
          </p>
        </div>
        {isTop && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-brand-500/20 border border-brand-500/30 text-brand-300 font-medium shrink-0">Best pick</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-dark-800 rounded-lg p-3">
          <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><DollarSign size={10} />
            <Tooltip text="What you pay to buy 1 contract. This is your maximum possible loss." wide>
              <span className="cursor-default">Entry Cost</span>
            </Tooltip>
          </div>
          <div className="text-base font-bold text-slate-100 font-mono">{fmt$(opp.cost_per_contract)}</div>
          <div className="text-xs text-slate-500 mt-0.5">ask {fmt$(opp.ask)}/share</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-3">
          <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Target size={10} />
            <Tooltip text="Sell the option here for a +75% gain on your entry." wide>
              <span className="cursor-default">Take Profit</span>
            </Tooltip>
          </div>
          <div className="text-base font-bold text-emerald-400 font-mono">{fmt$(opp.profit_target_option * 100)}</div>
          <div className="text-xs text-slate-500 mt-0.5">+75% · {fmt$(opp.profit_target_option)}/share</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-3">
          <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><ShieldAlert size={10} />
            <Tooltip text="If option drops to this price (−50%), sell immediately." wide>
              <span className="cursor-default">Stop Loss</span>
            </Tooltip>
          </div>
          <div className="text-base font-bold text-red-400 font-mono">{fmt$(opp.stop_loss_option * 100)}</div>
          <div className="text-xs text-slate-500 mt-0.5">−50% · {fmt$(opp.stop_loss_option)}/share</div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        {[
          ['Delta', opp.delta.toFixed(2), 'Moves $'+opp.delta.toFixed(2)+' for every $1 in stock price.'],
          ['θ/day', fmt$(opp.theta_per_day), 'Daily time decay cost. Exit before the time stop.'],
          ['IV', fmtPct(opp.iv_pct), 'Implied Volatility. Buy when IV is relatively low.'],
          ['Break-even', fmt$(opp.breakeven_price), `Stock must reach ${fmt$(opp.breakeven_price)} at expiry to break even.`],
        ].map(([label, val, tip]) => (
          <div key={label}>
            <div className="text-xs text-slate-500 mb-0.5">
              <Tooltip text={tip} wide>
                <span className="cursor-default inline-flex items-center gap-1">{label} <HelpCircle size={10} className="text-slate-600" /></span>
              </Tooltip>
            </div>
            <div className="font-mono text-slate-200 text-sm">{val}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-500 border-t border-dark-700 pt-3">
        <Clock size={11} className="text-yellow-500" />
        <span><span className="text-yellow-400 font-medium">Time stop: exit by {opp.time_stop_date}</span> — sell before theta crush accelerates below {_TIME_STOP_DTE} DTE</span>
      </div>

      <button onClick={() => setShowModal(true)}
        className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-colors border ${
          isCall ? 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15' : 'border-red-500/40 text-red-300 hover:bg-red-500/15'
        }`}>
        <PlusCircle size={13} />Add to Trades
      </button>
    </div>
  )
}

function BuyOptionStockSection({ result }) {
  const [expanded, setExpanded] = useState(true)
  const isCall = result.direction === 'BUY'
  const navigate = useNavigate()
  const setSymbol = useMarketStore(s => s.setSymbol)

  return (
    <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-hidden">
      <button className="w-full px-5 py-4 flex items-center justify-between hover:bg-dark-700/30 transition-colors"
        onClick={() => setExpanded(v => !v)}>
        <div className="flex items-center gap-3">
          {isCall ? <TrendingUp size={16} className="text-emerald-400" /> : <TrendingDown size={16} className="text-red-400" />}
          <span className="text-lg font-bold text-slate-100 hover:text-brand-400 hover:underline cursor-pointer transition-colors"
            onClick={e => { e.stopPropagation(); setSymbol(result.symbol, 'stock'); navigate('/market') }}>
            {result.symbol}
          </span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
            isCall ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-red-500/20 border-red-500/40 text-red-300'
          }`}>{isCall ? 'Long Call' : 'Long Put'}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${
            result.conviction === 'HIGH_CONVICTION' ? 'bg-brand-500/20 border-brand-500/40 text-brand-300' : 'bg-slate-500/20 border-slate-600 text-slate-400'
          }`}>{result.conviction.replace('_', ' ')}</span>
        </div>
        <div className="flex items-center gap-3 text-slate-500 text-xs">
          <span>{result.options.length} option{result.options.length !== 1 ? 's' : ''}</span>
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </div>
      </button>
      {expanded && (
        <div className="px-5 pb-5 pt-1 space-y-3 border-t border-dark-700">
          {result.options.map((opp, i) => (
            <BuyOptionCard key={`${opp.expiration}-${opp.strike}`} opp={opp} isTop={i === 0} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Summary Stat Card ─────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color = 'text-slate-100' }) {
  return (
    <div className="bg-dark-800 border border-dark-700 rounded-xl p-4">
      <div className="flex items-center gap-2 text-slate-500 text-xs mb-2"><Icon size={13} />{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, title, subtitle, color = 'text-slate-600' }) {
  return (
    <div className="text-center py-8 space-y-2">
      <Icon size={28} className={`mx-auto mb-2 ${color}`} />
      <p className="text-slate-400 font-medium">{title}</p>
      {subtitle && <p className="text-slate-500 text-sm max-w-sm mx-auto">{subtitle}</p>}
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingRows({ n = 2 }) {
  return (
    <div className="space-y-3">
      {[...Array(n)].map((_, i) => (
        <div key={i} className="h-20 rounded-xl bg-dark-800 border border-dark-700 animate-pulse" />
      ))}
    </div>
  )
}

// ── DTE + filter presets ──────────────────────────────────────────────────────

const DTE_PRESETS = [
  { label: '25–45d', minDte: 25, maxDte: 45 },
  { label: '30–60d', minDte: 30, maxDte: 60 },
  { label: '45–90d', minDte: 45, maxDte: 90 },
]
const INVEST_LEVELS = [
  { value: 'all',      label: 'All',      desc: null },
  { value: 'low',      label: 'Low',      desc: 'Under $200',  min: 0,   max: 200      },
  { value: 'moderate', label: 'Moderate', desc: '$200–$500',   min: 200, max: 500      },
  { value: 'high',     label: 'High',     desc: 'Above $500',  min: 500, max: Infinity },
]

function applyInvestFilter(data, level) {
  if (!data || level === 'all') return data
  const { min, max } = INVEST_LEVELS.find(l => l.value === level)
  return data
    .map(r => ({ ...r, options: r.options.filter(o => o.cost_per_contract >= min && o.cost_per_contract < max) }))
    .filter(r => r.options.length > 0)
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Income() {
  const [dteIdx, setDteIdx] = useState(0)
  const [convFilter, setConvFilter] = useState('all')
  const [investFilter, setInvestFilter] = useState('all')

  const preset = DTE_PRESETS[dteIdx]
  const {
    data: ivData, isLoading: ivLoading, refetch: refetchIV,
  } = useIVEnvironment()
  const {
    data: ccData, isLoading: ccLoading, refetch: refetchCC,
  } = useCoveredCalls()
  const {
    data: cspData, isLoading: cspLoading, refetch: refetchCSP,
  } = useCashSecuredPuts()
  const {
    data: rawBuyData, isLoading: buyLoading, isFetching: buyFetching, error: buyError, refetch: refetchBuy,
  } = useOptionsScan({ minDte: preset.minDte, maxDte: preset.maxDte, convictionFilter: convFilter })

  const buyData = applyInvestFilter(rawBuyData, investFilter)
  const buyCalls = buyData ? buyData.filter(r => r.direction === 'BUY') : []
  const buyPuts  = buyData ? buyData.filter(r => r.direction === 'SELL') : []
  const buyTotal = buyData ? buyData.reduce((s, r) => s + r.options.length, 0) : 0

  const totalPremiumIncome = [
    ...(ccData ?? []).flatMap(r => r.opportunities),
    ...(cspData ?? []).flatMap(r => r.opportunities),
  ].reduce((sum, o) => sum + (o.annualized_yield_pct ?? 0), 0)

  const refetchAll = () => { refetchIV(); refetchCC(); refetchCSP(); refetchBuy() }
  const anyLoading = ivLoading || ccLoading || cspLoading || buyLoading || buyFetching

  return (
    <div className="p-6 space-y-8 max-w-5xl mx-auto">

      {/* ── Page Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2.5">
            <DollarSign size={22} className="text-emerald-400" />
            Options Income Center
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Sell premium to collect income · buy options for big directional moves
          </p>
        </div>
        <button onClick={refetchAll} disabled={anyLoading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-dark-700 border border-dark-600 text-slate-300 hover:text-slate-100 hover:border-dark-500 transition-colors text-sm disabled:opacity-50">
          <RefreshCw size={14} className={anyLoading ? 'animate-spin' : ''} />
          {anyLoading ? 'Scanning…' : 'Refresh All'}
        </button>
      </div>

      {/* ── IV Pulse Bar ── */}
      <div className="bg-dark-800 border border-dark-700 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={15} className="text-purple-400" />
          <h2 className="text-sm font-semibold text-slate-100">Volatility Pulse</h2>
          <Tooltip text="IV Rank measures how expensive options are right now vs the past year. High IV Rank (>50%) = sell premium. Low IV Rank (<30%) = buy options." wide>
            <HelpCircle size={13} className="text-slate-600 cursor-default" />
          </Tooltip>
          <span className="text-xs text-slate-500 ml-1">
            — tells you whether to sell or buy options today
          </span>
        </div>
        <IVPulseBar data={ivData} isLoading={ivLoading} />
        {!ivLoading && (!ivData || ivData.length === 0) && (
          <p className="text-slate-500 text-sm text-center py-4">
            Add holdings to Portfolio or run the conviction scanner to see IV data.
          </p>
        )}
      </div>

      {/* ── Options Strategy Analyzer ── */}
      <StockAnalyzer />

      {/* ══════════════════════════════════════════════════════════════
          SECTION 1 — PREMIUM INCOME
          ══════════════════════════════════════════════════════════════ */}
      <div className="space-y-6">
        <SectionBanner
          icon={DollarSign}
          color="emerald"
          title="Premium Income — Collect Cash While You Wait"
          subtitle="Sell options to earn income. Time decay works in your favor every single day."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-3 space-y-1.5">
              <p className="text-emerald-400 font-semibold flex items-center gap-1.5"><Layers size={12} /> Covered Calls</p>
              <p>You own 100+ shares. Sell a call above the current price. Collect premium now. If the stock gets called away, you keep the premium AND sell at the strike. If it stays below strike, you keep the premium and repeat next month.</p>
              <p className="text-xs text-slate-500">Requires: 100+ shares of the stock as collateral.</p>
            </div>
            <div className="bg-blue-500/5 border border-blue-500/15 rounded-lg p-3 space-y-1.5">
              <p className="text-blue-400 font-semibold flex items-center gap-1.5"><TrendingUp size={12} /> Cash-Secured Puts</p>
              <p>No shares needed. Sell a put below the current price on a stock you'd WANT to own. Collect premium now. If the stock stays above your strike, you keep the premium. If it drops below, you buy 100 shares at a discount.</p>
              <p className="text-xs text-slate-500">Requires: Cash equal to strike × 100 as collateral.</p>
            </div>
          </div>
          <p className="text-xs text-slate-600 flex items-start gap-1.5 pt-1">
            <AlertCircle size={11} className="mt-0.5 shrink-0" />
            Both strategies have defined risk. Covered calls cap your upside. Cash-secured puts obligate you to buy shares if assigned.
          </p>
        </SectionBanner>

        {/* ── Covered Calls ── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Layers size={14} className="text-emerald-400" />
            <h3 className="text-sm font-semibold text-emerald-400">Covered Calls</h3>
            <span className="text-xs text-slate-500">— sell calls on stocks you own (100+ shares required)</span>
          </div>

          {ccLoading && <LoadingRows n={2} />}

          {!ccLoading && (!ccData || ccData.length === 0) && (
            <div className="bg-dark-800 border border-dark-700 rounded-xl">
              <EmptyState
                icon={Layers}
                title="No eligible holdings"
                subtitle="Add 100+ shares of a stock to your Portfolio to unlock covered call opportunities."
                color="text-emerald-700"
              />
            </div>
          )}

          {ccData && ccData.length > 0 && (
            <div className="space-y-3">
              {ccData.map(r => <CCHoldingSection key={r.symbol} result={r} />)}
            </div>
          )}
        </div>

        {/* ── Cash-Secured Puts ── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <TrendingUp size={14} className="text-blue-400" />
            <h3 className="text-sm font-semibold text-blue-400">Cash-Secured Puts</h3>
            <span className="text-xs text-slate-500">— sell puts on conviction BUY stocks, no shares needed</span>
          </div>

          {cspLoading && <LoadingRows n={3} />}

          {!cspLoading && (!cspData || cspData.length === 0) && (
            <div className="bg-dark-800 border border-dark-700 rounded-xl">
              <EmptyState
                icon={TrendingUp}
                title="No conviction BUY signals"
                subtitle="Run the conviction scanner first. CSP opportunities appear on HIGH CONVICTION and MODERATE BUY stocks."
                color="text-blue-700"
              />
            </div>
          )}

          {cspData && cspData.length > 0 && (
            <div className="space-y-3">
              {cspData.map(r => <CSPSymbolSection key={r.symbol} result={r} />)}
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          SECTION 2 — DIRECTIONAL PLAYS (Buy Options)
          ══════════════════════════════════════════════════════════════ */}
      <div className="space-y-5">
        <SectionBanner
          icon={Zap}
          color="blue"
          title="Directional Plays — Profit From Big Moves"
          subtitle="Buy calls (bullish) or puts (bearish) on high conviction signals. Best when IV is low."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-3 space-y-1.5">
              <p className="text-emerald-400 font-semibold flex items-center gap-1.5"><TrendingUp size={12} /> Long Call (Bullish)</p>
              <p>Pay a premium to buy the right to purchase 100 shares at the strike price. You profit if the stock rises above the break-even. Max loss = the premium you paid, nothing more.</p>
            </div>
            <div className="bg-red-500/5 border border-red-500/15 rounded-lg p-3 space-y-1.5">
              <p className="text-red-400 font-semibold flex items-center gap-1.5"><TrendingDown size={12} /> Long Put (Bearish)</p>
              <p>Pay a premium to buy the right to sell 100 shares at the strike price. You profit if the stock falls below the break-even. Max loss = premium paid only.</p>
            </div>
          </div>
          <div className="bg-dark-700/60 rounded-lg p-3 text-xs space-y-1">
            <p className="text-slate-300 font-medium mb-1">Quick glossary</p>
            {[
              ['Strike price', 'The price at which you have the right to buy (call) or sell (put).'],
              ['Break-even', 'Where the stock must be at expiry for you to not lose money.'],
              ['Delta', 'How much the option moves per $1 move in the stock.'],
              ['Theta (θ)', 'Daily dollar decay — options lose value every day from time passing.'],
            ].map(([term, def]) => (
              <p key={term}><span className="text-slate-300 w-28 inline-block">{term}</span>{def}</p>
            ))}
          </div>
        </SectionBanner>

        {/* Controls */}
        <div className="bg-dark-800 border border-dark-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-sm w-20">Expiry:</span>
              {DTE_PRESETS.map((p, i) => (
                <button key={i} onClick={() => setDteIdx(i)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${dteIdx === i ? 'bg-brand-600 text-white' : 'bg-dark-700 text-slate-400 hover:text-slate-200 border border-dark-600'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-sm w-20">Conviction:</span>
              {[['all', 'All'], ['high', 'High Only'], ['moderate', 'Moderate+']].map(([v, l]) => (
                <button key={v} onClick={() => setConvFilter(v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${convFilter === v ? 'bg-brand-600 text-white' : 'bg-dark-700 text-slate-400 hover:text-slate-200 border border-dark-600'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-dark-700">
            <span className="text-slate-500 text-sm w-20">Investment:</span>
            {INVEST_LEVELS.map(({ value, label, desc }) => (
              <button key={value} onClick={() => setInvestFilter(value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  investFilter === value ? 'bg-brand-600 text-white' : 'bg-dark-700 text-slate-400 hover:text-slate-200 border border-dark-600'
                }`}>
                {label}
                {desc && <span className={investFilter === value ? 'text-white/70' : 'text-slate-600'}>({desc})</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Summary */}
        {buyData && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard icon={BarChart2} label="Stocks Scanned" value={buyData.length} />
            <StatCard icon={Zap} label="Options Found" value={buyTotal} color="text-brand-400" />
            <StatCard icon={TrendingUp} label="Bullish (Calls)" value={buyCalls.length} color="text-emerald-400" />
            <StatCard icon={TrendingDown} label="Bearish (Puts)" value={buyPuts.length} color="text-red-400" />
          </div>
        )}

        {buyLoading && (
          <div className="text-center py-12 text-slate-500">
            <RefreshCw size={22} className="animate-spin mx-auto mb-3 text-slate-600" />
            Scanning options chains based on conviction signals…
          </div>
        )}

        {buyError && (
          <div className="text-center py-10 space-y-2">
            <p className="text-red-400 font-medium">Failed to load options data</p>
            <p className="text-slate-500 text-sm">Is the backend running?</p>
          </div>
        )}

        {buyData && buyData.length === 0 && !buyLoading && (
          <div className="text-center py-12 text-slate-500 space-y-2">
            <Zap size={30} className="mx-auto mb-3 text-slate-700" />
            <p className="font-medium text-slate-400">No options data returned</p>
            <p className="text-sm">Yahoo Finance occasionally returns auth errors. Wait 30–60 seconds and click Refresh All.</p>
            <p className="text-xs text-slate-600 mt-1">If it persists, run the conviction scanner on the Recommendations page first.</p>
          </div>
        )}

        {buyData && buyData.length > 0 && (
          <div className="space-y-4">
            {buyData.map(r => (
              <BuyOptionStockSection key={r.symbol} result={r} />
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
