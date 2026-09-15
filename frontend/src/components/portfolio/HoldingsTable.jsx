import { useHoldings } from '../../api/portfolio'
import { useMarketStore } from '../../store/marketStore'
import { useNavigate } from 'react-router-dom'

export default function HoldingsTable() {
  const { data: holdings, isPending } = useHoldings()
  const setSymbol = useMarketStore(s => s.setSymbol)
  const navigate = useNavigate()

  if (isPending) return <div className="card animate-pulse h-32" />
  if (!holdings?.length) return (
    <div className="card text-center text-slate-500 py-8">No holdings yet. Add a trade to get started.</div>
  )

  return (
    <div className="card p-0 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-dark-700 text-slate-500 text-xs uppercase">
            <th className="px-4 py-3 text-left">Symbol</th>
            <th className="px-4 py-3 text-right">Qty</th>
            <th className="px-4 py-3 text-right">Avg Cost</th>
            <th className="px-4 py-3 text-right">Current</th>
            <th className="px-4 py-3 text-right">Value</th>
            <th className="px-4 py-3 text-right">P&L</th>
            <th className="px-4 py-3 text-right">P&L %</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
            const isPos = h.unrealized_pnl >= 0
            return (
              <tr
                key={h.symbol}
                className="border-b border-dark-700/50 hover:bg-dark-700/30 cursor-pointer"
                onClick={() => { setSymbol(h.symbol, h.asset_type); navigate('/market') }}
              >
                <td className="px-4 py-3 font-medium text-slate-200">
                  {h.symbol}
                  <span className="ml-2 text-xs text-slate-600">{h.asset_type}</span>
                </td>
                <td className="px-4 py-3 text-right text-slate-400">{h.quantity}</td>
                <td className="px-4 py-3 text-right text-slate-400">${h.avg_buy_price.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-300">${h.current_price.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-300">${h.current_value.toLocaleString()}</td>
                <td className={`px-4 py-3 text-right font-medium ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isPos ? '+' : ''}${h.unrealized_pnl.toLocaleString()}
                </td>
                <td className={`px-4 py-3 text-right ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isPos ? '+' : ''}{h.unrealized_pnl_pct}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
