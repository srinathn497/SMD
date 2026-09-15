import { CheckCircle2, XCircle, Minus, Users } from 'lucide-react'
import { useFundamentals } from '../../api/fundamentals'
import { useQuote } from '../../api/market'
import Tooltip from '../ui/Tooltip'
import Ring from '../ui/Ring'
import ExpandableSection from '../ui/ExpandableSection'

const HEALTH = {
  STRONG:   { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/25', bar: 'bg-emerald-500', label: '● STRONG'   },
  MODERATE: { color: 'text-yellow-400',  bg: 'bg-yellow-500/10  border-yellow-500/25',  bar: 'bg-yellow-500',  label: '◐ MODERATE' },
  WEAK:     { color: 'text-red-400',     bg: 'bg-red-500/10     border-red-500/25',     bar: 'bg-red-500',     label: '○ WEAK'     },
  UNKNOWN:  { color: 'text-slate-500',   bg: 'bg-dark-700       border-dark-600',       bar: 'bg-slate-600',   label: '— N/A'      },
}

const CRITERIA_LABELS = {
  revenue_growth: 'Revenue growth > 10% YoY',
  eps_growth:     'EPS growth > 10% YoY',
  roe_quality:    'ROE > 15%',
  low_debt:       'Debt/Equity < 1.5',
  positive_fcf:   'Free Cash Flow positive',
  analyst_buy:    'Analyst consensus majority BUY',
}

function fmt(n, d = 1)  { return n == null ? null : n.toFixed(d) }
function fmtPct(n)      { return n == null ? null : `${n > 0 ? '+' : ''}${n.toFixed(1)}%` }
function vc(val, hi, lo) {
  if (val == null) return 'text-slate-500'
  if (hi != null && val > hi) return 'text-emerald-400'
  if (lo != null && val < lo) return 'text-red-400'
  return 'text-slate-100'
}

// ── Section heading ───────────────────────────────────────────────────────────
function Section({ title }) {
  return (
    <div className="flex items-center gap-2 mt-5 mb-0.5 first:mt-0">
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.12em] shrink-0">{title}</span>
      <div className="h-px flex-1 bg-dark-600/60" />
    </div>
  )
}

// ── Data row — Tooltip only on the label span, NOT the whole div ──────────────
function Row({ label, value, color = 'text-slate-100', tooltip }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-dark-700/30 last:border-0">
      {tooltip ? (
        <Tooltip text={tooltip} wide>
          <span className="text-xs text-slate-400 border-b border-dashed border-slate-600/60 cursor-help leading-none">
            {label}
          </span>
        </Tooltip>
      ) : (
        <span className="text-xs text-slate-400 leading-none">{label}</span>
      )}
      <span className={`text-sm font-semibold tabular-nums leading-none ${color}`}>
        {value ?? <span className="text-slate-600 font-normal">—</span>}
      </span>
    </div>
  )
}

// ── Analyst buy/hold/sell bar ─────────────────────────────────────────────────
function AnalystBar({ buy, hold, sell, total }) {
  if (!total) return null
  const bp = Math.round((buy  ?? 0) / total * 100)
  const hp = Math.round((hold ?? 0) / total * 100)
  const sp = Math.round((sell ?? 0) / total * 100)
  return (
    <div className="mt-2.5">
      <div className="flex rounded-full overflow-hidden h-1.5 gap-px">
        {bp > 0 && <div className="bg-emerald-500" style={{ width: `${bp}%` }} />}
        {hp > 0 && <div className="bg-yellow-500"  style={{ width: `${hp}%` }} />}
        {sp > 0 && <div className="bg-red-500"     style={{ width: `${sp}%` }} />}
      </div>
      <div className="flex gap-3 mt-1.5 text-[10px]">
        <span className="text-emerald-400">{buy ?? 0} Buy</span>
        <span className="text-yellow-400">{hold ?? 0} Hold</span>
        <span className="text-red-400">{sell ?? 0} Sell</span>
      </div>
    </div>
  )
}

