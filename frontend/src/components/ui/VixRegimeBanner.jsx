import { AlertTriangle, TrendingUp, TrendingDown, Minus, ShieldAlert, Zap } from 'lucide-react'
import { useVixRegime } from '../../api/market'

// ── Regime config ──────────────────────────────────────────────────────────────

const REGIME_CONFIG = {
  CRISIS: {
    bg:      'bg-red-950/80 border-red-600/60',
    Icon:    ShieldAlert,
    iconCls: 'text-red-400',
    titleCls:'text-red-300',
    textCls: 'text-red-200',
    vixCls:  'text-red-300',
    badgeBg: 'bg-red-900/60 border-red-700/50',
    show:    true,
  },
  PANIC: {
    bg:      'bg-red-900/60 border-red-500/50',
    Icon:    AlertTriangle,
    iconCls: 'text-red-400',
    titleCls:'text-red-200',
    textCls: 'text-red-200/80',
    vixCls:  'text-red-300',
    badgeBg: 'bg-red-900/40 border-red-700/40',
    show:    true,
  },
  HIGH: {
    bg:      'bg-orange-900/40 border-orange-500/40',
    Icon:    AlertTriangle,
    iconCls: 'text-orange-400',
    titleCls:'text-orange-200',
    textCls: 'text-orange-200/80',
    vixCls:  'text-orange-300',
    badgeBg: 'bg-orange-900/30 border-orange-700/30',
    show:    true,
  },
  ELEVATED: {
    bg:      'bg-yellow-900/30 border-yellow-600/30',
    Icon:    Zap,
    iconCls: 'text-yellow-400',
    titleCls:'text-yellow-200',
    textCls: 'text-yellow-200/70',
    vixCls:  'text-yellow-300',
    badgeBg: 'bg-yellow-900/20 border-yellow-700/20',
    show:    true,
  },
  NORMAL:  { show: false },
  CALM:    { show: false },
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function VixChangeBadge({ change }) {
  if (change == null) return null
  const rising  = change > 5
  const falling = change < -5
  const Icon    = rising ? TrendingUp : falling ? TrendingDown : Minus
  const color   = rising ? 'text-red-400' : falling ? 'text-emerald-400' : 'text-slate-400'
  const label   = `${change > 0 ? '+' : ''}${change.toFixed(1)}% 5d`
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon size={11} />
      {label}
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function VixRegimeBanner({ compact = false }) {
  const { data, isPending } = useVixRegime()

  if (isPending || !data) return null
  const cfg = REGIME_CONFIG[data.regime]
  if (!cfg?.show) return null

  const { Icon, bg, iconCls, titleCls, textCls, vixCls, badgeBg } = cfg

  if (compact) {
    return (
      <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-xs ${bg}`}>
        <Icon size={14} className={iconCls} />
        <span className={`font-semibold ${titleCls}`}>{data.title}</span>
        <span className={`font-black tabular-nums ${vixCls}`}>VIX {data.vix_level}</span>
        <VixChangeBadge change={data.vix_change_5d} />
        <span className={`hidden sm:inline ${textCls}`}>· {data.action}</span>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${bg}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Icon size={18} className={iconCls} />
          <span className={`font-bold text-sm ${titleCls}`}>{data.title}</span>
        </div>

        {/* VIX level + 5d change */}
        <div className={`flex items-center gap-3 px-3 py-1.5 rounded-lg border ${badgeBg}`}>
          <div className="text-center">
            <p className={`text-2xl font-black tabular-nums leading-none ${vixCls}`}>
              {data.vix_level}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">VIX</p>
          </div>
          <VixChangeBadge change={data.vix_change_5d} />
        </div>
      </div>

      {/* Message */}
      <p className={`text-sm ${textCls}`}>{data.message}</p>

      {/* Action */}
      <div className={`flex items-start gap-2 text-xs rounded-lg border px-3 py-2 ${badgeBg}`}>
        <span className={`font-semibold ${titleCls} shrink-0`}>What to do:</span>
        <span className={textCls}>{data.action}</span>
      </div>

      {/* Predictions suppressed notice */}
      {data.predictions_suppressed && (
        <p className="text-xs text-red-300/70 border-t border-red-700/30 pt-2">
          ⚠ ML predictions are suppressed while VIX &gt; 30. The model was not trained on panic-regime data and would produce unreliable signals. Predictions will resume automatically when VIX normalises below 30.
        </p>
      )}
    </div>
  )
}
