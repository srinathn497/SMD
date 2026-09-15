import { useOptionsFlow } from '../../api/signals'
import Tooltip from '../ui/Tooltip'
import Badge, { toneFromSignal } from '../ui/Badge'
import ExpandableSection from '../ui/ExpandableSection'

// ── Metric row (label | value | signal badge) ─────────────────────────────────
function MetricRow({ label, value, color, opinion, tooltip, convictionSignal }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-dark-600/30 last:border-0">
      <Tooltip text={tooltip} wide>
        <span className="text-xs text-slate-500 cursor-help underline decoration-dotted decoration-slate-600 w-28 shrink-0">
          {label}
        </span>
      </Tooltip>
      <span className={`text-sm font-semibold tabular-nums flex-1 ${color}`}>{value}</span>
      <div className="flex items-center gap-1.5">
        {convictionSignal && (
          <Tooltip text="This metric feeds into the Conviction Score as a directional signal">
            <span className="text-[9px] text-slate-600 cursor-help">CONV</span>
          </Tooltip>
        )}
        <Badge tone={opinion ? toneFromSignal(opinion) : 'neutral'} size="sm">{opinion ?? '—'}</Badge>
      </div>
    </div>
  )
}

// ── Derive opinions from raw data (mirrors conviction.py thresholds) ───────────
function deriveOpinions(data) {
  const pcOI  = data.put_call_oi_ratio
  const pcVol = data.put_call_vol_ratio
  const skew  = data.iv_skew_pct
  const dist  = data.max_pain_distance_pct

  return {
    pcOI:  pcOI < 0.7  ? 'BUY' : pcOI > 1.3  ? 'SELL' : null,
    pcVol: pcVol < 0.7 ? 'BUY' : pcVol > 1.3 ? 'SELL' : null,
    skew:  skew < -2.0 ? 'BUY' : skew > 2.0  ? 'SELL' : null,
    pain:  dist > 0.5  ? 'BUY' : dist < -0.5 ? 'SELL' : null,
  }
}

