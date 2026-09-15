import { TrendingUp, TrendingDown, DollarSign, Layers } from 'lucide-react'
import { useSummary } from '../../api/portfolio'

function StatBox({ label, value, sub, positive }) {
  const color = positive === true ? 'text-emerald-400'
    : positive === false ? 'text-red-400' : 'text-slate-200'
  return (
    <div className="card">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function PLSummary() {
  const { data, isPending } = useSummary()
  if (isPending || !data) return <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
    {[...Array(4)].map((_, i) => <div key={i} className="card h-20" />)}
  </div>

  const pnlPos = data.total_pnl >= 0
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatBox label="Total Invested" value={`$${data.total_invested.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
      <StatBox label="Current Value"  value={`$${data.current_value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
      <StatBox
        label="Unrealized P&L"
        value={`${pnlPos ? '+' : ''}$${data.total_pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
        sub={`${pnlPos ? '+' : ''}${data.total_pnl_pct}%`}
        positive={pnlPos}
      />
      <StatBox label="Holdings" value={data.holdings_count} sub="open positions" />
    </div>
  )
}
