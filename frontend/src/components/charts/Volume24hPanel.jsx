import { useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { useVolume24h, useVolumeFlow } from '../../api/volumeHistory'

// Two answers: who's in control right now (last 5–60 min), and the last 24
// hours hour by hour. Green = buying, red = selling; the ×-label marks hours
// busier than usual. Pre-market / after-hours have no volume in Yahoo's data,
// so they're drawn as price-move blocks.

const BUSY = 1.3
const VERY_BUSY = 2.0

const TONE = {
  calm: '#5b6b86',
  buy:  '#35d07f',   // brand-500
  sell: '#ef6a6a',   // bad-500
  warn: '#e8b84b',   // warn-500
}
const ratioTone = r => r >= VERY_BUSY ? TONE.sell : TONE.warn

const LABEL = {
  QUIET:     'Quiet',
  NORMAL:    'Normal',
  BUSY:      'Busy',
  VERY_BUSY: 'Very busy',
}

const fmtVol = v => v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : `${v}`
const unitFor = isCrypto => v => isCrypto ? `$${fmtVol(v)}` : `${fmtVol(v)} shares`

// Timestamps come back as ISO strings in the market's timezone
function fmtTime(iso, tz, { day = false } = {}) {
  const d = new Date(iso)
  const t = d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).replace(':00', '')
  return day ? `${d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' })} ${t}` : t
}
const dayOf = (iso, tz) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz })
// Axis labels need to fit under narrow bars: "1:30 PM" → "1:30p"
const shortTime = s => s.replaceAll(' AM', 'a').replaceAll(' PM', 'p')

// ≥55% one way = that side in control
function control(buyPct) {
  if (buyPct == null) return { pct: null, who: 'No trades yet', side: 'buying', color: '#e2e8f0' }
  if (buyPct >= 55) return { pct: buyPct, who: 'Buyers in control', side: 'buying', color: TONE.buy }
  if (buyPct <= 45) return { pct: 100 - buyPct, who: 'Sellers in control', side: 'selling', color: TONE.sell }
  return { pct: buyPct, who: 'Evenly matched', side: 'buying', color: '#e2e8f0' }
}

// Bars + price-only sessions in time order, with a "closed" gap wherever more
// than an hour has no data (e.g. 8 PM → 4 AM).
function buildTimeline(data) {
  const items = [
    ...data.bars.map(b => ({ kind: 'bar', start: b.start, end: Date.parse(b.start) + b.minutes * 60000, ...b })),
    ...data.sessions.map(s => ({ kind: 'ext', ...s, end: Date.parse(s.end) })),
  ].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  const out = []
  items.forEach((it, i) => {
    if (i > 0 && Date.parse(it.start) - items[i - 1].end > 60 * 60000) out.push({ kind: 'gap', start: it.start })
    out.push(it)
  })
  return out
}

// ── 1. Right now ─────────────────────────────────────────────────────────────

