import { useState } from 'react'
import { BarChart2, HelpCircle, TrendingUp, TrendingDown } from 'lucide-react'
import { useVolumeHistory } from '../../api/volumeHistory'
import Tooltip from '../ui/Tooltip'

const fmt = (n) => {
  if (n == null) return '—'
  return n < 1 ? n.toFixed(4) : n.toFixed(2)
}

function ColHeader({ label, tip, wide }) {
  return (
    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
      <Tooltip text={tip} wide={wide}>
        <span className="flex items-center gap-1 cursor-default">
          {label}
          <HelpCircle size={10} className="text-slate-600" />
        </span>
      </Tooltip>
    </th>
  )
}

function RetCell({ value }) {
  if (value == null) return <td className="px-3 py-2 text-slate-600 text-xs">—</td>
  const pos = value >= 0
  return (
    <td className={`px-3 py-2 text-xs font-medium tabular-nums ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
      {pos ? '+' : ''}{value.toFixed(2)}%
    </td>
  )
}

function StatCard({ label, value, sub, tip, positive }) {
  const color = positive === true ? 'text-emerald-400' : positive === false ? 'text-red-400' : 'text-slate-200'
  return (
    <Tooltip text={tip} wide>
      <div className="bg-dark-700/50 rounded-lg px-3 py-2.5 cursor-default">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">{label}</p>
        <p className={`text-base font-bold ${color}`}>{value ?? '—'}</p>
        {sub && <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>}
      </div>
    </Tooltip>
  )
}

export default function VolumeHistoryCard({ symbol, assetType, embedded = false }) {
  const { data, isPending, isError } = useVolumeHistory(symbol, assetType)
  const [showAll, setShowAll] = useState(false)

  const events = data?.events ?? []
  const visible = showAll ? events : events.slice(0, 8)

  const Wrapper = ({ children }) => embedded
    ? <div className="overflow-hidden">{children}</div>
    : <div className="card p-0 overflow-hidden">{children}</div>

  return (
    <Wrapper>
      {/* Header */}
      <div className="px-4 py-3 border-b border-dark-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 size={15} className="text-brand-400" />
          <span className="text-sm font-semibold text-slate-300">Volume Spike History</span>
          <Tooltip
            wide
            text="Days when volume was ≥2× the 20-day average — a sign of institutional activity. Shows how the price moved in the days after each spike."
          >
            <HelpCircle size={13} className="text-slate-600 cursor-default" />
          </Tooltip>
        </div>
        <span className="text-xs text-slate-600">Last 12 months</span>
      </div>

      {isPending && (
        <div className="px-4 py-6 text-center text-slate-600 text-sm animate-pulse">
          Loading volume history…
        </div>
      )}

      {isError && (
        <div className="px-4 py-6 text-center text-slate-600 text-sm">
          No volume history available
        </div>
      )}

      {data && (
        <>
          {/* Summary stats */}
          <div className="px-4 pt-3 pb-3 grid grid-cols-2 gap-2">
            <StatCard
              label="Bullish spikes"
              value={data.bullish_spikes}
              sub={data.bullish_avg_ret_5d != null
                ? `Avg +5d: ${data.bullish_avg_ret_5d > 0 ? '+' : ''}${data.bullish_avg_ret_5d}%`
                : null}
              tip="Days with high volume where price closed above open (institutional buying). Shows avg price move 5 days later."
              positive={data.bullish_avg_ret_5d != null ? data.bullish_avg_ret_5d >= 0 : undefined}
              wide
            />
            <StatCard
              label="Bullish win rate"
              value={data.bullish_win_rate != null ? `${data.bullish_win_rate}%` : null}
              sub="price up 5 days later"
              tip="Out of all bullish volume spikes in the last year, what % of the time was the price higher 5 trading days later?"
              positive={data.bullish_win_rate != null ? data.bullish_win_rate >= 50 : undefined}
              wide
            />
            <StatCard
              label="Bearish spikes"
              value={data.bearish_spikes}
              sub={data.bearish_avg_ret_5d != null
                ? `Avg +5d: ${data.bearish_avg_ret_5d > 0 ? '+' : ''}${data.bearish_avg_ret_5d}%`
                : null}
              tip="Days with high volume where price closed below open (institutional selling/distribution). Shows avg price move 5 days later."
              positive={data.bearish_avg_ret_5d != null ? data.bearish_avg_ret_5d >= 0 : undefined}
              wide
            />
            <StatCard
              label="Bearish win rate"
              value={data.bearish_win_rate != null ? `${data.bearish_win_rate}%` : null}
              sub="price up 5 days later"
              tip="Out of all bearish volume spikes, what % of the time was the price still higher 5 trading days later? Low % = spike often led to continued decline."
              positive={data.bearish_win_rate != null ? data.bearish_win_rate >= 50 : undefined}
              wide
            />
          </div>

          {/* Events table */}
          {events.length === 0 ? (
            <div className="px-4 pb-4 text-sm text-slate-600 text-center">
              No volume spikes (≥2×) found in the last 12 months
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-t border-dark-700">
                  <tr>
                    <ColHeader label="Date"      tip="Date of the volume spike event" />
                    <ColHeader
                      label="Est. Entry"
                      tip="The estimated average price institutions paid on this day. Calculated as (High + Low + Close) / 3 — the standard VWAP approximation for a daily bar. This is the best single-number answer to 'what price did they buy at?'"
                      wide
                    />
                    <ColHeader
                      label="Day Range"
                      tip="The full price range on the spike day (Low → High). Institutions were buying somewhere in this range. A tight range means controlled accumulation; a wide range means volatile activity."
                      wide
                    />
                    <ColHeader
                      label="Surge"
                      tip="How much higher than normal the volume was. 2× means twice the 20-day average — a sign of institutional activity."
                    />
                    <ColHeader
                      label="Type"
                      tip="Bullish = price closed above open on spike day (buying pressure). Bearish = price closed below open (selling/distribution pressure)."
                    />
                    <ColHeader
                      label="Next Day"
                      tip="Price change the very next trading day after the spike."
                    />
                    <ColHeader
                      label="+1 Week"
                      tip="Price change 5 trading days (1 week) after the spike — the most useful number for swing traders."
                      wide
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-700/50">
                  {visible.map((ev, i) => {
                    const isBull = ev.day_direction === 'BULLISH'
                    return (
                      <tr key={i} className="hover:bg-dark-700/30 transition-colors">
                        {/* Date */}
                        <td className="px-3 py-2.5 text-xs text-slate-400 tabular-nums whitespace-nowrap">
                          {new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                        </td>

                        {/* Est. Entry — VWAP approx */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="text-xs font-semibold text-slate-100 tabular-nums">
                              ${fmt(ev.vwap_approx)}
                            </span>
                            <span className="text-[10px] text-slate-600">avg entry</span>
                          </div>
                        </td>

                        {/* Day Range */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1 text-[10px] tabular-nums">
                              <span className="text-emerald-500">H ${fmt(ev.price_high)}</span>
                              <span className="text-slate-700">·</span>
                              <span className="text-red-400">L ${fmt(ev.price_low)}</span>
                            </div>
                            <div className="h-1 w-20 bg-dark-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${isBull ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                                style={{
                                  width: ev.price_high > ev.price_low
                                    ? `${((ev.vwap_approx - ev.price_low) / (ev.price_high - ev.price_low)) * 100}%`
                                    : '50%'
                                }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Surge */}
                        <td className="px-3 py-2.5 text-xs font-medium text-yellow-400 tabular-nums">
                          {ev.surge_ratio.toFixed(1)}×
                        </td>

                        {/* Type badge */}
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                            isBull
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-red-500/10 text-red-400'
                          }`}>
                            {isBull ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                            {isBull ? 'Buy' : 'Sell'}
                          </span>
                        </td>

                        <RetCell value={ev.ret_1d} />
                        <RetCell value={ev.ret_5d} />
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {events.length > 8 && (
                <div className="px-4 py-2.5 border-t border-dark-700">
                  <button
                    onClick={() => setShowAll(v => !v)}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showAll ? 'Show less' : `Show all ${events.length} events`}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Wrapper>
  )
}
