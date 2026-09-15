import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useRisk } from '../../api/portfolio'

// ── Helpers ───────────────────────────────────────────────────────────────────

function corrBg(c) {
  if (c == null) return 'rgba(30,41,59,0.6)'
  const abs = Math.abs(c)
  if (c > 0) return `rgba(239,68,68,${0.1 + abs * 0.68})`
  return `rgba(34,197,94,${0.1 + abs * 0.52})`
}

function metricColor(val, { posAbove, negBelow, neutral = 'text-slate-100' } = {}) {
  if (val == null) return 'text-slate-500'
  if (posAbove != null && val >= posAbove) return 'text-emerald-400'
  if (negBelow != null && val <= negBelow) return 'text-red-400'
  return neutral
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Metric({ label, value, color = 'text-slate-100', sub }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-3 text-center min-w-0">
      <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-1 whitespace-nowrap">{label}</span>
      <span className={`text-xl font-bold tabular-nums leading-tight ${color}`}>{value ?? '—'}</span>
      {sub && <span className="text-[10px] text-slate-600 mt-0.5 whitespace-nowrap">{sub}</span>}
    </div>
  )
}

function ConcBar({ label, pct }) {
  const fill = pct > 60 ? '#ef4444' : pct > 40 ? '#eab308' : '#22c55e'
  const txt  = pct > 60 ? 'text-red-400' : pct > 40 ? 'text-yellow-400' : 'text-emerald-400'
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-slate-500">{label}</span>
        <span className={`text-xs font-bold tabular-nums ${txt}`}>{pct.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: fill }} />
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RiskDashboard() {
  const { data, isPending, isError, refetch, isFetching } = useRisk()

  // ── Loading ──
  if (isPending) {
    return (
      <div className="card animate-pulse space-y-4">
        <div className="h-4 w-32 bg-dark-700 rounded" />
        <div className="h-24 bg-dark-700 rounded-lg" />
        <div className="h-12 bg-dark-700 rounded-lg" />
      </div>
    )
  }

  // ── Error ──
  if (isError) {
    return (
      <div className="card flex items-center gap-3 text-red-400 text-sm py-4">
        <AlertTriangle size={15} /> Failed to load risk metrics.
      </div>
    )
  }

  // ── Insufficient data ──
  if (!data || data.insufficient_data) {
    return (
      <div className="card text-center py-8">
        <AlertTriangle size={22} className="text-yellow-500/60 mx-auto mb-2" />
        <p className="text-slate-400 font-medium text-sm">{data?.message ?? 'Add holdings to compute risk metrics.'}</p>
      </div>
    )
  }

  const {
    var_95_dollar, var_95_pct,
    sharpe_ratio, sortino_ratio, max_drawdown_pct, beta,
    annualized_return_pct, annualized_vol_pct,
    holdings, correlation_matrix, all_symbols,
    top1_concentration_pct, top3_concentration_pct, top5_concentration_pct,
    total_portfolio_value, period_days, risk_free_rate_pct, computed_at,
  } = data

  const corrMap = {}
  correlation_matrix?.forEach(({ symbol_a, symbol_b, correlation }) => {
    corrMap[`${symbol_a}:${symbol_b}`] = correlation
  })

  const sharpColor  = sharpe_ratio  == null ? '' : sharpe_ratio  >= 1   ? 'text-emerald-400' : sharpe_ratio  >= 0 ? 'text-yellow-400' : 'text-red-400'
  const sortColor   = sortino_ratio == null ? '' : sortino_ratio >= 1.5 ? 'text-emerald-400' : sortino_ratio >= 0 ? 'text-yellow-400' : 'text-red-400'
  const ddColor     = max_drawdown_pct > -10 ? 'text-emerald-400' : max_drawdown_pct > -20 ? 'text-yellow-400' : 'text-red-400'
  const betaColor   = beta == null ? 'text-slate-500' : Math.abs(beta) > 1.3 ? 'text-yellow-400' : 'text-slate-100'
  const retColor    = annualized_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'
  const volColor    = annualized_vol_pct > 30 ? 'text-red-400' : annualized_vol_pct > 15 ? 'text-yellow-400' : 'text-emerald-400'

  return (
    <div className="space-y-3">

      {/* ── Section header ── */}
      <div className="flex items-center justify-between px-0.5">
        <div>
          <h3 className="font-semibold text-slate-200 text-sm">Risk Analysis</h3>
          <p className="text-[11px] text-slate-600 mt-0.5">
            {period_days}d · {all_symbols.length} holdings · RF {risk_free_rate_pct?.toFixed(1)}%
            {computed_at && ` · ${new Date(computed_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-dark-700 rounded-lg transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── Card 1: VaR + stats strip ── */}
      <div className="card p-0 overflow-hidden">

        {/* VaR row */}
        <div
          className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap"
          style={{ background: 'linear-gradient(135deg, rgba(153,27,27,0.12) 0%, transparent 65%)' }}
        >
          <div>
            <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-1 flex items-center gap-1.5">
              <AlertTriangle size={10} className="text-red-500" />
              1-Day VaR · 95% Confidence
            </p>
            <p className="text-3xl font-bold text-red-400 tabular-nums">
              ${var_95_dollar.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {var_95_pct.toFixed(2)}% of portfolio — worst 5% of days
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Portfolio NAV</p>
            <p className="text-xl font-bold text-slate-200 tabular-nums">
              ${total_portfolio_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        {/* Stats strip */}
        <div className="border-t border-dark-700 grid grid-cols-3 sm:grid-cols-6 divide-x divide-dark-700">
          <Metric label="Sharpe"     value={sharpe_ratio?.toFixed(2)}                                                   color={sharpColor} sub="excess / vol" />
          <Metric label="Sortino"    value={sortino_ratio?.toFixed(2)}                                                   color={sortColor}  sub="excess / dwnside" />
          <Metric label="Max DD"     value={max_drawdown_pct != null ? `${max_drawdown_pct.toFixed(1)}%` : null}         color={ddColor}    sub="peak-to-trough" />
          <Metric label="Beta"       value={beta?.toFixed(2)}                                                            color={betaColor}  sub="vs SPY" />
          <Metric label="Ann Return" value={annualized_return_pct != null ? `${annualized_return_pct >= 0 ? '+' : ''}${annualized_return_pct.toFixed(1)}%` : null} color={retColor} sub="1yr" />
          <Metric label="Ann Vol"    value={annualized_vol_pct != null ? `${annualized_vol_pct.toFixed(1)}%` : null}     color={volColor}   sub="1yr" />
        </div>
      </div>

      {/* ── Card 2: Holdings table ── */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-dark-700 flex items-center justify-between">
          <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Holdings Breakdown</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-dark-700/60 text-slate-600">
                <th className="px-4 py-2 text-left font-medium">Symbol</th>
                <th className="px-4 py-2 text-right font-medium">Weight</th>
                <th className="px-4 py-2 text-right font-medium">Value</th>
                <th className="px-4 py-2 text-right font-medium">Beta</th>
                <th className="px-4 py-2 text-right font-medium">Ann. Vol</th>
                <th className="px-4 py-2 text-right font-medium">VaR Contrib</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map(h => (
                <tr key={h.symbol} className="border-b border-dark-700/30 hover:bg-dark-700/20 transition-colors">
                  <td className="px-4 py-2.5 font-semibold text-slate-200">{h.symbol}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{h.weight_pct?.toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">
                    ${h.current_value?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span className={h.beta == null ? 'text-slate-600' : h.beta > 1.3 ? 'text-red-400' : h.beta < 0 ? 'text-yellow-400' : 'text-slate-400'}>
                      {h.beta?.toFixed(2) ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span className={h.daily_vol_pct == null ? 'text-slate-600' : h.daily_vol_pct > 40 ? 'text-red-400' : h.daily_vol_pct > 25 ? 'text-yellow-400' : 'text-slate-400'}>
                      {h.daily_vol_pct != null ? `${h.daily_vol_pct.toFixed(1)}%` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-red-400/70">
                    {h.var_contrib_pct != null ? `${h.var_contrib_pct.toFixed(2)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Card 3: Concentration + Correlation (side by side on lg) ── */}
      <div className={`grid gap-3 ${all_symbols.length >= 2 ? 'grid-cols-1 lg:grid-cols-[240px_1fr]' : 'grid-cols-1'}`}>

        {/* Concentration */}
        <div className="card">
          <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-4">Concentration</p>
          <div className="space-y-3.5">
            <ConcBar label="Top 1 holding"  pct={top1_concentration_pct} />
            <ConcBar label="Top 3 holdings" pct={top3_concentration_pct} />
            <ConcBar label="Top 5 holdings" pct={top5_concentration_pct} />
          </div>
          <p className="text-[10px] text-slate-700 mt-3">
            top-3 &gt;60% = high risk · &gt;40% = moderate
          </p>
        </div>

        {/* Correlation matrix */}
        {all_symbols.length >= 2 && (
          <div className="card overflow-hidden">
            <div className="flex items-center gap-3 mb-3">
              <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Correlations</p>
              <div className="flex items-center gap-2 text-[10px] text-slate-600 ml-auto">
                <span><span className="text-red-400">■</span> correlated</span>
                <span><span className="text-emerald-400">■</span> diversified</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table
                className="text-[11px]"
                style={{ borderCollapse: 'separate', borderSpacing: 2 }}
              >
                <thead>
                  <tr>
                    <th style={{ width: 52, minWidth: 52 }} />
                    {all_symbols.map(s => (
                      <th
                        key={s}
                        className="text-slate-500 font-medium text-center"
                        style={{ width: 52, minWidth: 52, paddingBottom: 4, fontSize: 10 }}
                      >
                        {s.length > 6 ? s.slice(0, 5) : s}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {all_symbols.map(sa => (
                    <tr key={sa}>
                      <td
                        className="text-slate-500 font-medium text-right"
                        style={{ paddingRight: 6, fontSize: 10, minWidth: 52 }}
                      >
                        {sa.length > 6 ? sa.slice(0, 5) : sa}
                      </td>
                      {all_symbols.map(sb => {
                        const isDiag = sa === sb
                        const c = isDiag ? 1 : (corrMap[`${sa}:${sb}`] ?? corrMap[`${sb}:${sa}`])
                        return (
                          <td
                            key={sb}
                            title={c != null ? `${sa} / ${sb}: ${c.toFixed(3)}` : ''}
                            className="text-center font-semibold tabular-nums"
                            style={{
                              backgroundColor: isDiag ? 'rgba(51,65,85,0.35)' : corrBg(c),
                              color: isDiag ? '#64748b' : '#f1f5f9',
                              width: 52,
                              height: 30,
                              borderRadius: 4,
                              opacity: isDiag ? 0.6 : 1,
                            }}
                          >
                            {isDiag ? '—' : c != null ? c.toFixed(2) : '—'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Footnote ── */}
      <p className="text-[10px] text-slate-700 px-0.5">
        VaR: historical simulation · Sharpe &amp; Sortino: ×√252 excess over {risk_free_rate_pct?.toFixed(1)}% RF · Beta: OLS vs SPY
      </p>

    </div>
  )
}