// ── Criteria checklist ────────────────────────────────────────────────────────
function CriteriaList({ criteria }) {
  return (
    <div className="mt-5 pt-3 border-t border-dark-600/40 space-y-2">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-2.5">Health checks</p>
      {Object.entries(criteria).map(([key, passed]) => (
        <div key={key} className="flex items-center gap-2">
          {passed === true  && <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />}
          {passed === false && <XCircle      size={11} className="text-red-400 shrink-0" />}
          {passed === null  && <Minus        size={11} className="text-slate-600 shrink-0" />}
          <span className={`text-xs ${passed === true ? 'text-slate-300' : passed === false ? 'text-slate-500' : 'text-slate-600'}`}>
            {CRITERIA_LABELS[key] ?? key}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function FundamentalCard({ symbol, assetType }) {
  const { data: quote } = useQuote(symbol, assetType)
  const { data, isPending, isError } = useFundamentals(symbol, assetType, quote?.price)

  if (assetType === 'crypto' || !symbol) return null
  if (isPending) return (
    <div className="card animate-pulse space-y-2">
      <div className="h-4 w-36 bg-dark-700 rounded" />
      {[...Array(3)].map((_, i) => <div key={i} className="h-3 bg-dark-700 rounded" />)}
    </div>
  )
  if (isError || !data) return null

  const cfg      = HEALTH[data.health_label] ?? HEALTH.UNKNOWN
  const c        = data.consensus
  const dirColor = data.health_direction === 'BUY'  ? 'text-emerald-400'
    : data.health_direction === 'SELL' ? 'text-red-400' : 'text-slate-500'

  return (
    <div className={`card border ${cfg.bg} transition-all`}>
      <ExpandableSection
        trigger={
          <div className="flex items-center gap-3">
            <Ring
              value={data.health_score}
              max={6}
              size={48}
              radius={20}
              strokeWidth={3.5}
              color={data.health_direction === 'BUY' ? '#35d07f' : data.health_direction === 'SELL' ? '#ef6a6a' : '#e8b84b'}
              textClassName={`text-sm ${cfg.color}`}
            />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${cfg.color}`}>{cfg.label}</span>
                <span className={`text-xs font-medium ${dirColor}`}>· {data.health_direction}</span>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <div className="flex-1 h-1 bg-dark-600 rounded-full overflow-hidden max-w-28">
                  <div className={`h-full rounded-full transition-all ${cfg.bar}`} style={{ width: `${(data.health_score / 6) * 100}%` }} />
                </div>
                <span className="text-[10px] text-slate-500">{data.health_score}/6</span>
              </div>
              {data.revenue_growth_yoy != null && (
                <p className="text-[10px] text-slate-500 mt-1">
                  Rev {fmtPct(data.revenue_growth_yoy)} YoY
                  {data.net_margin  != null && ` · Margin ${fmt(data.net_margin)}%`}
                  {c.upside_pct     != null && ` · Upside ${fmtPct(c.upside_pct)}`}
                </p>
              )}
            </div>
          </div>
        }
      >
          <Section title="Valuation" />
          <Row label="P/E (trailing)"  value={fmt(data.pe_ratio)}   tooltip="Trailing 12-month P/E. Lower = cheaper vs earnings. Tech avg ~25–35×." />
          <Row label="P/E (forward)"   value={fmt(data.forward_pe)} tooltip="Forward P/E on next-12-month estimates. Forward < trailing = earnings growth expected." />
          <Row label="P/B ratio"       value={fmt(data.pb_ratio)}   tooltip="Price-to-book. < 1 = below asset value. > 3 = growth premium priced in." />
          <Row label="EV/EBITDA"       value={fmt(data.ev_ebitda)}  tooltip="EV / EBITDA. M&A valuation benchmark. < 10 = cheap, > 20 = rich." />
          <Row label="FCF Yield"
            value={data.fcf_yield_pct != null ? `${fmt(data.fcf_yield_pct)}%` : null}
            color={vc(data.fcf_yield_pct, 0, -0.01)}
            tooltip="Free Cash Flow ÷ Market Cap. > 3% = attractive. Negative = burning cash."
          />

          <Section title="Growth" />
          <Row label="Revenue YoY"  value={fmtPct(data.revenue_growth_yoy)}                               color={vc(data.revenue_growth_yoy, 10, 0)} tooltip="YoY revenue growth. > 10% solid, > 20% strong, < 0% declining." />
          <Row label="EPS YoY"      value={fmtPct(data.eps_growth_yoy)}                                   color={vc(data.eps_growth_yoy, 10, 0)}    tooltip="YoY earnings per share growth. Should outpace revenue growth." />
          <Row label="Gross Margin" value={data.gross_margin     != null ? `${fmt(data.gross_margin)}%`     : null} tooltip="Revenue minus COGS. Software/pharma > 60%, manufacturing 20–40%." />
          <Row label="Oper. Margin" value={data.operating_margin != null ? `${fmt(data.operating_margin)}%` : null} tooltip="Operating profit ÷ revenue, before interest and tax." />
          <Row label="Net Margin"   value={data.net_margin       != null ? `${fmt(data.net_margin)}%`       : null} color={vc(data.net_margin, 10, 0)} tooltip="> 10% = good, > 20% = excellent. Negative = unprofitable." />

          <Section title="Balance Sheet" />
          <Row label="Debt / Equity"
            value={fmt(data.debt_to_equity)}
            color={data.debt_to_equity == null ? 'text-slate-500' : data.debt_to_equity > 2 ? 'text-red-400' : data.debt_to_equity < 1 ? 'text-emerald-400' : 'text-slate-100'}
            tooltip="< 0.5 = conservative. 0.5–1.5 = manageable. > 2 = high leverage."
          />
          <Row label="Current Ratio"
            value={fmt(data.current_ratio)}
            color={data.current_ratio == null ? 'text-slate-500' : data.current_ratio > 1.5 ? 'text-emerald-400' : data.current_ratio < 1 ? 'text-red-400' : 'text-slate-100'}
            tooltip="> 2 = very liquid. 1–2 = healthy. < 1 = short-term cash risk."
          />

          <Section title="Profitability" />
          <Row label="ROE" value={data.roe != null ? `${fmt(data.roe)}%` : null} color={vc(data.roe, 15, 0)} tooltip="Return on Equity. > 15% = good, > 20% = excellent capital allocation." />
          <Row label="ROA" value={data.roa != null ? `${fmt(data.roa)}%` : null} color={vc(data.roa,  5, 0)} tooltip="Return on Assets. > 5% = good, > 10% = excellent." />

          <Section title="Analyst Consensus" />
          <div className="flex items-center justify-between py-2.5">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Users size={11} />
              <span>{c.total_count ?? '—'} analysts</span>
              <span className={`font-semibold ${
                c.recommendation === 'Strong Buy' || c.recommendation === 'Buy' ? 'text-emerald-400' :
                c.recommendation === 'Sell' || c.recommendation === 'Underperform' ? 'text-red-400' :
                'text-yellow-400'
              }`}>{c.recommendation}</span>
            </div>
            {c.target_mean && (
              <div className="text-right">
                <span className="text-sm font-semibold text-slate-100 tabular-nums">${c.target_mean.toFixed(2)}</span>
                {c.upside_pct != null && (
                  <span className={`text-xs font-semibold ml-1.5 tabular-nums ${c.upside_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {c.upside_pct >= 0 ? '+' : ''}{c.upside_pct}%
                  </span>
                )}
              </div>
            )}
          </div>
          {c.target_low && c.target_high && (
            <p className="text-[10px] text-slate-600 -mt-1.5 pb-1">
              Range ${c.target_low.toFixed(2)} – ${c.target_high.toFixed(2)}
            </p>
          )}
          <AnalystBar buy={c.buy_count} hold={c.hold_count} sell={c.sell_count} total={c.total_count} />

          <CriteriaList criteria={data.criteria} />
      </ExpandableSection>
    </div>
  )
}
