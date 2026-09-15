import PLSummary from '../components/portfolio/PLSummary'
import MarketHeatmap from '../components/dashboard/MarketHeatmap'
import VixRegimeBanner from '../components/ui/VixRegimeBanner'
import { useAlerts } from '../api/alerts'
import { useHoldings } from '../api/portfolio'
import SignalBadge from '../components/signals/SignalBadge'
import { useMarketStore } from '../store/marketStore'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'

function TriggeredAlertsWidget() {
  const { data: alerts } = useAlerts()
  const triggered = alerts?.filter(a => a.is_triggered) ?? []
  if (!triggered.length) return null
  return (
    <div className="card border border-amber-500/30">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={16} className="text-amber-400" />
        <h3 className="font-semibold text-amber-300">Triggered Alerts</h3>
      </div>
      <div className="space-y-2">
        {triggered.slice(0, 5).map(a => (
          <div key={a.id} className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-200">{a.symbol}</span>
            <span className="text-xs text-slate-500">{a.condition}</span>
            <span className="text-amber-400">${a.triggered_price}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TopHoldingsWidget() {
  const { data: holdings } = useHoldings()
  const setSymbol = useMarketStore(s => s.setSymbol)
  const navigate = useNavigate()
  if (!holdings?.length) return (
    <div className="card">
      <h3 className="font-semibold text-slate-200 mb-3">Top Holdings</h3>
      <p className="text-sm text-slate-500">No holdings yet.</p>
    </div>
  )
  return (
    <div className="card">
      <h3 className="font-semibold text-slate-200 mb-3">Top Holdings</h3>
      <div className="space-y-2">
        {holdings.slice(0, 5).map(h => {
          const isPos = h.unrealized_pnl >= 0
          return (
            <div
              key={h.symbol}
              className="flex items-center justify-between cursor-pointer hover:bg-dark-700/30 rounded px-1 py-0.5"
              onClick={() => { setSymbol(h.symbol, h.asset_type); navigate('/market') }}
            >
              <span className="font-medium text-slate-200">{h.symbol}</span>
              <div className="text-right">
                <span className={`text-sm font-medium ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isPos ? '+' : ''}{h.unrealized_pnl_pct}%
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Dashboard() {
  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">Dashboard</h2>
        <p className="text-slate-500 text-sm mt-1">Portfolio overview and live alerts</p>
      </div>
      <VixRegimeBanner />
      <PLSummary />
      <MarketHeatmap />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TopHoldingsWidget />
        <TriggeredAlertsWidget />
      </div>
    </div>
  )
}
