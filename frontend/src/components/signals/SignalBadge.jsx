export default function SignalBadge({ signal, size = 'sm' }) {
  const cfg = {
    BUY:  'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    SELL: 'bg-red-500/20 text-red-400 border border-red-500/30',
    HOLD: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    UP:   'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    DOWN: 'bg-red-500/20 text-red-400 border border-red-500/30',
  }
  const sz = size === 'lg' ? 'px-3 py-1 text-sm font-bold' : 'px-2 py-0.5 text-xs font-semibold'
  return (
    <span className={`rounded-full ${sz} ${cfg[signal] ?? 'bg-slate-700 text-slate-300'}`}>
      {signal}
    </span>
  )
}
