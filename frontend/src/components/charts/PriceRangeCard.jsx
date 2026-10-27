import { useHistory, useQuote } from '../../api/market'
import { useMarketStore } from '../../store/marketStore'
import Tooltip from '../ui/Tooltip'

// Low/high of each lookback window and where today's price sits inside it.
// One 3y daily request covers 1W–3Y; 1D (and today's part of every window)
// comes from the live quote, so today counts even when Yahoo's 3y daily
// series is a session behind.

const PERIODS = [
  { key: '1D', days: 0 },
  { key: '1W', days: 7 },
  { key: '1M', months: 1 },
  { key: '3M', months: 3 },
  { key: '6M', months: 6 },
  { key: '1Y', months: 12 },
  { key: '2Y', months: 24 },
  { key: '3Y', months: 36 },
]

const FLAG_PCT = 4   // within 4% of either end → AT LOW / AT HIGH

// Bar date in the market's own calendar: stock daily bars are stamped at
// midnight New York time, crypto bars at midnight UTC.
const isoDate = (ms, tz) => new Date(ms).toLocaleDateString('en-CA', { timeZone: tz })

function cutoffDate(todayIso, p) {
  const d = new Date(`${todayIso}T00:00:00Z`)
  if (p.days != null) d.setUTCDate(d.getUTCDate() - p.days)
  else d.setUTCMonth(d.getUTCMonth() - p.months)
  return d.toISOString().slice(0, 10)
}

function fmtDate(iso, todayIso) {
  if (iso === todayIso) return 'Today'
  const d = new Date(`${iso}T00:00:00Z`)
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' }
  if (iso.slice(0, 4) !== todayIso.slice(0, 4)) opts.year = 'numeric'
  return d.toLocaleDateString('en-US', opts)
}

