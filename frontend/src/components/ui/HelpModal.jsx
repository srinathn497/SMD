import { X, TrendingUp, Brain, BarChart2, Activity, Trophy, Newspaper, Calculator, TrendingDown, Minus, CheckCircle2, XCircle, Layers } from 'lucide-react'

// ── Mini UI components that mirror the real app badges ──────────────────────

function ConvictionBadge({ label, score, maxScore, direction }) {
  const cfg = {
    MODERATE: { bg: 'bg-green-500/15 border-green-500/30 text-green-400', emoji: '⚡' },
    HIGH_CONVICTION: { bg: 'bg-yellow-500/15 border-yellow-500/30 text-yellow-400', emoji: '🔥' },
    WEAK: { bg: 'bg-orange-500/15 border-orange-500/30 text-orange-400', emoji: '〰' },
    NEUTRAL: { bg: 'bg-dark-700 border-dark-600 text-slate-500', emoji: '—' },
  }[label] ?? { bg: 'bg-dark-700 border-dark-600 text-slate-500', emoji: '—' }
  const dirColor = direction === 'BUY' ? 'text-emerald-400' : direction === 'SELL' ? 'text-red-400' : 'text-slate-500'
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border font-medium ${cfg.bg}`}>
      {cfg.emoji} {label.replace('_', ' ')}
      <span className="text-slate-500">·</span>
      <span className="tabular-nums">{score}/{maxScore}</span>
      <span className={`font-semibold ${dirColor}`}>{direction}</span>
    </span>
  )
}

function DirBadge({ direction, confidence }) {
  const cfg = {
    UP:   { color: 'text-emerald-400', Icon: TrendingUp },
    DOWN: { color: 'text-red-400',     Icon: TrendingDown },
  }[direction] ?? { color: 'text-slate-500', Icon: Minus }
  const { Icon, color } = cfg
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${color}`}>
      <Icon size={11} /> {direction} {confidence}%
      <span className="text-xs text-cyan-500 font-normal ml-0.5">CAL</span>
    </span>
  )
}

function SignalRow({ label, vote }) {
  const Icon = vote === 'BUY' ? CheckCircle2 : vote === 'SELL' ? XCircle : Minus
  const color = vote === 'BUY' ? 'text-emerald-400' : vote === 'SELL' ? 'text-red-400' : 'text-slate-500'
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${color}`}>
      <Icon size={11} /> {label}
    </span>
  )
}

function IntradaySignal({ signal }) {
  const cfg = {
    GOOD_ENTRY:    { bg: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400', label: 'GOOD ENTRY' },
    WAIT_PULLBACK: { bg: 'bg-orange-500/10 border-orange-500/25 text-orange-400',   label: 'WAIT PULLBACK' },
    TAKE_PROFITS:  { bg: 'bg-red-500/10 border-red-500/25 text-red-400',            label: 'TAKE PROFITS' },
    NEUTRAL:       { bg: 'bg-dark-700 border-dark-600 text-slate-500',              label: 'NEUTRAL' },
  }[signal] ?? { bg: 'bg-dark-700 border-dark-600 text-slate-500', label: signal }
  return (
    <span className={`inline-flex text-xs px-2 py-0.5 rounded-full border font-medium ${cfg.bg}`}>
      {cfg.label}
    </span>
  )
}

function VerdictBox({ verdict }) {
  const cfg = {
    BUY:  { bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' },
    SELL: { bg: 'bg-red-500/15 border-red-500/30 text-red-400' },
    WAIT: { bg: 'bg-orange-500/15 border-orange-500/30 text-orange-400' },
  }[verdict] ?? { bg: 'bg-dark-700 border-dark-600 text-slate-400' }
  return (
    <span className={`inline-flex text-xs px-2.5 py-0.5 rounded-md border font-bold tracking-wide ${cfg.bg}`}>
      {verdict}
    </span>
  )
}

function WFBar({ pct, active }) {
  const color = pct >= 55 ? 'bg-emerald-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className={`w-1.5 rounded-sm ${color} ${active ? 'ring-1 ring-white/40' : ''}`}
         style={{ height: `${Math.round(pct * 0.4)}px`, minHeight: 4 }} />
  )
}

function ScenarioPill({ label, value, color }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs bg-dark-700 border border-dark-600 rounded-md px-2 py-1">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold tabular-nums ${color}`}>{value}</span>
    </span>
  )
}

// ── NVDA visual example ──────────────────────────────────────────────────────