function RightNow({ symbol, assetType, vol, tz }) {
  const { data, isPending, isError } = useVolumeFlow(symbol, assetType)
  const [sel, setSel] = useState(2)   // 15 min

  if (isPending) return <div className="mt-3 h-40 rounded-lg bg-dark-800 animate-pulse" />
  if (isError || !data) return <p className="mt-3 text-xs text-slate-500">Live buying vs selling isn't available for {symbol}.</p>

  const w = data.windows[sel] ?? data.windows[0]
  const c = control(w.buy_pct)
  const span = w.minutes === 60 ? 'hour' : `${w.minutes} min`

  return (
    <>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.09em] text-slate-500">Right now · buying vs selling</h3>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${data.exact
          ? 'text-sky-300 border-sky-900 bg-sky-950/60'
          : 'text-slate-400 border-dark-600'}`}>
          {data.exact ? `Exact · ${data.source}` : `Estimated · ${data.source}`}
        </span>
      </div>

      <div className="mt-3.5 flex items-center gap-3.5 flex-wrap">
        <span className="ticker-num text-[26px] font-bold leading-tight px-3.5 py-1.5 rounded-xl bg-dark-700" style={{ color: c.color }}>
          {c.pct != null ? `${Math.round(c.pct)}%` : '—'}
        </span>
        <div className="min-w-0">
          <div className="text-[17px] font-semibold text-slate-100">{c.who}</div>
          <div className="text-[12.5px] text-slate-400">
            {c.side} in the last {span}
            {data.live ? '' : ` before ${fmtTime(data.as_of, tz)} (market closed)`}
            {' · '}{vol(w.volume)}
            {w.pace != null && <> · {w.pace.toFixed(1)}× usual pace</>}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-1">
        {data.windows.map((x, i) => {
          const pb = x.buy_pct == null ? null : Math.round(x.buy_pct)
          return (
            <button
              key={x.minutes}
              type="button"
              aria-pressed={i === sel}
              onClick={() => setSel(i)}
              className={`grid grid-cols-[38px_1fr_76px] sm:grid-cols-[44px_1fr_92px] gap-2 sm:gap-3 items-center px-2 py-1.5 rounded-lg text-left
                          ${i === sel ? 'bg-dark-700 outline outline-1 outline-dark-600' : 'hover:bg-dark-800'}`}
            >
              <span className={`text-[13px] font-semibold ${i === sel ? 'text-slate-100' : 'text-slate-400'}`}>
                {x.minutes === 60 ? '1h' : `${x.minutes}m`}
              </span>
              <span className="relative flex h-3 rounded-md overflow-hidden bg-dark-700">
                {pb != null && <>
                  <i className="block h-full" style={{ width: `${pb}%`, background: TONE.buy }} />
                  <i className="block h-full" style={{ width: `${100 - pb}%`, background: TONE.sell }} />
                </>}
                <span className="absolute left-1/2 -top-[3px] -bottom-[3px] w-px bg-slate-200/30" />
              </span>
              <span className="ticker-num text-[12px] text-right text-slate-400">
                {pb == null ? '—' : <><b style={{ color: TONE.buy }}>{pb}%</b> / <b style={{ color: TONE.sell }}>{100 - pb}%</b></>}
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}

// ── 2. Last 24 hours ─────────────────────────────────────────────────────────

function Bar({ b, tz, max, vol }) {
  const h = Math.max(3, (b.volume / max) * 100)
  const split = b.buy_volume != null && b.volume > 0
  const pb = split ? Math.round((b.buy_volume / b.volume) * 100) : null
  const label = `${fmtTime(b.start, tz, { day: true })}${b.partial ? ' (so far)' : b.minutes < 60 ? ` (${b.minutes} min)` : ''}`
  return (
    <div
      tabIndex={0}
      aria-label={`${label}: ${vol(b.volume)}${split ? `, ${pb}% buying` : ''}${b.ratio != null ? `, ${b.ratio.toFixed(1)} times usual` : ''}`}
      className="group relative flex flex-col items-center justify-end gap-1 h-full min-w-0 outline-none"
      style={{ flex: `${b.minutes / 60} 1 0` }}
    >
      {!b.partial && b.ratio != null && b.ratio >= BUSY && (
        <span className="text-[11px] font-bold ticker-num" style={{ color: ratioTone(b.ratio) }}>{b.ratio.toFixed(1)}×</span>
      )}
      <span
        className={`w-full max-w-[42px] flex flex-col rounded-t-md rounded-b-sm overflow-hidden group-focus:ring-2 group-focus:ring-sky-400`}
        style={{ height: `${h}%`, opacity: b.partial ? 0.55 : 1 }}
      >
        {split
          ? <><i className="block" style={{ flex: 100 - pb, background: TONE.sell }} /><i className="block" style={{ flex: pb, background: TONE.buy }} /></>
          : <i className="block flex-1" style={{ background: TONE.calm }} />}
      </span>
      {/* hover / focus details */}
      <span className="hidden group-hover:grid group-focus:grid absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap
                       bg-dark-900 border border-dark-600 rounded-lg px-2.5 py-1.5 text-[11.5px] text-left gap-0.5">
        <b className="text-slate-100">{label}</b>
        <span className="ticker-num text-slate-200">{vol(b.volume)}</span>
        {split && (
          <span><span style={{ color: TONE.buy }}>{pb}% buying</span> · <span style={{ color: TONE.sell }}>{100 - pb}% selling</span></span>
        )}
        {b.usual != null && (
          <span className="text-slate-400">
            usual {b.partial ? 'so far ' : ''}{fmtVol(b.usual)} · <b className="text-slate-200">{b.ratio?.toFixed(1)}×</b>
          </span>
        )}
      </span>
    </div>
  )
}

function ExtBlock({ s }) {
  const up = s.change_pct >= 0
  return (
    <div className="h-full rounded-t-lg bg-dark-700/75 grid place-content-center text-center gap-0.5 px-1 min-w-0" style={{ flex: '1.6 1 0' }}>
      <span className="text-[10.5px] uppercase tracking-wider text-slate-400 truncate">{s.session === 'PRE' ? 'Pre-market' : 'After-hours'}</span>
      <span className={`ticker-num font-semibold text-[15px] ${up ? 'text-brand-500' : 'text-bad-500'}`}>
        {up ? '+' : '−'}{Math.abs(s.change_pct).toFixed(1)}%
      </span>
      <span className="text-[9.5px] text-slate-500 leading-tight">price move<br />no volume data</span>
    </div>
  )
}

function footnote(data, tz, vol) {
  if (data.is_crypto) {
    return data.source === 'Coinbase'
      ? 'Right-now split is exact: every Coinbase trade is tagged as an aggressive buy or sell. Hourly bars are estimated from 1-minute candles. Coinbase only, not every exchange.'
      : 'Coinbase has no market for this coin, so there is no buy/sell split.'
  }
  const est = 'Stocks are an estimate from where each minute closed in its range.'
  if (!data.removed?.length) return est
  const big = data.removed.reduce((a, b) => (b.volume > a.volume ? b : a))
  const n = data.removed.length
  return `${n} suspicious minute${n > 1 ? 's' : ''} removed from Yahoo data (e.g. ${shortTime(fmtTime(big.time, tz))}: ${vol(big.volume)} in one minute). ${est}`
}

export default function Volume24hPanel({ symbol, assetType }) {
  const { data, isPending, isError } = useVolume24h(symbol, assetType)

  // Display in New York time for every asset (crypto data is keyed by UTC hour on the backend)
  const tz = 'America/New_York'
  // Crypto volume is in USD, stock volume in shares
  const isCrypto = data?.is_crypto ?? (assetType === 'crypto' || /-USDT?$/.test(symbol ?? ''))
  const vol = unitFor(isCrypto)

  const rightNow = <RightNow symbol={symbol} assetType={assetType} vol={vol} tz={tz} />

  if (isPending) return <div>{rightNow}<div className="mt-6 h-56 rounded-lg bg-dark-800 animate-pulse" /></div>
  if (isError || !data) return <div>{rightNow}<p className="text-xs text-slate-500 py-6">Hourly volume unavailable for {symbol}.</p></div>
  if (!data.bars.length) return <div>{rightNow}<p className="text-xs text-slate-500 py-6">No trading hours in the last 24 hours of data.</p></div>

  const timeline = buildTimeline(data)
  const max = Math.max(...data.bars.map(b => b.volume), 1)
  const withSplit = data.bars.filter(b => b.buy_volume != null)
  const splitVol = withSplit.reduce((s, b) => s + b.volume, 0)
  const dayBuy = splitVol ? Math.round(withSplit.reduce((s, b) => s + b.buy_volume, 0) / splitVol * 100) : null

  // x-axis label: weekday on the first bar of each day; with many bars (crypto)
  // label every 3rd hour so the text fits
  const dense = data.bars.length > 12
  const seenDays = new Set()
  const axis = timeline.map(it => {
    if (it.kind === 'gap') return { flex: '0.35 1 0', text: '' }
    if (it.kind === 'ext') return { flex: '1.6 1 0', text: shortTime(`${fmtTime(it.start, tz)}–${fmtTime(it.end, tz)}`) }
    const d = dayOf(it.start, tz)
    const first = !seenDays.has(d)
    seenDays.add(d)
    if (it.partial) return { flex: `${it.minutes / 60} 1 0`, text: 'now' }
    const hour = new Date(it.start).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }) % 3
    const text = dense && hour !== 0 ? '' : shortTime(fmtTime(it.start, tz, { day: first && !dense }))
    return { flex: `${it.minutes / 60} 1 0`, text }
  })

  return (
    <div>
      {rightNow}

      <div className="h-px bg-dark-600 mt-5 mb-4" />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.09em] text-slate-500">Last 24 hours · hour by hour</h3>
        <span className="text-[12.5px] text-slate-400">
          {dayBuy != null && <><b style={{ color: dayBuy >= 50 ? TONE.buy : TONE.sell }}>{dayBuy}% buying</b> · </>}
          {vol(data.total_volume)}
          {data.ratio != null && <> · {LABEL[data.label]} ({data.ratio.toFixed(1)}× usual)</>}
        </span>
      </div>

      {data.data_warning && (
        <div className="mt-3 flex items-start gap-2 text-[12px] text-warn-500 bg-warn-500/10 border border-warn-500/30 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{data.data_warning}</span>
        </div>
      )}

      {/* bars, oldest left → now right */}
      <div className="mt-6 flex items-end gap-1.5 h-[170px] border-b border-dark-600">
        {timeline.map((it, i) =>
          it.kind === 'bar' ? <Bar key={it.start} b={it} tz={tz} max={max} vol={vol} />
          : it.kind === 'ext' ? <ExtBlock key={`${it.session}-${it.start}`} s={it} />
          : <div key={`gap-${i}`} className="h-full grid place-items-center text-[9.5px] tracking-widest text-slate-600 [writing-mode:vertical-rl] rotate-180" style={{ flex: '0.35 1 0' }}>closed</div>
        )}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {axis.map((a, i) => (
          <span key={i} className="min-w-0 text-center text-[10.5px] text-slate-500 whitespace-nowrap overflow-hidden" style={{ flex: a.flex }}>{a.text}</span>
        ))}
      </div>

      {/* key */}
      <div className="flex gap-4 flex-wrap mt-3.5 text-[12px] text-slate-400">
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm" style={{ background: TONE.buy }} />Buying</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm" style={{ background: TONE.sell }} />Selling</span>
        <span className="flex items-center gap-1.5"><b className="ticker-num" style={{ color: TONE.warn }}>1.6×</b> busier than usual for that hour</span>
        <span className="text-slate-500">bar height = volume</span>
      </div>
      <div className="mt-3 flex items-start gap-1.5 text-[11.5px] text-slate-500">
        <Info size={13} className="shrink-0 mt-px" />
        <span>{footnote(data, tz, vol)}</span>
      </div>
    </div>
  )
}
