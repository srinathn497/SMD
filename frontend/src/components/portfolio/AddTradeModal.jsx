import { Dialog } from '@headlessui/react'
import { useForm } from 'react-hook-form'
import { useAddTransaction } from '../../api/portfolio'
import toast from 'react-hot-toast'

export default function AddTradeModal({ open, onClose }) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm()
  const addTx = useAddTransaction()

  const onSubmit = (data) => {
    addTx.mutate(
      { ...data, quantity: parseFloat(data.quantity), price: parseFloat(data.price), fees: parseFloat(data.fees || 0) },
      {
        onSuccess: () => { toast.success('Trade added!'); reset(); onClose() },
        onError: (e) => toast.error(e.response?.data?.detail || 'Failed to add trade'),
      }
    )
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/60" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="bg-dark-800 border border-dark-700 rounded-xl p-6 w-full max-w-md">
          <Dialog.Title className="text-lg font-semibold text-slate-100 mb-4">Add Trade</Dialog.Title>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Symbol</label>
                <input className="input" placeholder="AAPL" {...register('symbol', { required: true })} />
              </div>
              <div>
                <label className="label">Asset Type</label>
                <select className="input" {...register('asset_type')}>
                  <option value="stock">Stock</option>
                  <option value="crypto">Crypto</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">Side</label>
              <select className="input" {...register('side', { required: true })}>
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Quantity</label>
                <input className="input" type="number" step="any" {...register('quantity', { required: true })} />
              </div>
              <div>
                <label className="label">Price ($)</label>
                <input className="input" type="number" step="any" {...register('price', { required: true })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Fees ($)</label>
                <input className="input" type="number" step="any" defaultValue="0" {...register('fees')} />
              </div>
              <div>
                <label className="label">Date</label>
                <input className="input" type="datetime-local" {...register('traded_at', { required: true })} />
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
              <input className="input" placeholder="Optional" {...register('notes')} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
              <button type="submit" className="btn-primary" disabled={addTx.isPending}>
                {addTx.isPending ? 'Saving...' : 'Add Trade'}
              </button>
            </div>
          </form>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}