function NvidiaExample() {
  const wfRounds = [62, 58, 45, 71, 55, 48, 60, 53, 67, 50, 58, 44, 63, 57, 70, 52, 60, 55, 48, 66]

  return (
    <div className="mx-6 mt-5 mb-2 rounded-lg bg-dark-700/60 border border-dark-600 overflow-hidden">
      {/* Symbol header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-dark-600/60 bg-dark-700/80">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-slate-100">NVIDIA</span>
          <span className="text-slate-500 text-xs">NVDA</span>
          <span className="text-lg font-bold text-slate-100">$900.00</span>
          <span className="text-xs font-medium text-emerald-400">+$18.00 (+2.04%)</span>
        </div>
        <span className="text-xs text-slate-600">Example — not live data</span>
      </div>

      <div className="px-4 py-3 space-y-3">

        {/* Conviction badge row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 w-28 flex-shrink-0">Conviction</span>
          <ConvictionBadge label="MODERATE" score={5} maxScore={7} direction="BUY" />
        </div>

        {/* Intraday row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 w-28 flex-shrink-0">Intraday</span>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-400">VWAP <span className="text-emerald-400">−0.3%</span></span>
            <span className="text-xs text-slate-400">RSI <span className="text-slate-200">61</span></span>
            <span className="text-xs text-slate-400">ATR cov <span className="text-slate-200">70%</span></span>
            <IntradaySignal signal="GOOD_ENTRY" />
            <span className="text-xs text-slate-500">→ Combined</span>
            <VerdictBox verdict="BUY" />
          </div>
        </div>

        {/* Technical signals */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 w-28 flex-shrink-0">Technicals</span>
          <div className="flex items-center gap-2">
            <SignalRow label="RSI" vote="BUY" />
            <SignalRow label="MACD" vote="BUY" />
            <SignalRow label="BB" vote="NEUTRAL" />
            <SignalRow label="EMA" vote="BUY" />
            <span className="text-xs text-slate-500 ml-1">3/4 agree</span>
          </div>
        </div>

        {/* ML prediction */}
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-xs text-slate-500 w-28 flex-shrink-0 mt-0.5">ML Prediction</span>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <DirBadge direction="UP" confidence={56} />
              <span className="text-xs text-emerald-500/80 bg-emerald-900/30 border border-emerald-700/30 px-1.5 py-0.5 rounded text-[10px]">↑ Bull Regime</span>
              <span className="text-xs text-slate-500">30 WF rounds</span>
            </div>
            {/* WF sparkline */}
            <div className="flex items-end gap-0.5 h-8">
              {wfRounds.map((pct, i) => (
                <WFBar key={i} pct={pct} active={i === wfRounds.length - 1} />
              ))}
              <span className="text-[10px] text-slate-600 ml-1 self-end mb-0.5">avg 57%</span>
            </div>
          </div>
        </div>

        {/* Scenario */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 w-28 flex-shrink-0">Scenario (100 sh)</span>
          <div className="flex gap-2 flex-wrap">
            <ScenarioPill label="Entry" value="$900" color="text-slate-200" />
            <ScenarioPill label="TP" value="$918" color="text-emerald-400" />
            <ScenarioPill label="SL" value="$883" color="text-red-400" />
            <ScenarioPill label="R/R" value="1.5×" color="text-slate-300" />
          </div>
        </div>

        {/* News */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 w-28 flex-shrink-0">News</span>
          <div className="flex items-center gap-1.5">
            <div className="w-24 h-1.5 bg-dark-600 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: '68%' }} />
            </div>
            <span className="text-xs text-emerald-400">POSITIVE</span>
            <span className="text-xs text-slate-600">· conf 56% → ~62%</span>
          </div>
        </div>

      </div>

      <div className="px-4 py-2 bg-dark-700/40 border-t border-dark-600/40">
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Reading: conviction + intraday timing + technicals all aligned. News provides a small lift. Risk/reward acceptable.
          ML accuracy ~55-60% historically for NVDA — not a guarantee, a statistical edge.
        </p>
      </div>
    </div>
  )
}

const SECTIONS = [
  {
    icon: TrendingUp,
    color: 'text-emerald-400',
    title: 'Quote Bar',
    subtitle: 'Live price at a glance',
    body: `Shows the current price, day change ($ and %), and OHLC snapshot for the selected symbol.
For stocks this is the last trade price. For crypto it updates with yfinance's last_price.
The O/H/L/P row gives context: if today's price is near the High, the stock is extended. Near the Low = potential support zone.`,
  },
  {
    icon: Trophy,
    color: 'text-yellow-400',
    title: 'Conviction Badge',
    subtitle: '7-signal voting system',
    body: `Aggregates up to 9 independent signals into one verdict (stocks: 9, crypto: 7).

① Technical Signals (RSI/MACD/BB/EMA majority vote)
② Daily ML Prediction (LightGBM classifier, calibrated probability)
③ 15m Intraday ML (short-term direction, last ~1 hour)
④ News Sentiment (keyword scoring across recent headlines)
⑤ Volume Pulse (today's volume vs 20-day average)
⑥ Intraday Signal (rule-engine: GOOD_ENTRY / TAKE_PROFITS etc.)
⑦ Composite Intraday Score (−6 to +6 weighted score)
⑧ Put/Call OI Ratio (stocks) — options market positioning
⑨ Max Pain (stocks) — gravitational pull toward options max pain strike

Score thresholds (ratio-based, works for both 7 and 9):
🔥 HIGH_CONVICTION (≥78%) — strong agreement, act with confidence
⚡ MODERATE (≥55%) — majority aligned, reasonable edge
〰 WEAK (≥28%) — mixed signals, wait for confirmation
— NEUTRAL (<28%) — no actionable direction; stay on sidelines

Click the badge to expand the full signal breakdown.`,
  },
  {
    icon: BarChart2,
    color: 'text-brand-400',
    title: 'Candlestick Chart',
    subtitle: 'Price action canvas',
    body: `Interactive OHLCV chart powered by TradingView Lightweight Charts.
Switch timeframes with the row of interval buttons above: 1d (daily swing), 1h/15m/5m (intraday), 1wk (weekly trend).
The chart period is controlled by the ML Prediction Card's period selector (2Y/3Y etc.) — changing the training period also changes how much chart history loads.

How to read:
• Green candle = close > open (bullish bar)
• Red candle = close < open (bearish bar)
• Long wicks = rejection — price tried to go there but failed
• Cluster of doji / spinning tops = indecision / consolidation`,
  },
  {
    icon: Activity,
    color: 'text-purple-400',
    title: 'Intraday Panel',
    subtitle: 'Same-session timing signals',
    body: `Helps you decide WHEN to act today, not WHETHER to act (that's the ML card's job).

Key metrics:
• VWAP Deviation — how far above/below today's volume-weighted average price you are. >+1% = extended above fair value (wait for pullback). <−1% = discounted below fair value (potential entry).
• RSI (1h bars) — same oscillator logic as daily but on hourly data. >70 = overbought intraday, <30 = oversold.
• ATR Coverage — how much of today's typical daily range (ATR) has already been used up. >100% means a full day's move has happened; chasing at this point risks a reversal.
• Volume Pulse — today's volume vs the 20-day average. >1.5× = institutional participation (trend likely to continue). <0.5× = thin tape (signals unreliable).
• Time-of-Day window — OPEN (9:30–10:00, volatile), MID_MORNING (10:00–11:00, best signals), MIDDAY (11:00–14:00, low volume), POWER_HOUR (14:00–15:30, directional), CLOSE (15:30–16:00, reversal risk).

Composite Score (−6 to +6): Weighted sum of the above. Translates into:
STRONG_ENTRY (≥4), GOOD_ENTRY (2–3), NEUTRAL (0–1), WAIT_PULLBACK (−1 to −2), TAKE_PROFITS (≤−3)

Combined Verdict: fuses your daily ML direction with the intraday signal. Example: Daily ML says BUY + Intraday GOOD_ENTRY → Combined = BUY. Daily ML says BUY + Intraday TAKE_PROFITS → Combined = WAIT.`,
  },
  {
    icon: TrendingUp,
    color: 'text-slate-400',
    title: 'Technical Signals',
    subtitle: 'Classic indicator breakdown',
    body: `Four indicators computed on daily bars:
• RSI(14) — momentum oscillator. >70 = overbought, <30 = oversold. BUY signal below 35, SELL above 70.
• MACD(12/26/9) — trend + momentum. Signal = MACD line crosses above/below signal line.
• Bollinger Bands(20) — volatility envelope. Price below lower band = oversold (BUY). Price above upper band = overbought (SELL).
• EMA Crossover(20/50) — trend direction. EMA20 above EMA50 = uptrend (BUY). Below = downtrend (SELL).

The aggregate shows how many signals agree: 4/4 BUY is a strong technical setup; 2 BUY + 2 SELL = conflicted, rely on ML.

⚠ These are lagging indicators — they confirm trends after they start. Use them to validate, not predict.`,
  },
  {
    icon: Brain,
    color: 'text-cyan-400',
    title: 'ML Prediction Card',
    subtitle: 'LightGBM + XGBoost ensemble',
    body: `A machine-learning model trained on up to 3 years of that symbol's daily OHLCV + market context features (SPY trend, VIX, sector ETF, yield curve, DXY, credit spread, earnings dates).

Key numbers to read:
• Direction + Confidence — calibrated probability that next session (1D) / next week (1W) / next month (1M) closes higher. 53% = slight lean, not certainty. 63% = meaningful statistical edge.
• Walk-Forward Accuracy (green/red bars) — the model was re-trained 20–35 times on a rolling window and tested on ~10 days of held-out data each time. Each bar = one round. Hover to see what happened in that period (regime, SPY move, earnings).
• Feature Importance — top 5 inputs driving THIS prediction. If spy_ret_20d is #1, the market trend matters most today.
• Regime Badge — BULL (SPY up >3% over 20d) or BEAR (SPY down >3%). Models in bull regimes have higher follow-through.
• Earnings Blackout Banner — appears if earnings are within 5 days. During blackout, price will react to EPS surprise (unpredictable), not chart patterns. Treat prediction with extra caution.

Horizon tabs (1D / 1W / 1M): each uses a separately trained classifier. Longer horizons have fewer WF rounds and wider uncertainty — use 1D for trading, 1W/1M for position-sizing awareness.

Training Periods: 3Y (default) = ~450 filtered samples across multiple market regimes. Best balance of recency and diversity.`,
  },
  {
    icon: Calculator,
    color: 'text-orange-400',
    title: 'Scenario Calculator',
    subtitle: 'Risk/reward projector',
    body: `Translates the ML prediction into concrete price targets for your chosen position size.

Inputs: Entry price (defaults to current price), Quantity (shares or coins).
Outputs:
• Take Profit — entry + ATR × TP multiplier (1.5× for 1D, 3.0× for 1W, 6.0× for 1M)
• Stop Loss — entry − ATR × SL multiplier (1.0× for 1D, 2.0× for 1W, 4.0× for 1M)
• Expected P&L at each scenario

ATR (Average True Range) = typical daily volatility for the symbol. A high-ATR stock like NVDA has wider targets than a low-ATR stock like WMT.

The calculator is orientation only — it does NOT account for slippage, commissions, or gap risk.`,
  },
  {
    icon: Layers,
    color: 'text-indigo-400',
    title: 'Options Flow Panel',
    subtitle: 'Stocks only — institutional positioning',
    body: `Fetches the nearest-expiry options chain via yfinance and computes 5 key metrics. Hidden for crypto.

• P/C OI Ratio — put open interest ÷ call open interest. <0.7 = calls dominate (bullish); >1.3 = puts dominate (hedging/bearish).
• P/C Volume Ratio — same concept but for today's traded volume. More reactive but noisier than OI.
• ATM IV% — at-the-money implied volatility (annualised). Shows how expensive options are: <20% calm, 20–40% normal, >40% fear or event risk.
• IV Skew — ATM put IV minus ATM call IV. Positive = fear premium (puts more expensive than calls). Near zero = balanced sentiment.
• Max Pain — the strike price where option holders lose the most money at expiration. Market-makers tend to hedge toward this level as expiry approaches, creating a gravitational pull. If max pain is >+0.5% above price, there's a bullish pull.

Signals 8 & 9 in Conviction Score are derived from P/C OI Ratio and Max Pain distance respectively.
Options data is cached 30 minutes (it doesn't change tick-by-tick).`,
  },
  {
    icon: Newspaper,
    color: 'text-slate-400',
    title: 'News Panel',
    subtitle: 'Headline sentiment',
    body: `Fetches recent headlines from Yahoo Finance RSS (stocks) or Google News RSS (crypto).

Sentiment is computed with keyword scoring: each article counts positive and negative financial words. The aggregate bar shows the balance across all articles.

POSITIVE / NEGATIVE sentiment can shift ML confidence ±12 percentage points (applied AFTER probability calibration). This means genuine positive news can push a 52% ML signal to 64%, making it actionable.

⚠ Keyword scoring misses sarcasm and context nuance. A headline like "NVDA plunges — then recovers" might score neutral. Cross-check with a full article if the sentiment seems wrong.`,
  },
]

export default function HelpModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div
        className="relative bg-dark-800 border border-dark-600 rounded-xl shadow-2xl w-full max-w-2xl my-8"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-600">
          <div>
            <h2 className="text-lg font-bold text-slate-100">How to Read the Market Tab</h2>
            <p className="text-xs text-slate-500 mt-0.5">Section-by-section guide — use NVIDIA as your mental model</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-dark-700 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* NVIDIA visual example */}
        <p className="mx-6 mt-5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Example walkthrough — NVIDIA (NVDA)
        </p>
        <NvidiaExample />

        {/* Sections */}
        <div className="px-6 pb-6 space-y-5 mt-4">
          {SECTIONS.map(({ icon: Icon, color, title, subtitle, body }) => (
            <div key={title} className="flex gap-4">
              <div className={`flex-shrink-0 mt-0.5 ${color}`}>
                <Icon size={16} />
              </div>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-sm font-semibold text-slate-100">{title}</span>
                  <span className="text-xs text-slate-500">{subtitle}</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">{body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5">
          <p className="text-xs text-slate-600 border-t border-dark-600 pt-3">
            ⚠ All signals are probabilistic, not guarantees. Past walk-forward accuracy does not guarantee future performance.
            Never risk more than you can afford to lose. This tool is for informational purposes only.
          </p>
        </div>
      </div>
    </div>
  )
}
