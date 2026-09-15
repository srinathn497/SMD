import Badge, { toneFromSignal } from '../ui/Badge'
import Tooltip from '../ui/Tooltip'
import { useSignals } from '../../api/signals'

// ── Indicator tooltip dictionary ────────────────────────────────────────────
const INDICATOR_TIPS = {
  'RSI(14)':
    'RSI = Relative Strength Index (14-day). Momentum oscillator from 0–100. Below 30 = oversold (stock fell too fast, buyers likely to return → BUY). Above 70 = overbought (stock ran up too fast, sellers may step in → SELL). Between 30–70 = neutral momentum.',

  'MACD(12,26,9)':
    'MACD = Moving Average Convergence/Divergence. Compares a 12-day fast EMA to a 26-day slow EMA, smoothed by a 9-day signal line. BUY signal: histogram crosses from negative to positive (bullish momentum shift). SELL signal: histogram crosses from positive to negative. Named after its three parameters: 12, 26, 9.',

  'BB(20,2)':
    'BB = Bollinger Bands. A volatility envelope built around a 20-day moving average. The upper and lower bands are 2 standard deviations wide. BUY: price touches or breaks the lower band (oversold, mean-reversion expected). SELL: price touches or breaks the upper band (overbought). Numbers 20 and 2 are the period and standard deviation multiplier.',

  'EMA(20/50)':
    'EMA = Exponential Moving Average crossover. Compares a 20-day short-term average to a 50-day long-term average. BUY (Golden Cross): 20-day EMA crosses above 50-day — uptrend is starting. SELL (Death Cross): 20-day EMA crosses below 50-day — downtrend is starting. When 20 is already above 50 (no cross), it signals an established uptrend.',
}

// ── Section tooltips ────────────────────────────────────────────────────────
const SECTION_TIPS = {
  heading:
    'Technical Signals — 4 indicators (RSI, MACD, Bollinger Bands, EMA) each independently vote BUY, SELL, or HOLD based on price patterns. The aggregate signal is the majority vote. Confidence = % of indicators agreeing.',
  confidence:
    'The percentage of indicators voting for the aggregate signal. 100% = all 4 agree. 75% = 3 of 4 agree. 50% = split — treat with caution. Higher confidence = stronger signal.',
  buyCount:
    'Number of indicators (out of 4) currently voting BUY. A BUY vote means the indicator sees bullish momentum or an oversold condition.',
  sellCount:
    'Number of indicators (out of 4) currently voting SELL. A SELL vote means the indicator sees bearish momentum or an overbought condition.',
  holdCount:
    'Number of indicators (out of 4) currently voting HOLD/NEUTRAL. These indicators see no clear directional signal.',
}

export default function SignalCard({ symbol, assetType }) {
  const { data, isPending, error } = useSignals(symbol, assetType)

  if (isPending) return <div className="card animate-pulse h-40" />
  if (error)     return <div className="card text-red-400 text-sm">Failed to load signals</div>
  if (!data)     return null

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <Tooltip text={SECTION_TIPS.heading} wide>
          <h3 className="font-semibold text-slate-200 cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
            Technical Signals
          </h3>
        </Tooltip>
        <div className="flex items-center gap-2">
          <Badge tone={toneFromSignal(data.aggregate_signal)} size="lg">{data.aggregate_signal}</Badge>
          <Tooltip text={SECTION_TIPS.confidence} align="right">
            <span className="text-slate-400 text-sm cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
              {data.confidence_pct}%
            </span>
          </Tooltip>
        </div>
      </div>

      <div className="flex gap-4 mb-4 text-xs text-slate-500">
        <Tooltip text={SECTION_TIPS.buyCount}>
          <span className="text-emerald-400 cursor-help">▲ {data.buy_count} BUY</span>
        </Tooltip>
        <Tooltip text={SECTION_TIPS.sellCount}>
          <span className="text-red-400 cursor-help">▼ {data.sell_count} SELL</span>
        </Tooltip>
        <Tooltip text={SECTION_TIPS.holdCount} align="right">
          <span className="text-yellow-400 cursor-help">● {data.hold_count} HOLD</span>
        </Tooltip>
      </div>

      <div className="space-y-2">
        {data.indicators.map((ind) => (
          <div key={ind.name} className="flex items-center justify-between text-sm">
            {INDICATOR_TIPS[ind.name] ? (
              <Tooltip text={INDICATOR_TIPS[ind.name]} wide>
                <span className="text-slate-400 w-28 shrink-0 cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
                  {ind.name}
                </span>
              </Tooltip>
            ) : (
              <span className="text-slate-400 w-28 shrink-0">{ind.name}</span>
            )}
            <span className="text-slate-500 text-xs flex-1 truncate mx-2">{ind.detail}</span>
            <Badge tone={toneFromSignal(ind.signal)}>{ind.signal}</Badge>
          </div>
        ))}
      </div>
    </div>
  )
}
