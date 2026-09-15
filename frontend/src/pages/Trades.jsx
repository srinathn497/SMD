import { useState, useMemo } from 'react'
import { useTrades, useTradeStats, useCloseTrade, useDeleteTrade, useOpenTrade } from '../api/trades'
import { useOptionTrades, useCloseOptionTrade, useDeleteOptionTrade } from '../api/optionTrades'
import { scanSingle } from '../api/scan'
import { fetchFundamentals } from '../api/fundamentals'
import { Target, ShieldAlert, X, Activity, Plus, Loader2, CheckCircle, AlertTriangle, TrendingUp, TrendingDown, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import { useWebSocket } from '../store/useWebSocket'
import { useMarketStore } from '../store/marketStore'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n, digits = 2) {
  if (n == null) return '—'
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function fmtPrice(n) {
  if (n == null) return '—'
  return n < 1 ? `$${n.toFixed(6)}` : `$${fmt(n)}`
}

function pnlColor(v) {
  if (v == null) return 'text-slate-400'
  return v >= 0 ? 'text-emerald-400' : 'text-red-400'
}

function statusBadge(status) {
  const map = {
    OPEN:     'bg-blue-500/15 text-blue-300 border-blue-500/30',
    HIT_TP:   'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    HIT_SL:   'bg-red-500/15 text-red-300 border-red-500/30',
    CLOSED:   'bg-slate-500/15 text-slate-400 border-slate-600',
  }
  const labels = { OPEN: 'Open', HIT_TP: 'Hit TP', HIT_SL: 'Hit SL', CLOSED: 'Closed' }
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${map[status] ?? map.CLOSED}`}>
      {labels[status] ?? status}
    </span>
  )
}

// ── Progress bar for open trades ──────────────────────────────────────────────
function ProgressBar({ entry, current, tp, sl, direction }) {
  // For BUY: progress = (current - entry) / (tp - entry)
  // For SELL: progress = (entry - current) / (entry - tp)
  let pct = 0
  if (direction === 'BUY' && tp !== entry) {
    pct = ((current - entry) / (tp - entry)) * 100
  } else if (direction === 'SELL' && entry !== tp) {
    pct = ((entry - current) / (entry - tp)) * 100
  }
  pct = Math.max(0, Math.min(100, pct))
  const isNeg = pct < 0 || (direction === 'BUY' ? current < entry : current > entry)
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-slate-500 mb-1">
        <span>SL {fmtPrice(sl)}</span>
        <span className={pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>{pct.toFixed(0)}% to TP</span>
        <span>TP {fmtPrice(tp)}</span>
      </div>
      <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isNeg ? 'bg-red-500' : 'bg-emerald-500'}`}
          style={{ width: `${Math.abs(pct)}%` }}
        />
      </div>
    </div>
  )
}