function ivLevelLabel(iv) {
  if (iv < 20) return { label: 'Low',    color: 'text-slate-400' }
  if (iv < 40) return { label: 'Medium', color: 'text-yellow-400' }
  return              { label: 'High',   color: 'text-red-400' }
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function OptionsFlowPanel({ symbol, assetType }) {
  const { data, isPending, isError } = useOptionsFlow(symbol, assetType)

  if (assetType === 'crypto' || !symbol) return null

  if (isPending) {
    return (
      <div className="card py-2.5 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-slate-600 animate-pulse" />
        <span className="text-xs text-slate-600">Loading options flow…</span>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="card py-2.5">
        <span className="text-xs text-slate-600">Options data unavailable for {symbol}</span>
      </div>
    )
  }

  const opinions = deriveOpinions(data)
  const ivInfo   = ivLevelLabel(data.atm_iv_pct)

  // Summary line for collapsed state
  const bullish = Object.values(opinions).filter(o => o === 'BUY').length
  const bearish = Object.values(opinions).filter(o => o === 'SELL').length
  const summaryColor = bullish > bearish ? 'text-emerald-400' : bearish > bullish ? 'text-red-400' : 'text-slate-400'
  const summaryText  = bullish > bearish ? `${bullish} bullish` : bearish > bullish ? `${bearish} bearish` : 'neutral'

  return (
    <div className="card">
      <ExpandableSection
        trigger={(open) => (
          <div className="flex items-center gap-3">
            <Tooltip
              text="Options Flow — derived from the nearest-expiry options chain. Signals 8–11 in the Conviction Score. Cached 30 min."
              wide
            >
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-help underline decoration-dotted decoration-slate-600">
                Options Flow
              </span>
            </Tooltip>
            {!open && (
              <span className={`text-xs font-medium ${summaryColor}`}>
                · {summaryText} ({bullish}↑ / {bearish}↓)
              </span>
            )}
          </div>
        )}
      >
          <p className="text-[10px] text-slate-600 mb-2 uppercase tracking-wider">
            Signals 8–11 feed into conviction score · CONV = conviction input · expiry: {data.expiration}
          </p>

          <MetricRow
            label="P/C OI Ratio"
            value={data.put_call_oi_ratio.toFixed(2)}
            color={opinions.pcOI === 'BUY' ? 'text-emerald-400' : opinions.pcOI === 'SELL' ? 'text-red-400' : 'text-slate-400'}
            opinion={opinions.pcOI}
            convictionSignal
            tooltip={
              'Put/Call Open Interest Ratio — total put OI ÷ total call OI.\n\n' +
              '< 0.7 → calls dominate → bullish institutional positioning\n' +
              '> 1.3 → puts dominate → hedging / bearish\n' +
              '0.7–1.3 → neutral\n\n' +
              'Feeds into Conviction Score as Signal 8.'
            }
          />

          <MetricRow
            label="Max Pain"
            value={`${data.max_pain_distance_pct >= 0 ? '+' : ''}${data.max_pain_distance_pct.toFixed(1)}% ($${data.max_pain_strike.toFixed(2)})`}
            color={opinions.pain === 'BUY' ? 'text-emerald-400' : opinions.pain === 'SELL' ? 'text-red-400' : 'text-slate-400'}
            opinion={opinions.pain}
            convictionSignal
            tooltip={
              `Max Pain: $${data.max_pain_strike.toFixed(2)} — strike that causes max loss to option holders at expiry.\n\n` +
              'Price tends to gravitate toward max pain as expiration approaches (MM delta hedging).\n\n' +
              '> +0.5% → bullish pull  |  < −0.5% → bearish pull\n\n' +
              'Feeds into Conviction Score as Signal 9.'
            }
          />

          <MetricRow
            label="IV Skew"
            value={`${data.iv_skew_pct >= 0 ? '+' : ''}${data.iv_skew_pct.toFixed(1)}pp`}
            color={opinions.skew === 'BUY' ? 'text-emerald-400' : opinions.skew === 'SELL' ? 'text-red-400' : 'text-slate-400'}
            opinion={opinions.skew}
            convictionSignal
            tooltip={
              'IV Skew — ATM put IV minus ATM call IV (percentage points).\n\n' +
              'Positive → puts more expensive → fear/hedging premium → bearish\n' +
              'Negative → calls more expensive → unusual call demand → bullish\n' +
              'Within ±2pp → balanced\n\n' +
              'Feeds into Conviction Score as Signal 10.'
            }
          />

          <MetricRow
            label="P/C Volume"
            value={data.put_call_vol_ratio.toFixed(2)}
            color={opinions.pcVol === 'BUY' ? 'text-emerald-400' : opinions.pcVol === 'SELL' ? 'text-red-400' : 'text-slate-400'}
            opinion={opinions.pcVol}
            convictionSignal
            tooltip={
              "Put/Call Volume Ratio — today's put volume ÷ today's call volume.\n\n" +
              'Reflects same-session sentiment — more reactive than OI (which is historical).\n\n' +
              '< 0.7 → bullish flow  |  > 1.3 → bearish/hedging flow\n\n' +
              'Feeds into Conviction Score as Signal 11.'
            }
          />

          <MetricRow
            label="ATM IV"
            value={`${data.atm_iv_pct.toFixed(1)}% (${ivInfo.label})`}
            color={ivInfo.color}
            opinion={null}
            convictionSignal={false}
            tooltip={
              'ATM Implied Volatility (annualised %) — the market\'s expected annual move priced into ATM options.\n\n' +
              '< 20% → Low — cheap options, calm expectations\n' +
              '20–40% → Medium — normal uncertainty\n' +
              '> 40% → High — expensive options, fear or event risk\n\n' +
              'Informational only — does not feed into Conviction Score.'
            }
          />
      </ExpandableSection>
    </div>
  )
}
