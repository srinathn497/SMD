import AlertList from '../components/alerts/AlertList'
import CreateAlertForm from '../components/alerts/CreateAlertForm'
import { useWatchlist } from '../api/alerts'
import { useAddToWatchlist, useRemoveFromWatchlist } from '../api/alerts'
import { useMarketStore } from '../store/marketStore'
import { useNavigate } from 'react-router-dom'
import { Trash2, Plus } from 'lucide-react'
import { useState } from 'react'
import toast from 'react-hot-toast'

function WatchlistPanel() {
  const { data: items } = useWatchlist()
  const addItem = useAddToWatchlist()
  const removeItem = useRemoveFromWatchlist()
  const setSymbol = useMarketStore(s => s.setSymbol)
  const navigate = useNavigate()
  const [sym, setSym] = useState('')
  const [type, setType] = useState('stock')

  const onAdd = () => {
    if (!sym.trim()) return
    addItem.mutate(
      { symbol: sym.toUpperCase(), asset_type: type },
      {
        onSuccess: () => { toast.success(`${sym.toUpperCase()} added to watchlist`); setSym('') },
        onError: () => toast.error('Already in watchlist'),
      }
    )
  }

  return (
    <div className="card">
      <h3 className="font-semibold text-slate-200 mb-4">Watchlist</h3>
      <div className="flex gap-2 mb-4">
        <input className="input flex-1" placeholder="Symbol" value={sym} onChange={e => setSym(e.target.value)} />
        <select className="input w-28" value={type} onChange={e => setType(e.target.value)}>
          <option value="stock">Stock</option>
          <option value="crypto">Crypto</option>
        </select>
        <button className="btn-primary" onClick={onAdd}><Plus size={15} /></button>
      </div>
      <div className="space-y-1">
        {items?.map(item => (
          <div key={item.id} className="flex items-center justify-between px-1 py-1.5 hover:bg-dark-700/30 rounded">
            <button
              className="flex-1 text-left text-sm font-medium text-slate-200"
              onClick={() => { setSymbol(item.symbol, item.asset_type); navigate('/market') }}
            >
              {item.symbol}
              <span className="ml-2 text-xs text-slate-600">{item.asset_type}</span>
            </button>
            <button
              className="p-1 text-slate-600 hover:text-red-400"
              onClick={() => removeItem.mutate(item.id, { onSuccess: () => toast.success('Removed') })}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {!items?.length && <p className="text-sm text-slate-600">No symbols yet.</p>}
      </div>
    </div>
  )
}

export default function Alerts() {
  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">Alerts</h2>
        <p className="text-slate-500 text-sm mt-1">Price alerts and watchlist management</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <AlertList />
        </div>
        <div className="space-y-4">
          <CreateAlertForm />
          <WatchlistPanel />
        </div>
      </div>
    </div>
  )
}
