import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { useConviction } from '../../api/signals'
import Tooltip from '../ui/Tooltip'
import Ring from '../ui/Ring'
import ExpandableSection from '../ui/ExpandableSection'

// ── Label config ──────────────────────────────────────────────────────────────
const LABEL_CONFIG = {
  HIGH_CONVICTION: {
    ring:        'ring-yellow-500/60',
    bg:          'bg-yellow-500/10 border-yellow-500/25',
    text:        'text-yellow-400',
    bar:         'bg-yellow-500',
    strokeColor: '#eab308',   // yellow-500
    badge:       'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    emoji:       '🔥',
  },
  MODERATE: {
    ring:        'ring-brand-500/60',
    bg:          'bg-brand-500/10 border-brand-500/25',
    text:        'text-brand-500',
    bar:         'bg-brand-500',
    strokeColor: '#35d07f',   // brand-500 (green)
    badge:       'bg-brand-500/15 text-brand-500 border-brand-500/30',
    emoji:       '⚡',
  },
  WEAK: {
    ring:        'ring-orange-500/50',
    bg:          'bg-orange-500/10 border-orange-500/20',
    text:        'text-orange-400',
    bar:         'bg-orange-500',
    strokeColor: '#f97316',   // orange-500
    badge:       'bg-orange-500/15 text-orange-400 border-orange-500/30',
    emoji:       '〰',
  },
  NEUTRAL: {
    ring:        'ring-slate-600/40',
    bg:          'bg-dark-700/60 border-dark-600',
    text:        'text-slate-500',
    bar:         'bg-slate-600',
    strokeColor: '#475569',   // slate-600
    badge:       'bg-dark-700 text-slate-500 border-dark-600',
    emoji:       '—',
  },
}

const DIR_COLOR = {
  BUY:     'text-emerald-400',
  SELL:    'text-red-400',
  NEUTRAL: 'text-slate-500',
}

// ── Human-readable combined label ─────────────────────────────────────────────
const HUMAN_LABEL = {
  HIGH_CONVICTION: {
    BUY:     '🔥 Strong Bullish Signal',
    SELL:    '🔥 Strong Bearish Signal',
    NEUTRAL: '🔥 Strong Signal',
  },
  MODERATE: {
    BUY:     '⚡ Moderately Bullish',
    SELL:    '⚡ Moderately Bearish',
    NEUTRAL: '⚡ Moderate Signal',
  },
  WEAK: {
    BUY:     '〰 Slightly Bullish',
    SELL:    '〰 Slightly Bearish',
    NEUTRAL: '〰 Weak Signal',
  },
  NEUTRAL: {
    BUY:     '— No Clear Direction',
    SELL:    '— No Clear Direction',
    NEUTRAL: '— No Clear Direction',
  },
}

const SCORE_TIPS =
  'What does this score mean?\n\n' +
  'We run up to 17 independent checks (indicators) on this stock.\n' +
  'Each one votes: "price is going UP" or "price is going DOWN".\n' +
  'The score = how many agree on the same direction.\n\n' +
  '🔥 Strong Signal     ≥ 78% agreement — high confidence\n' +
  '⚡ Moderately Bullish/Bearish  ≥ 55% — decent agreement\n' +
  '〰 Slightly Bullish/Bearish    ≥ 28% — early or mixed signal\n' +
  '—  No Clear Direction          < 28% — signals cancel out\n\n' +
  'Important: signals are weighted by past accuracy.\n' +
  'A reliable indicator counts more than an unreliable one,\n' +
  'so the label can differ from what the raw count suggests.\n\n' +
  'The 17 indicators checked:\n' +
  '  1. Technical (RSI, MACD, Bollinger Bands, EMA)\n' +
  '  2. Daily AI model (predicts next-day direction)\n' +
  '  3. 15-min AI model (intraday direction)\n' +
  '  4. News sentiment (recent headlines)\n' +
  '  5. Volume (unusual buying/selling activity)\n' +
  '  6. Intraday timing signal\n' +
  '  7. Intraday composite score\n' +
  '  8. Options Put/Call ratio (what big traders are betting)\n' +
  '  9. Max Pain (price level where most options expire worthless)\n' +
  ' 10. IV Skew (demand for calls vs puts)\n' +
  ' 11. Options volume positioning\n' +
  ' 12. Breakout + Momentum (price breaking key levels with volume)\n' +
  ' 13. Mean Reversion (stock stretched too far up or down)\n' +
  ' 14. Fundamental Health (earnings, revenue, balance sheet)\n' +
  ' 15. FCF Yield (free cash flow vs stock price)\n' +
  ' 16. Debt/Equity (how leveraged the company is)\n' +
  ' 17. P/E Valuation (cheap vs expensive vs sector)'