const fmtPx  = n => n < 1 ? n.toFixed(4) : n.toFixed(2)
const fmtPct = n => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`

function computeRanges(bars, quote, price, tz) {
  const todayIso = isoDate(Date.now(), tz)
  const days = bars.map(b => ({ date: isoDate(b.timestamp, tz), high: b.high, low: b.low }))
  const sessionIso = quoteSessionDate(todayIso, tz)
  // The quote's session high/low replaces any (possibly stale) bar for it.
  const hist = days.filter(d => d.date < sessionIso)
  const today = quote?.high && quote?.low
    ? { date: sessionIso, high: quote.high, low: quote.low }
    : days.find(d => d.date === sessionIso)
  const firstDate = days[0]?.date

  return {
    todayIso,
    rows: PERIODS.map(p => {
      const cutoff = cutoffDate(todayIso, p)
      // 5-day slack so a window starting on a weekend/holiday still counts as covered
      const covered = p.days === 0 || (firstDate && firstDate <= addDays(cutoff, 5))
      const inWin = [...hist.filter(d => d.date > cutoff), ...(today ? [today] : [])]
      if (!covered || !inWin.length) return { key: p.key, empty: true }
      let lo = inWin[0], hi = inWin[0]
      for (const d of inWin) {
        if (d.low < lo.low) lo = d
        if (d.high > hi.high) hi = d
      }
      const span = hi.high - lo.low
      const pos = span > 0 ? Math.min(100, Math.max(0, (price - lo.low) / span * 100)) : 50
      return {
        key: p.key,
        low: lo.low, lowDate: lo.date,
        high: hi.high, highDate: hi.date,
        pos,
        fromHigh: (price / hi.high - 1) * 100,
        aboveLow: (price / lo.low - 1) * 100,
      }
    }),
  }
}

// Which session the quote's day high/low belong to. yfinance keeps reporting
// the last session's high/low until the next open, so for stocks: today from
// 09:30 ET on a weekday, otherwise the previous weekday (holidays not skipped,
// same as the backend's next_session()). Crypto: the current UTC day.
function quoteSessionDate(todayIso, tz) {
  if (tz === 'UTC') return todayIso
  const dow = new Date(`${todayIso}T00:00:00Z`).getUTCDay()
  const [h, m] = new Date().toLocaleTimeString('en-GB', { timeZone: tz, hour12: false }).split(':').map(Number)
  if (dow >= 1 && dow <= 5 && h * 60 + m >= 9 * 60 + 30) return todayIso
  let d = addDays(todayIso, -1)
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, -1)
  return d
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Red (low end) → neutral → green (high end), v2 tokens
const BAR_BG = 'linear-gradient(90deg, rgba(239,106,106,0.55), #1c2436 50%, rgba(53,208,127,0.55))'

function RangeBar({ row }) {
  const atLow  = row.pos <= FLAG_PCT
  const atHigh = row.pos >= 100 - FLAG_PCT
  return (
    <div className="min-w-[150px]">
      <div className="relative h-1.5 rounded-full" style={{ background: BAR_BG }}>
        <span
          className="absolute -top-1 w-0.5 h-3.5 rounded-sm bg-slate-100 -translate-x-1/2"
          style={{ left: `${row.pos}%` }}
        />
      </div>
      <div className="mt-1.5 text-[11px] text-slate-400 flex items-center gap-1.5">
        {Math.round(row.pos)}% of range
        {atHigh && <span className="text-[10px] font-semibold px-1.5 rounded text-brand-500 bg-brand-500/15">AT HIGH</span>}
        {atLow && !atHigh && <span className="text-[10px] font-semibold px-1.5 rounded text-bad-500 bg-bad-500/15">AT LOW</span>}
      </div>
    </div>
  )
}

// embedded: render inside another card (no own card wrapper or title)
export default function PriceRangeCard({ symbol, assetType, embedded = false }) {
  const { data: hist, isPending, isError } = useHistory(symbol, assetType, '1d', '3y')
  const { data: quote } = useQuote(symbol, assetType)
  const live  = useMarketStore(s => s.livePrices[symbol])
  const price = live?.price ?? quote?.price
  // Search can return asset_type "stock" for crypto tickers, so check the suffix too
  const isCrypto = assetType === 'crypto' || /-USDT?$/i.test(symbol ?? '')
  const tz    = isCrypto ? 'UTC' : 'America/New_York'

  const bars = hist?.bars ?? []
  const ready = price != null && (bars.length > 0 || quote)
  const { rows, todayIso } = ready ? computeRanges(bars, quote, price, tz) : { rows: [], todayIso: '' }

  return (
    <div className={embedded ? '' : 'card'}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          {!embedded && (
            <Tooltip text="Lowest and highest price in each period, and where today's price sits between them. Prices are dividend-adjusted, the same as the chart.">
              <h3 className="text-sm font-semibold text-slate-100 cursor-help underline decoration-dotted decoration-slate-600 underline-offset-4">
                Price range
              </h3>
            </Tooltip>
          )}
          {price != null && (
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mt-0.5">
              {symbol} · now <span className="ticker-num text-slate-200">${fmtPx(price)}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3.5 text-[11px] text-slate-400 flex-wrap">
          <span className="flex items-center gap-1.5"><span className="w-0.5 h-3 rounded-sm bg-slate-100" />Today's price</span>
          <span><span className="text-bad-500">◂</span> period low</span>
          <span>period high <span className="text-brand-500">▸</span></span>
        </div>
      </div>

      {isPending && !rows.length ? (
        <div className="h-40 rounded-lg bg-dark-800 animate-pulse" />
      ) : isError && !quote ? (
        <p className="text-xs text-slate-500">Price history unavailable for {symbol}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-dark-700">
                <th className="text-left font-medium py-1.5 px-2">Period</th>
                <th className="text-right font-medium py-1.5 px-2">Low</th>
                <th className="text-left font-medium py-1.5 px-2">Where today's price sits</th>
                <th className="text-right font-medium py-1.5 px-2">High</th>
                <th className="text-right font-medium py-1.5 px-2">From high</th>
                <th className="text-right font-medium py-1.5 px-2">Above low</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key} className="border-b border-dark-700/60 last:border-0 hover:bg-dark-700/30">
                  <td className="py-2 px-2 font-semibold text-slate-200">{r.key}</td>
                  {r.empty ? (
                    <td colSpan={5} className="py-2 px-2 text-slate-600 text-xs">— not enough history</td>
                  ) : (
                    <>
                      <td className="py-2 px-2 text-right ticker-num text-bad-500">
                        {fmtPx(r.low)}
                        <div className="text-[10.5px] text-slate-500 font-sans">{fmtDate(r.lowDate, todayIso)}</div>
                      </td>
                      <td className="py-2 px-2"><RangeBar row={r} /></td>
                      <td className="py-2 px-2 text-right ticker-num text-brand-500">
                        {fmtPx(r.high)}
                        <div className="text-[10.5px] text-slate-500 font-sans">{fmtDate(r.highDate, todayIso)}</div>
                      </td>
                      <td className="py-2 px-2 text-right ticker-num text-bad-500">{fmtPct(r.fromHigh)}</td>
                      <td className="py-2 px-2 text-right ticker-num text-brand-500">{fmtPct(r.aboveLow)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
