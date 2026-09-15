import { Trash2, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react'
import { useAlerts, useDeleteAlert, useResetAlert } from '../../api/alerts'
import toast from 'react-hot-toast'

export default function AlertList() {
  const { data: alerts, isPending } = useAlerts()
  const deleteAlert = useDeleteAlert()
  const resetAlert = useResetAlert()

  if (isPending) return <div className="card animate-pulse h-32" />
  if (!alerts?.length) return (
    <div className="card text-center text-slate-500 py-8">No alerts set. Create one below.</div>
  )

  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <div key={a.id} className={`card flex items-center gap-3 ${a.is_triggered ? 'border border-amber-500/30' : ''}`}>
          <div className="shrink-0">
            {a.is_triggered
              ? <AlertTriangle size={18} className="text-amber-400" />
              : <CheckCircle size={18} className="text-emerald-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-200">{a.symbol}</span>
              <span className="text-xs bg-dark-700 text-slate-400 px-2 py-0.5 rounded">{a.condition}</span>
              {a.threshold != null && <span className="text-xs text-slate-500">@ {a.threshold}</span>}
            </div>
            {a.message && <p className="text-xs text-slate-500 mt-0.5">{a.message}</p>}
            {a.is_triggered && (
              <p className="text-xs text-amber-400 mt-0.5">
                Triggered @ ${a.triggered_price} on {new Date(a.triggered_at).toLocaleString()}
              </p>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            {a.is_triggered && (
              <button
                className="p-1.5 text-slate-500 hover:text-slate-300 rounded"
                onClick={() => resetAlert.mutate(a.id, { onSuccess: () => toast.success('Alert reset') })}
                title="Reset alert"
              >
                <RefreshCw size={14} />
              </button>
            )}
            <button
              className="p-1.5 text-slate-500 hover:text-red-400 rounded"
              onClick={() => deleteAlert.mutate(a.id, { onSuccess: () => toast.success('Alert deleted') })}
              title="Delete alert"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