// ── Signal row ────────────────────────────────────────────────────────────────
function SignalRow({ signal }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5 border-b border-dark-700/50 last:border-0">
      {signal.passed
        ? <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
        : <XCircle size={14} className="text-slate-600 flex-shrink-0 mt-0.5" />
      }
      <div className="flex-1 min-w-0">
        <span className={`text-xs font-medium ${signal.passed ? 'text-slate-200' : 'text-slate-500'}`}>
          {signal.name}
        </span>
        <p className={`text-xs mt-0.5 leading-snug ${signal.passed ? 'text-slate-400' : 'text-slate-600'}`}>
          {signal.detail}
        </p>
      </div>
    </div>
  )
}

// ── Why line generator ────────────────────────────────────────────────────────
function buildWhyLine(data) {
  const { score, max_score, direction, label, signals } = data
  if (direction === 'NEUTRAL') return 'Signals are split with no clear majority direction.'

  const passed = signals.filter(s => s.passed).map(s => s.name)
  const failed = signals.filter(s => !s.passed).map(s => s.name)
  const dir    = direction === 'BUY' ? 'bullish' : 'bearish'

  if (label === 'HIGH_CONVICTION') {
    const top = passed.slice(0, 3).join(', ')
    return `${score}/${max_score} signals aligned ${dir} — ${top}${passed.length > 3 ? ` and ${passed.length - 3} more` : ''} all agree.`
  }
  if (label === 'MODERATE') {
    const top     = passed.slice(0, 2).join(', ')
    const missing = failed.slice(0, 2).join(', ')
    return `${score}/${max_score} signals ${dir} — ${top} confirm. ${missing ? `${missing} not aligned.` : ''}`
  }
  if (label === 'WEAK') {
    const top     = passed.slice(0, 2).join(' and ') || 'a few signals'
    const missing = failed.length
    return `Only ${score}/${max_score} signals ${dir} — ${top} lean this way, but ${missing} signal${missing !== 1 ? 's' : ''} disagree or are neutral.`
  }
  return `${score}/${max_score} signals — no strong consensus.`
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ConvictionBadge({ symbol, assetType }) {
  const { data, isPending, isError } = useConviction(symbol, assetType)

  if (!symbol) return null

  if (isPending) {
    return (
      <div className="card flex items-center gap-3 py-3">
        <Loader2 size={15} className="animate-spin text-brand-400" />
        <span className="text-sm text-slate-500">Computing conviction score…</span>
      </div>
    )
  }

  if (isError || !data) return null

  const cfg = LABEL_CONFIG[data.label] ?? LABEL_CONFIG.NEUTRAL
  const baseLabel = HUMAN_LABEL[data.label]?.[data.direction] ?? data.label.replace(/_/g, ' ')
  const confPct = data.confidence_pct ?? 0
  const humanLabel = data.label === 'NEUTRAL'
    ? baseLabel
    : `${baseLabel} — ${confPct.toFixed(1)}% confidence`
  const dirWord = data.direction === 'BUY' ? 'bullish' : data.direction === 'SELL' ? 'bearish' : 'aligned'
  const scoreDesc = data.direction === 'NEUTRAL'
    ? `${data.score} of ${data.max_score} indicators — no clear direction`
    : `${data.score} of ${data.max_score} indicators lean ${dirWord}`

  return (
    <div className={`card border ${cfg.bg} transition-all`}>
      <ExpandableSection
        trigger={
          <div className="flex items-center gap-4">
            <Ring
              value={data.score}
              max={data.max_score}
              size={64}
              radius={22}
              strokeWidth={3}
              color={cfg.strokeColor}
              ringClassName={`ring-2 ${cfg.ring}`}
              textClassName={`text-lg ${cfg.text}`}
            />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Tooltip text={SCORE_TIPS} wide>
                  <span className={`text-lg font-bold cursor-help underline decoration-dotted decoration-slate-600 ${cfg.text}`}>
                    {humanLabel}
                  </span>
                </Tooltip>
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                {/* Score bar */}
                <div className="flex-1 h-1.5 bg-dark-600 rounded-full overflow-hidden max-w-40">
                  <div
                    className={`h-full rounded-full transition-all ${cfg.bar}`}
                    style={{ width: `${(data.score / data.max_score) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-slate-500">{scoreDesc}</span>
              </div>
              <p className="text-xs text-slate-500 mt-1.5 leading-snug">
                {buildWhyLine(data)}
              </p>
            </div>
          </div>
        }
      >
        <p className="text-xs text-slate-600 mb-2">Signal breakdown — each row is one independent vote</p>
        {data.signals.map(s => (
          <SignalRow key={s.name} signal={s} />
        ))}
      </ExpandableSection>
    </div>
  )
}