// ── Open trade card ───────────────────────────────────────────────────────────
function OpenTradeCard({ trade, livePrice }) {
  const closeM = useCloseTrade()
  const deleteM = useDeleteTrade()
  const [closing, setClosing] = useState(false)

  const isLong = trade.direction === 'BUY'
  const currentPrice = livePrice ?? trade.entry_price
  const isLive = livePrice != null
  const priceDelta = currentPrice - trade.entry_price
  const unrealizedPnl = (isLong ? priceDelta : -priceDelta) * trade.quantity
  const unrealizedPct = trade.entry_price > 0
    ? (priceDelta / trade.entry_price) * 100 * (isLong ? 1 : -1)
    : 0
  const pnlPositive = unrealizedPnl >= 0

  const handleClose = () => {
    setClosing(true)
    closeM.mutate(
      { id: trade.id, close_price: null },
      {
        onSuccess: (t) => {
          const sign = t.pnl >= 0 ? '+' : ''
          toast.success(`Closed ${t.symbol}: ${sign}$${t.pnl?.toFixed(2)} (${sign}${t.pnl_pct?.toFixed(1)}%)`)
          setClosing(false)
        },
        onError: () => {
          toast.error('Failed to close trade')
          setClosing(false)
        },
      }
    )
  }

  const handleDelete = () => {
    deleteM.mutate(trade.id, {
      onSuccess: () => toast('Trade removed'),
      onError: () => toast.error('Failed to delete trade'),
    })
  }

  return (
    <div className="card border border-dark-600">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-100 text-base">{trade.symbol}</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${isLong ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
            {trade.direction}
          </span>
          {statusBadge(trade.status)}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClose}
            disabled={closing || closeM.isPending}
            className="text-xs px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-50 transition-colors"
          >
            {closing ? 'Closing…' : 'Close'}
          </button>
          <button
            onClick={handleDelete}
            className="text-slate-700 hover:text-slate-400 transition-colors"
            title="Remove trade"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Live price + unrealized P&L */}
      <div className={`flex items-center justify-between rounded-xl px-3 py-2 mb-3 ${
        pnlPositive ? 'bg-emerald-500/10' : 'bg-red-500/10'
      }`}>
        <div>
          <div className="flex items-center gap-1.5">
            {isLive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
            <span className="text-xs text-slate-500">{isLive ? 'Live Price' : 'Entry Price'}</span>
          </div>
          <p className="text-base font-semibold text-slate-100">{fmtPrice(currentPrice)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Unrealized P&L</p>
          <p className={`text-base font-bold ${pnlPositive ? 'text-emerald-400' : 'text-red-400'}`}>
            {unrealizedPnl >= 0 ? '+' : ''}${fmt(Math.abs(unrealizedPnl))}
            <span className="text-xs font-normal ml-1.5 opacity-70">
              ({unrealizedPct >= 0 ? '+' : ''}{fmt(unrealizedPct)}% since entry)
            </span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm mb-3">
        <div>
          <p className="text-xs text-slate-500">Entry</p>
          <p className="font-medium text-slate-200">{fmtPrice(trade.entry_price)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 flex items-center gap-1"><Target size={10} /> Take Profit</p>
          <p className="font-medium text-emerald-400">{fmtPrice(trade.take_profit)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 flex items-center gap-1"><ShieldAlert size={10} /> Stop Loss</p>
          <p className="font-medium text-red-400">{fmtPrice(trade.stop_loss)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
        <span>{trade.quantity} {trade.asset_type === 'crypto' ? 'units' : 'shares'} @ {fmtPrice(trade.entry_price)}</span>
        <span>{new Date(trade.open_at).toLocaleDateString()}</span>
      </div>

      {trade.top_reason && (
        <p className="text-xs text-slate-500 italic mb-3 truncate">{trade.signal}: {trade.top_reason}</p>
      )}

      <ProgressBar
        entry={trade.entry_price}
        current={currentPrice}
        tp={trade.take_profit}
        sl={trade.stop_loss}
        direction={trade.direction}
      />

    </div>
  )
}

// ── Closed trades table ───────────────────────────────────────────────────────
function ClosedTradesTable({ trades, livePrices = {} }) {
  if (trades.length === 0) return null
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 border-b border-dark-600">
            <th className="text-left pb-2 pr-4">Symbol</th>
            <th className="text-left pb-2 pr-4">Dir</th>
            <th className="text-right pb-2 pr-4">Entry</th>
            <th className="text-right pb-2 pr-4">Exit</th>
            <th className="text-right pb-2 pr-4">Now</th>
            <th className="text-right pb-2 pr-4">P&amp;L</th>
            <th className="text-right pb-2 pr-4">P&amp;L %</th>
            <th className="text-center pb-2 pr-4">Result</th>
            <th className="text-left pb-2">Opened</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-dark-700">
          {trades.map(t => {
            const now = livePrices[t.symbol]?.price
            const vsExit = now != null && t.close_price != null
              ? ((now - t.close_price) / t.close_price * 100) * (t.direction === 'BUY' ? 1 : -1)
              : null
            return (
              <tr key={t.id} className="hover:bg-dark-700/30 transition-colors">
                <td className="py-2 pr-4 font-semibold text-slate-200">{t.symbol}</td>
                <td className="py-2 pr-4">
                  <span className={`text-xs font-bold ${t.direction === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.direction}
                  </span>
                </td>
                <td className="py-2 pr-4 text-right text-slate-300">{fmtPrice(t.entry_price)}</td>
                <td className="py-2 pr-4 text-right text-slate-300">{fmtPrice(t.close_price)}</td>
                <td className="py-2 pr-4 text-right">
                  {now != null ? (
                    <div>
                      <div className="text-slate-200 font-mono">{fmtPrice(now)}</div>
                      {vsExit != null && (
                        <div className={`text-xs ${vsExit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {vsExit >= 0 ? '+' : ''}{fmt(vsExit)}% since exit
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className={`py-2 pr-4 text-right font-medium ${pnlColor(t.pnl)}`}>
                  {t.pnl != null ? `${t.pnl >= 0 ? '+' : ''}$${fmt(Math.abs(t.pnl))}` : '—'}
                </td>
                <td className={`py-2 pr-4 text-right ${pnlColor(t.pnl_pct)}`}>
                  {t.pnl_pct != null ? `${t.pnl_pct >= 0 ? '+' : ''}${fmt(t.pnl_pct)}%` : '—'}
                </td>
                <td className="py-2 pr-4 text-center">{statusBadge(t.status)}</td>
                <td className="py-2 text-slate-500 text-xs">
                  {new Date(t.open_at).toLocaleDateString()}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Add Trade Modal ───────────────────────────────────────────────────────────
const REC_DIRECTION = {
  'STRONG BUY': 'BUY', 'BUY': 'BUY', 'WEAK BUY': 'BUY',
  'STRONG SELL': 'SELL', 'SELL': 'SELL', 'WEAK SELL': 'SELL',
}

const EMPTY_FORM = {
  symbol: '', asset_type: 'stock', direction: 'BUY',
  entry_price: '', take_profit: '', stop_loss: '', quantity: '1',
}

function AddTradeModal({ onClose }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState(null)   // holds the scan signal info
  const [fundWarning, setFundWarning] = useState(null) // { risks: string[] } or null
  const [riskAcknowledged, setRiskAcknowledged] = useState(false)
  const openTrade = useOpenTrade()

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // ── Auto-scan symbol when user finishes typing ──────────────────────────────
  const handleSymbolBlur = async () => {
    const sym = form.symbol.trim().toUpperCase()
    if (!sym) return
    const assetType = sym.endsWith('-USD') ? 'crypto' : form.asset_type

    setScanning(true)
    setScanResult(null)
    setFundWarning(null)
    setRiskAcknowledged(false)
    try {
      const res = await scanSingle(sym, assetType)
      if (res.error || res.price === 0) {
        toast.error(`Could not fetch data for ${sym}`)
        setScanning(false)
        return
      }

      // Determine direction from signal, or default BUY
      const dir = REC_DIRECTION[res.recommendation] ?? 'BUY'
      const isBuy = dir === 'BUY'

      // Use ATR-based levels if available, else ±3%/2% fallback
      const price = res.price
      const tp = res.take_profit > 0 ? res.take_profit : (isBuy ? price * 1.03 : price * 0.97)
      const sl = res.stop_loss  > 0 ? res.stop_loss  : (isBuy ? price * 0.98 : price * 1.02)
      const dec = price < 1 ? 6 : 2

      setForm(f => ({
        ...f,
        symbol: sym,
        asset_type: assetType,
        direction: dir,
        entry_price: price.toFixed(dec),
        take_profit: tp.toFixed(dec),
        stop_loss:   sl.toFixed(dec),
      }))
      setScanResult({ recommendation: res.recommendation, top_reason: res.top_reason, confidence_pct: res.confidence_pct })

      // ── Tier 3: risk gate — check D/E and FCF for stocks ──────────────────
      if (assetType !== 'crypto') {
        try {
          const fund = await fetchFundamentals(sym, price)
          const risks = []
          if (fund?.debt_to_equity != null && fund.debt_to_equity > 3.0)
            risks.push(`High leverage: D/E ratio ${fund.debt_to_equity.toFixed(2)}× exceeds 3.0× threshold`)
          if (fund?.fcf_yield_pct != null && fund.fcf_yield_pct < 0)
            risks.push(`Negative free cash flow: FCF Yield ${fund.fcf_yield_pct.toFixed(1)}% (company burning cash)`)
          if (risks.length > 0) setFundWarning({ risks })
        } catch {
          // fundamentals unavailable — don't block trade
        }
      }
    } catch {
      toast.error(`Could not fetch data for ${sym}`)
    }
    setScanning(false)
  }

  const handleSymbolKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSymbolBlur() }
  }

  const validate = () => {
    const e = {}
    if (!form.symbol.trim()) e.symbol = 'Required'
    if (!form.entry_price || Number(form.entry_price) <= 0) e.entry_price = 'Must be > 0'
    if (!form.take_profit || Number(form.take_profit) <= 0) e.take_profit = 'Must be > 0'
    if (!form.stop_loss   || Number(form.stop_loss)   <= 0) e.stop_loss   = 'Must be > 0'
    if (!form.quantity    || Number(form.quantity)    <= 0) e.quantity    = 'Must be > 0'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) return
    openTrade.mutate(
      {
        symbol: form.symbol.trim().toUpperCase(),
        asset_type: form.asset_type,
        direction: form.direction,
        entry_price: Number(form.entry_price),
        take_profit: Number(form.take_profit),
        stop_loss:   Number(form.stop_loss),
        quantity:    Number(form.quantity),
        signal: scanResult?.recommendation ?? 'MANUAL',
        top_reason: scanResult?.top_reason ?? 'Manually entered trade',
      },
      {
        onSuccess: () => {
          toast.success(`Trade opened: ${form.direction} ${form.symbol.toUpperCase()} @ $${form.entry_price}`)
          onClose()
        },
        onError: (err) => toast.error(err?.message ?? 'Failed to open trade', { duration: 8000 }),
      }
    )
  }

  const isBuy = form.direction === 'BUY'
  const filledIn = form.entry_price && form.take_profit && form.stop_loss

  const REC_COLOR = {
    'STRONG BUY': 'text-emerald-400', 'BUY': 'text-emerald-400', 'WEAK BUY': 'text-teal-400',
    'STRONG SELL': 'text-red-500', 'SELL': 'text-red-400', 'WEAK SELL': 'text-orange-400',
    'HOLD': 'text-yellow-400',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-800 border border-dark-600 rounded-xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700">
          <h3 className="font-semibold text-slate-100">Add Trade</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">

          {/* Symbol row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-500 mb-1">
                Symbol <span className="text-slate-600">(press Enter to auto-fill)</span>
              </label>
              <div className="relative">
                <input
                  className="input w-full uppercase pr-8"
                  placeholder="AAPL, TSLA, BTC-USD…"
                  value={form.symbol}
                  onChange={e => { set('symbol', e.target.value); setScanResult(null); setFundWarning(null); setRiskAcknowledged(false) }}
                  onBlur={handleSymbolBlur}
                  onKeyDown={handleSymbolKeyDown}
                  disabled={scanning}
                />
                {scanning && (
                  <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-brand-400 animate-spin" />
                )}
                {!scanning && scanResult && (
                  <CheckCircle size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-emerald-400" />
                )}
              </div>
              {errors.symbol && <p className="text-xs text-red-400 mt-1">{errors.symbol}</p>}
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Type</label>
              <div className="flex rounded-lg overflow-hidden border border-dark-600">
                {['stock', 'crypto'].map(t => (
                  <button key={t} type="button"
                    onClick={() => set('asset_type', t)}
                    className={`px-3 py-2 text-xs font-medium transition-colors ${form.asset_type === t ? 'bg-brand-600 text-white' : 'bg-dark-700 text-slate-400 hover:text-slate-200'}`}
                  >{t}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Scan result banner */}
          {scanResult && (
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-dark-700 border border-dark-600">
              <div>
                <span className={`text-xs font-bold ${REC_COLOR[scanResult.recommendation] ?? 'text-slate-300'}`}>
                  {scanResult.recommendation}
                </span>
                <span className="text-xs text-slate-500 ml-2 truncate">{scanResult.top_reason}</span>
              </div>
              <span className="text-xs text-slate-500">{scanResult.confidence_pct}% confidence</span>
            </div>
          )}

          {/* ── Risk warning banner (D/E > 3 or negative FCF) ── */}
          {fundWarning && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle size={13} className="text-red-400 shrink-0" />
                <span className="text-xs font-semibold text-red-400">Risk Warning — Fundamental Concerns</span>
              </div>
              <ul className="space-y-1">
                {fundWarning.risks.map((r, i) => (
                  <li key={i} className="text-xs text-red-300 flex items-start gap-1.5">
                    <span className="text-red-500 shrink-0 mt-0.5">•</span>
                    {r}
                  </li>
                ))}
              </ul>
              <label className="flex items-center gap-2 cursor-pointer pt-0.5">
                <input
                  type="checkbox"
                  checked={riskAcknowledged}
                  onChange={e => setRiskAcknowledged(e.target.checked)}
                  className="rounded border-red-500/50 bg-dark-700 accent-red-500"
                />
                <span className="text-xs text-red-300 select-none">I understand the risks and want to proceed</span>
              </label>
            </div>
          )}

          {/* Scanning placeholder */}
          {scanning && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-dark-700 border border-dark-600">
              <Loader2 size={13} className="animate-spin text-brand-400" />
              <span className="text-xs text-slate-400">Analysing {form.symbol.toUpperCase()}… fetching price & signals</span>
            </div>
          )}

          {/* Direction toggle */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Direction</label>
            <div className="flex rounded-lg overflow-hidden border border-dark-600">
              <button type="button" onClick={() => set('direction', 'BUY')}
                className={`flex-1 py-2 text-sm font-bold transition-colors ${form.direction === 'BUY' ? 'bg-emerald-600 text-white' : 'bg-dark-700 text-slate-400 hover:text-slate-200'}`}
              >BUY / LONG</button>
              <button type="button" onClick={() => set('direction', 'SELL')}
                className={`flex-1 py-2 text-sm font-bold transition-colors ${form.direction === 'SELL' ? 'bg-red-600 text-white' : 'bg-dark-700 text-slate-400 hover:text-slate-200'}`}
              >SELL / SHORT</button>
            </div>
          </div>

          {/* Entry + Quantity */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-500 mb-1">Entry Price ($)</label>
              <input type="number" step="any" min="0" className="input w-full"
                placeholder="Auto-filled after scan"
                value={form.entry_price}
                onChange={e => set('entry_price', e.target.value)}
              />
              {errors.entry_price && <p className="text-xs text-red-400 mt-1">{errors.entry_price}</p>}
            </div>
            <div className="w-28">
              <label className="block text-xs text-slate-500 mb-1">Qty (shares)</label>
              <input type="number" step="any" min="0" className="input w-full"
                placeholder="1"
                value={form.quantity}
                onChange={e => set('quantity', e.target.value)}
              />
              {errors.quantity && <p className="text-xs text-red-400 mt-1">{errors.quantity}</p>}
            </div>
          </div>

          {/* TP + SL — shown but labelled as auto-calculated */}
          {filledIn ? (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-emerald-500 mb-1 flex items-center gap-1">
                  <Target size={10} /> Take Profit ($)
                  <span className="text-slate-600 font-normal ml-1">auto-calculated, editable</span>
                </label>
                <input type="number" step="any" min="0"
                  className="input w-full border-emerald-600/30 focus:border-emerald-500"
                  value={form.take_profit}
                  onChange={e => set('take_profit', e.target.value)}
                />
                {errors.take_profit && <p className="text-xs text-red-400 mt-1">{errors.take_profit}</p>}
              </div>
              <div className="flex-1">
                <label className="block text-xs text-red-400 mb-1 flex items-center gap-1">
                  <ShieldAlert size={10} /> Stop Loss ($)
                  <span className="text-slate-600 font-normal ml-1">auto-calculated, editable</span>
                </label>
                <input type="number" step="any" min="0"
                  className="input w-full border-red-600/30 focus:border-red-500"
                  value={form.stop_loss}
                  onChange={e => set('stop_loss', e.target.value)}
                />
                {errors.stop_loss && <p className="text-xs text-red-400 mt-1">{errors.stop_loss}</p>}
              </div>
            </div>
          ) : (
            <div className="px-3 py-3 rounded-lg bg-dark-700/50 border border-dashed border-dark-600 text-xs text-slate-500 text-center">
              Enter a symbol above and press <span className="text-slate-300">Enter</span> — price, TP and SL will be auto-filled from our signal engine
            </div>
          )}

          {/* Cost preview */}
          {Number(form.entry_price) > 0 && Number(form.quantity) > 0 && (
            <p className="text-xs text-slate-500 text-right">
              Total exposure:{' '}
              <span className="text-slate-300 font-medium">
                ${(Number(form.entry_price) * Number(form.quantity)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-dark-600 text-slate-400 text-sm hover:bg-dark-700 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={openTrade.isPending || scanning || (!!fundWarning && !riskAcknowledged)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${
                isBuy ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-red-600 hover:bg-red-500 text-white'
              }`}>
              {openTrade.isPending ? 'Opening...' : `Open ${form.direction}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function StatBox({ label, value, color }) {
  return (
    <div className="card flex-1 min-w-28 text-center py-3">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  )
}

// ── Option trade card ─────────────────────────────────────────────────────────

function OptionTradeCard({ trade, livePrice }) {
  const closeM = useCloseOptionTrade()
  const deleteM = useDeleteOptionTrade()
  const [closePrice, setClosePrice] = useState('')
  const [showClose, setShowClose] = useState(false)

  const isCall = trade.option_type === 'CALL'
  const isOpen = trade.status === 'OPEN'
  const accentText = isCall ? 'text-emerald-400' : 'text-red-400'
  const accentBg   = isCall ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'
  const TypeIcon   = isCall ? TrendingUp : TrendingDown

  // Estimated live option value using delta approximation
  // Option price ≈ entry_ask + (stock_move × delta)
  const isLive = livePrice != null && isOpen
  const stockMove = isLive ? livePrice - trade.stock_price_at_entry : 0
  const estOptionPrice = isLive
    ? Math.max(0, trade.ask_at_entry + stockMove * Math.abs(trade.delta ?? 0))
    : null
  const estPnl = estOptionPrice != null
    ? (estOptionPrice - trade.ask_at_entry) * 100 * trade.quantity
    : null
  const estPnlPct = estOptionPrice != null && trade.ask_at_entry > 0
    ? (estOptionPrice - trade.ask_at_entry) / trade.ask_at_entry * 100
    : null
  const pnlPositive = estPnl == null ? null : estPnl >= 0

  const daysLeft = (() => {
    const diff = Math.ceil((new Date(trade.expiration) - new Date()) / 86400000)
    return diff
  })()
  const timeStopDaysLeft = Math.ceil((new Date(trade.time_stop_date) - new Date()) / 86400000)

  const totalCost = trade.cost_per_contract * trade.quantity
  const tpTotal   = trade.profit_target * 100 * trade.quantity
  const slTotal   = trade.stop_loss_opt * 100 * trade.quantity

  const handleClose = () => {
    const price = parseFloat(closePrice)
    if (isNaN(price) || price <= 0) { toast.error('Enter a valid close price per share'); return }
    closeM.mutate({ id: trade.id, close_price: price }, {
      onSuccess: t => {
        const sign = t.pnl >= 0 ? '+' : ''
        toast.success(`Closed ${t.symbol} ${t.option_type}: ${sign}$${t.pnl?.toFixed(2)}`)
        setShowClose(false)
      },
      onError: () => toast.error('Failed to close trade'),
    })
  }

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${accentBg}`}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <TypeIcon size={14} className={accentText} />
            <span className="font-bold text-slate-100">{trade.symbol}</span>
            <span className={`text-xs font-bold ${accentText}`}>{trade.option_type}</span>
            <span className="text-slate-300 text-sm font-mono">${trade.strike} strike</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
              isOpen ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' : 'bg-slate-500/15 text-slate-400 border-slate-600'
            }`}>{trade.status}</span>
          </div>
          <p className="text-xs text-slate-500">
            Exp {trade.expiration}
            {isOpen && daysLeft > 0 && <span className={daysLeft <= 14 ? 'text-red-400 ml-1 font-medium' : 'text-slate-500 ml-1'}>({daysLeft}d left)</span>}
            {' · '}{trade.quantity} contract{trade.quantity !== 1 ? 's' : ''}
            {trade.conviction && <span className="ml-1 text-slate-600">· {trade.conviction.replace('_', ' ')}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOpen && (
            <button onClick={() => setShowClose(v => !v)}
              className="text-xs px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-colors">
              Close
            </button>
          )}
          <button onClick={() => deleteM.mutate(trade.id, { onSuccess: () => toast('Removed'), onError: () => toast.error('Failed') })}
            className="text-slate-700 hover:text-slate-400 transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Live stock price + estimated option P&L (open trades only) */}
      {isOpen && (
        <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
          pnlPositive === true ? 'bg-emerald-500/10' : pnlPositive === false ? 'bg-red-500/10' : 'bg-dark-700/50'
        }`}>
          <div>
            <div className="flex items-center gap-1.5">
              {isLive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
              <span className="text-xs text-slate-500">{isLive ? 'Stock Price' : 'Entry Stock Price'}</span>
            </div>
            <p className="font-semibold text-slate-100 font-mono">
              {isLive ? `$${livePrice.toFixed(2)}` : `$${trade.stock_price_at_entry?.toFixed(2)}`}
            </p>
            {isLive && (
              <p className={`text-xs ${stockMove >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {stockMove >= 0 ? '+' : ''}{stockMove.toFixed(2)} since entry
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">{isLive ? 'Est. Option Value' : 'Option Entry'}</p>
            <p className="font-semibold text-slate-100 font-mono">
              ${isLive ? estOptionPrice.toFixed(2) : trade.ask_at_entry.toFixed(2)}/share
            </p>
            {isLive && estPnl != null && (
              <p className={`text-xs font-medium ${pnlPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {estPnl >= 0 ? '+' : ''}${Math.abs(estPnl).toFixed(2)}
                <span className="opacity-70 font-normal ml-1">
                  ({estPnlPct >= 0 ? '+' : ''}{estPnlPct.toFixed(1)}%)
                </span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* P&L for closed */}
      {!isOpen && trade.pnl != null && (
        <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${trade.pnl >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
          <span className="text-slate-400 text-xs">Realized P&L</span>
          <span className={`font-bold ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {trade.pnl >= 0 ? '+' : ''}${Math.abs(trade.pnl).toFixed(2)}
            <span className="text-xs font-normal ml-1 opacity-70">({trade.pnl_pct >= 0 ? '+' : ''}{trade.pnl_pct?.toFixed(1)}%)</span>
          </span>
        </div>
      )}

      {/* Trade plan grid */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-dark-800/60 rounded-lg p-2">
          <p className="text-slate-500 mb-0.5">Total Cost</p>
          <p className="font-mono font-semibold text-slate-100">${totalCost.toFixed(2)}</p>
          <p className="text-slate-600">${trade.ask_at_entry}/share</p>
        </div>
        <div className="bg-dark-800/60 rounded-lg p-2">
          <p className="text-emerald-500 mb-0.5">Take Profit</p>
          <p className="font-mono font-semibold text-emerald-400">${tpTotal.toFixed(2)}</p>
          <p className="text-slate-600">${trade.profit_target}/share</p>
        </div>
        <div className="bg-dark-800/60 rounded-lg p-2">
          <p className="text-red-500 mb-0.5">Stop Loss</p>
          <p className="font-mono font-semibold text-red-400">${slTotal.toFixed(2)}</p>
          <p className="text-slate-600">${trade.stop_loss_opt}/share</p>
        </div>
      </div>

      {/* Greeks + break-even */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span>δ <span className="text-slate-300">{trade.delta?.toFixed(2)}</span></span>
        <span>θ/d <span className="text-red-400">${Math.abs(trade.theta_per_day ?? 0).toFixed(2)}</span></span>
        <span>IV <span className="text-slate-300">{trade.iv_pct?.toFixed(1)}%</span></span>
        <span>B/E <span className="text-slate-300">${trade.breakeven_price?.toFixed(2)}</span></span>
        <span className="ml-auto text-xs text-slate-600">entry {new Date(trade.entry_at).toLocaleDateString()}</span>
      </div>

      {/* Time stop warning */}
      {isOpen && timeStopDaysLeft <= 7 && (
        <div className="flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-1.5">
          <Clock size={11} />
          <span>Time stop in {timeStopDaysLeft}d — exit by {trade.time_stop_date}</span>
        </div>
      )}
      {isOpen && timeStopDaysLeft > 7 && (
        <div className="flex items-center gap-1.5 text-xs text-yellow-500/70">
          <Clock size={11} />
          <span>Exit by {trade.time_stop_date} ({timeStopDaysLeft}d)</span>
        </div>
      )}

      {/* Close panel */}
      {showClose && (
        <div className="flex gap-2 pt-1 border-t border-dark-700">
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">Close price (per share)</label>
            <input type="number" step="0.01" min="0" placeholder="e.g. 3.50"
              className="input w-full text-sm"
              value={closePrice}
              onChange={e => setClosePrice(e.target.value)}
            />
          </div>
          <button onClick={handleClose} disabled={closeM.isPending}
            className="self-end px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
            {closeM.isPending ? '…' : 'Confirm'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Option trades section ─────────────────────────────────────────────────────

function OptionTradesSection() {
  const { data: optionTrades = [], isPending } = useOptionTrades()
  const livePrices = useMarketStore(s => s.livePrices)
  if (isPending) return null
  if (optionTrades.length === 0) return null

  const open   = optionTrades.filter(t => t.status === 'OPEN')
  const closed = optionTrades.filter(t => t.status !== 'OPEN')

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
        <TrendingUp size={14} className="text-brand-400" />
        Options Trades ({optionTrades.length})
      </h3>

      {open.length > 0 && (
        <div>
          <p className="text-xs text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse inline-block" />
            Open ({open.length})
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {open.map(t => (
              <OptionTradeCard key={t.id} trade={t} livePrice={livePrices[t.symbol]?.price} />
            ))}
          </div>
        </div>
      )}

      {closed.length > 0 && (
        <div>
          <p className="text-xs text-slate-600 uppercase tracking-wider mb-2">Closed ({closed.length})</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {closed.map(t => <OptionTradeCard key={t.id} trade={t} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ onAdd }) {
  return (
    <div className="card text-center py-16">
      <Activity size={40} className="mx-auto text-slate-600 mb-4" />
      <p className="text-slate-300 font-medium text-lg">No trades yet</p>
      <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">
        Click <span className="text-slate-300">Add Trade</span> above to manually log a trade,
        or go to <span className="text-slate-300">Recommendations</span> to open one from a scan signal.
      </p>
      <button
        onClick={onAdd}
        className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        <Plus size={14} /> Add your first trade
      </button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Trades() {
  const { data: trades = [], isPending: tradesLoading } = useTrades()
  const { data: optionTrades = [] } = useOptionTrades()
  const { data: stats } = useTradeStats()
  const [showAddModal, setShowAddModal] = useState(false)

  const open   = trades.filter(t => t.status === 'OPEN')
  const closed = trades.filter(t => t.status !== 'OPEN')

  const livePrices = useMarketStore(s => s.livePrices)
  const allSymbols = useMemo(
    () => {
      const stockSyms = trades.map(t => t.symbol)
      const optionSyms = optionTrades.filter(t => t.status === 'OPEN').map(t => t.symbol)
      return [...new Set([...stockSyms, ...optionSyms])]
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trades.map(t => t.symbol).join(','), optionTrades.map(t => t.symbol).join(',')]
  )
  useWebSocket(allSymbols)

  const totalPnl = stats?.total_pnl ?? 0
  const winRate  = stats?.win_rate_pct ?? 0

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {showAddModal && <AddTradeModal onClose={() => setShowAddModal(false)} />}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Trades</h2>
          <p className="text-slate-500 text-sm mt-1">
            Track open swing trades with automatic TP/SL monitoring every 30 minutes.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <Plus size={15} /> Add Trade
        </button>
      </div>

      {/* Stats bar */}
      {trades.length > 0 && stats && (
        <div className="flex gap-3 flex-wrap">
          <StatBox
            label="Total P&L"
            value={`${totalPnl >= 0 ? '+' : ''}$${fmt(Math.abs(totalPnl))}`}
            color={totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
          />
          <StatBox
            label="Win Rate"
            value={`${fmt(winRate)}%`}
            color={winRate >= 50 ? 'text-emerald-400' : 'text-orange-400'}
          />
          <StatBox
            label="Open Trades"
            value={stats.open_count}
            color="text-blue-400"
          />
          <StatBox
            label="Closed Trades"
            value={stats.closed_count}
            color="text-slate-300"
          />
        </div>
      )}

      {/* Loading */}
      {tradesLoading && (
        <div className="text-center py-12 text-slate-500">Loading trades...</div>
      )}

      {/* Empty state */}
      {!tradesLoading && trades.length === 0 && <EmptyState onAdd={() => setShowAddModal(true)} />}

      {/* Open trades */}
      {open.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            Open Trades ({open.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {open.map(t => <OpenTradeCard key={t.id} trade={t} livePrice={livePrices[t.symbol]?.price} />)}
          </div>
        </div>
      )}

      {/* Closed trades */}
      {closed.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Closed Trades ({closed.length})
          </h3>
          <ClosedTradesTable trades={closed} livePrices={livePrices} />
        </div>
      )}

      {/* Options trades — separate section */}
      <OptionTradesSection />
    </div>
  )
}
