import { useForm } from 'react-hook-form'
import { useCreateAlert } from '../../api/alerts'
import toast from 'react-hot-toast'

const CONDITIONS = [
  // Price
  { value: 'PRICE_ABOVE',      label: '📈 Price Above',                   needsThreshold: true,  group: 'Price' },
  { value: 'PRICE_BELOW',      label: '📉 Price Below',                   needsThreshold: true,  group: 'Price' },
  { value: 'PRICE_TARGET',     label: '🎯 Price Reaches Target',          needsThreshold: true,  group: 'Price' },
  // Technical
  { value: 'RSI_OVERBOUGHT',   label: '🔴 RSI Overbought (>70)',          needsThreshold: false, group: 'Technical' },
  { value: 'RSI_OVERSOLD',     label: '🟢 RSI Oversold (<30)',            needsThreshold: false, group: 'Technical' },
  { value: 'SIGNAL_CHANGE',    label: '🔀 Signal Change (non-Hold)',      needsThreshold: false, group: 'Technical' },
  { value: 'SIGNAL_BUY',       label: '✅ Signal Turns BUY',             needsThreshold: false, group: 'Technical' },
  { value: 'SIGNAL_SELL',      label: '🚨 Signal Turns SELL',            needsThreshold: false, group: 'Technical' },
  // ML
  { value: 'ML_PREDICT_UP',    label: '🤖 ML Predicts UP (≥70% conf.)',  needsThreshold: false, group: 'ML' },
  { value: 'ML_PREDICT_DOWN',  label: '🤖 ML Predicts DOWN (≥70% conf.)', needsThreshold: false, group: 'ML' },
  // Sentiment
  { value: 'SENTIMENT_NEGATIVE', label: '📰 Sentiment Turns Negative',   needsThreshold: false, group: 'News' },
]

export default function CreateAlertForm() {
  const { register, handleSubmit, watch, reset } = useForm({ defaultValues: { condition: 'PRICE_ABOVE' } })
  const createAlert = useCreateAlert()
  const condition = watch('condition')
  const needsThreshold = CONDITIONS.find(c => c.value === condition)?.needsThreshold ?? false

  const onSubmit = (data) => {
    const payload = {
      ...data,
      threshold: data.threshold ? parseFloat(data.threshold) : null,
    }
    createAlert.mutate(payload, {
      onSuccess: () => { toast.success('Alert created!'); reset() },
      onError: (e) => toast.error(e.response?.data?.detail || 'Failed'),
    })
  }

  return (
    <div className="card">
      <h3 className="font-semibold text-slate-200 mb-4">Create Alert</h3>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Symbol</label>
            <input className="input" placeholder="AAPL or BTC/USDT" {...register('symbol', { required: true })} />
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
          <label className="label">Condition</label>
          <select className="input" {...register('condition')}>
            {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        {needsThreshold && (
          <div>
            <label className="label">Threshold ($)</label>
            <input className="input" type="number" step="any" {...register('threshold')} />
          </div>
        )}
        <div>
          <label className="label">Note (optional)</label>
          <input className="input" placeholder="My alert note" {...register('message')} />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={createAlert.isPending}>
          {createAlert.isPending ? 'Creating...' : 'Create Alert'}
        </button>
      </form>
    </div>
  )
}
