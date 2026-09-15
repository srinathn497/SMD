import { useState } from 'react'
import { Plus } from 'lucide-react'
import PLSummary from '../components/portfolio/PLSummary'
import HoldingsTable from '../components/portfolio/HoldingsTable'
import AddTradeModal from '../components/portfolio/AddTradeModal'
import RiskDashboard from '../components/portfolio/RiskDashboard'
import { useTransactions } from '../api/portfolio'

function TransactionHistory() {
  const { data: txs, isLoading } = useTransactions()
  if (isLoading) return <div className="card animate-pulse h-24" />
  if (!txs?.length) return null
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-700">
        <h3 className="font-semibold text-slate-200">Transaction History</h3>
      </div>
      <div className="max-h-64 overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 uppercase border-b border-dark-700">
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">Symbol</th>
              <th className="px-4 py-2 text-left">Side</th>
              <th className="px-4 py-2 text-right">Qty</th>
              <th className="px-4 py-2 text-right">Price</th>
              <th className="px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {txs.map(t => (
              <tr key={t.id} className="border-b border-dark-700/50">
                <td className="px-4 py-2 text-slate-500">{new Date(t.traded_at).toLocaleDateString()}</td>
                <td className="px-4 py-2 text-slate-300 font-medium">{t.symbol}</td>
                <td className={`px-4 py-2 font-semibold ${t.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {t.side}
                </td>
                <td className="px-4 py-2 text-right text-slate-400">{t.quantity}</td>
                <td className="px-4 py-2 text-right text-slate-400">${t.price}</td>
                <td className="px-4 py-2 text-right text-slate-300">${t.total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Portfolio() {
  const [modalOpen, setModalOpen] = useState(false)
  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Portfolio</h2>
          <p className="text-slate-500 text-sm mt-1">Holdings and transaction history</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setModalOpen(true)}>
          <Plus size={16} /> Add Trade
        </button>
      </div>
      <PLSummary />
      <HoldingsTable />
      <RiskDashboard />
      <TransactionHistory />
      <AddTradeModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
