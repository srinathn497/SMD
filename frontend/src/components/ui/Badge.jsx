const TONES = {
  bullish: 'bg-brand-500/10 text-brand-500 border-brand-500/25',
  bearish: 'bg-bad-500/10 text-bad-500 border-bad-500/25',
  neutral: 'bg-slate-500/10 text-slate-400 border-slate-500/25',
  warning: 'bg-warn-500/10 text-warn-500 border-warn-500/25',
}

const SIZES = {
  sm: 'px-2.5 py-1 text-xs',
  lg: 'px-3 py-1 text-sm font-bold',
}

// Maps the domain-specific signal strings used across the app to a canonical tone.
const SIGNAL_TONE = {
  BUY: 'bullish', UP: 'bullish', POSITIVE: 'bullish',
  SELL: 'bearish', DOWN: 'bearish', NEGATIVE: 'bearish',
  HOLD: 'neutral', NEUTRAL: 'neutral',
}

export function toneFromSignal(signal) {
  return SIGNAL_TONE[signal] ?? 'neutral'
}

export default function Badge({ tone = 'neutral', size = 'sm', children, className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-full font-semibold border ticker-num ${TONES[tone] ?? TONES.neutral} ${SIZES[size] ?? SIZES.sm} ${className}`}>
      {children}
    </span>
  )
}
