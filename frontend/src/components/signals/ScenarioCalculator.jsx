import { useState } from 'react'
import { TrendingUp, TrendingDown, DollarSign, AlertTriangle } from 'lucide-react'

/**
 * ScenarioCalculator
 * ------------------
 * Answers "how much can I earn (or lose)?" based on:
 *   - Walk-forward win rate  (from ML prediction)
 *   - ATR-based TP / SL %   (from ML prediction)
 *   - User-supplied investment amount
 *
 * Shows expected value per trade so a non-technical user can
 * understand the math without any promises about future returns.
 */
export default function ScenarioCalculator({ prediction }) {
  const [investment, setInvestment] = useState('1000')

  if (!prediction) return null

  const {
    direction,
    current_price,
    wf_accuracy,       // already in % (e.g. 58.4)
    take_profit_pct,   // e.g. 2.8  → +2.8%
    stop_loss_pct,     // e.g. 1.9  → -1.9%
    confidence_pct,
  } = prediction

  // Fall back to sensible estimates if ATR fields are missing
  const tpPct = take_profit_pct > 0 ? take_profit_pct : 3.0
  const slPct = stop_loss_pct   > 0 ? stop_loss_pct   : 2.0

  const winRate   = Math.min(Math.max(wf_accuracy / 100, 0), 1)   // 0–1
  const lossRate  = 1 - winRate

  const amount    = parseFloat(investment) || 0
  const shares    = current_price > 0 ? amount / current_price : 0

  // In $ terms
  const profitAmt = amount * (tpPct / 100)
  const lossAmt   = amount * (slPct / 100)

  // Expected value
  const ev = winRate * profitAmt - lossRate * lossAmt

  // Break-even win rate: win_rate × TP = loss_rate × SL  →  wr = SL / (TP + SL)
  const breakEvenWR = tpPct + slPct > 0
    ? (slPct / (tpPct + slPct)) * 100
    : 50

  const isUp      = direction === 'UP'
  const dirLabel  = isUp ? 'BUY (UP)' : 'SELL (DOWN)'
  const dirColor  = isUp ? 'text-emerald-400' : 'text-red-400'
  const evPositive = ev >= 0

  const fmt = (n) => {
    const abs = Math.abs(n)
    if (abs >= 1000) return `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    return `$${abs.toFixed(2)}`
  }

  const fmtShares = (n) => {
    if (n >= 100)  return n.toFixed(1)
    if (n >= 1)    return n.toFixed(3)
    return n.toFixed(6)
  }

  return (
    <div className="card space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <DollarSign size={16} className="text-brand-400" />
        <h3 className="font-semibold text-slate-100">Scenario Calculator</h3>
        <span className="text-xs text-slate-500 ml-1">
          — what if you acted on this signal?
        </span>
      </div>

      {/* Investment input */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-400 whitespace-nowrap">If you invest</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
          <input
            type="number"
            min="1"
            step="100"
            value={investment}
            onChange={e => setInvestment(e.target.value)}
            className="input pl-7 w-32 text-sm"
          />
        </div>
        <span className="text-xs text-slate-500">
          ≈ {fmtShares(shares)} {shares === 1 ? 'share' : 'shares'} @ ${current_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
      </div>

      {/* Signal context */}
      <div className="text-xs text-slate-500">
        Signal: <span className={`font-semibold ${dirColor}`}>{dirLabel}</span>
        {' · '}Historical win rate: <span className="text-slate-300 font-semibold">{wf_accuracy.toFixed(1)}%</span>
        {' · '}Confidence: <span className="text-slate-300 font-semibold">{confidence_pct}%</span>
      </div>

      {/* Scenarios */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

        {/* WIN scenario */}
        <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <TrendingUp size={14} className="text-emerald-400" />
            <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">
              If signal is right
            </span>
            <span className="ml-auto text-xs text-slate-500">{(winRate * 100).toFixed(1)}% chance</span>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">
              Target +{tpPct.toFixed(1)}% hit
            </p>
            <p className="text-2xl font-bold text-emerald-400">+{fmt(profitAmt)}</p>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 bg-dark-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full"
              style={{ width: `${winRate * 100}%` }}
            />
          </div>
        </div>

        {/* LOSS scenario */}
        <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <TrendingDown size={14} className="text-red-400" />
            <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">
              If signal is wrong
            </span>
            <span className="ml-auto text-xs text-slate-500">{(lossRate * 100).toFixed(1)}% chance</span>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">
              Stop loss -{slPct.toFixed(1)}% triggered
            </p>
            <p className="text-2xl font-bold text-red-400">-{fmt(lossAmt)}</p>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 bg-dark-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-red-500 rounded-full"
              style={{ width: `${lossRate * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3 pt-1 border-t border-dark-600/60">
        <div className="text-center">
          <p className="text-xs text-slate-500 mb-0.5">Expected value</p>
          <p className={`text-lg font-bold ${evPositive ? 'text-emerald-400' : 'text-red-400'}`}>
            {evPositive ? '+' : '-'}{fmt(ev)}
          </p>
          <p className="text-xs text-slate-600">per trade</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-slate-500 mb-0.5">Risk / Reward</p>
          <p className="text-lg font-bold text-slate-200">
            {(tpPct / slPct).toFixed(1)}:1
          </p>
          <p className="text-xs text-slate-600">TP / SL ratio</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-slate-500 mb-0.5">Break-even win%</p>
          <p className={`text-lg font-bold ${winRate * 100 >= breakEvenWR ? 'text-emerald-400' : 'text-red-400'}`}>
            {breakEvenWR.toFixed(0)}%
          </p>
          <p className="text-xs text-slate-600">you need ≥ this</p>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="flex items-start gap-2 text-xs text-slate-600 pt-1 border-t border-dark-600/40">
        <AlertTriangle size={11} className="text-slate-600 flex-shrink-0 mt-0.5" />
        <span>
          Based on {prediction.wf_rounds ?? '—'} historical walk-forward test rounds.
          Past win rates do not guarantee future results.
          Never invest more than you can afford to lose.
        </span>
      </div>
    </div>
  )
}
