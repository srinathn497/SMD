import { useState } from 'react'
import { Scissors } from 'lucide-react'

const CATEGORY_META = {
  momentum:    { label: 'Momentum',     color: '#3b82f6' },
  trend:       { label: 'Trend',        color: '#22c55e' },
  returns:     { label: 'Returns',      color: '#06b6d4' },
  volume:      { label: 'Volume',       color: '#a855f7' },
  volatility:  { label: 'Volatility',   color: '#eab308' },
  price_pos:   { label: 'Price Pos.',   color: '#f97316' },
  candlestick: { label: 'Candlestick',  color: '#94a3b8' },
  market:      { label: 'Market',       color: '#6366f1' },
  regime:      { label: 'Regime',       color: '#f43f5e' },
  earnings:    { label: 'Earnings',     color: '#14b8a6' },
  macro:       { label: 'Macro',        color: '#f59e0b' },
  fundamentals:{ label: 'Fundamentals', color: '#10b981' },
  other:       { label: 'Other',        color: '#64748b' },
}

const FEATURE_LABELS = {
  rsi_14: 'RSI (14)', macd_hist: 'MACD Hist', macd_signal: 'MACD Signal',
  bb_pct: 'BB %B', bb_width: 'BB Width',
  ema_diff: 'EMA Diff', ema_slope: 'EMA Slope',
  sma_50_dist: 'SMA50 Dist', sma_200_dist: 'SMA200 Dist',
  ret_1d: 'Return 1D', ret_3d: 'Return 3D', ret_5d: 'Return 5D',
  ret_10d: 'Return 10D', ret_20d: 'Return 20D',
  volume_ratio: 'Vol Ratio', volume_trend: 'Vol Trend',
  atr_pct: 'ATR %', volatility_20d: 'Volatility 20D',
  parkinson_vol_20d: 'Parkinson Vol', hv_ratio: 'HV Ratio',
  vol_regime: 'Vol Regime', realized_skewness_20d: 'Return Skew',
  dist_52w_high: '52W High Dist', dist_52w_low: '52W Low Dist',
  gap_open: 'Gap Open', close_position: 'Close Position',
  daily_range: 'Daily Range', body_size: 'Body Size',
  upper_shadow: 'Upper Shadow', lower_shadow: 'Lower Shadow',
  spy_ret_1d: 'SPY 1D', spy_ret_5d: 'SPY 5D', spy_ret_20d: 'SPY 20D',
  vix_level: 'VIX Level', vix_change_5d: 'VIX Change 5D',
  rs_vs_spy_5d: 'RS vs SPY 5D', rs_vs_spy_20d: 'RS vs SPY 20D',
  sector_ret_5d: 'Sector 5D', sector_rs_5d: 'Sector RS',
  mkt_breadth_5d: 'Mkt Breadth', vix_term_structure: 'VIX Term',
  regime_bull: 'Bull Regime', regime_bear: 'Bear Regime',
  earnings_in_5d: 'Earnings ≤5D', days_to_next_earnings: 'Days to Earn',
  days_since_earnings: 'Days Since Earn',
  yield_curve: 'Yield Curve', dxy_ret_5d: 'DXY 5D', credit_spread: 'Credit Spread',
  eps_surprise_pct: 'EPS Surprise', revenue_growth_yoy: 'Revenue Growth',
}

function FeatureRow({ item, maxPct }) {
  const meta  = CATEGORY_META[item.category] ?? CATEGORY_META.other
  const width = maxPct > 0 ? (item.importance_pct / maxPct) * 100 : 0

  return (
    <div className="flex items-center gap-2 group">
      {/* category dot */}
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: meta.color }}
      />
      {/* label */}
      <span className="text-xs text-slate-400 w-32 truncate flex-shrink-0">
        {FEATURE_LABELS[item.name] ?? item.name}
      </span>
      {/* bar */}
      <div className="flex-1 h-2 bg-dark-600/60 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${width}%`, backgroundColor: meta.color, opacity: 0.8 }}
        />
      </div>
      {/* pct */}
      <span className="text-xs text-slate-500 w-9 text-right flex-shrink-0">
        {item.importance_pct}%
      </span>
    </div>
  )
}

export default function FeatureImportanceChart({ importances1d = [], importances1w = [], pruned1d = [], pruned1w = [] }) {
  const [hz, setHz] = useState('1d')

  const items   = hz === '1d' ? importances1d : importances1w
  const pruned  = hz === '1d' ? pruned1d      : pruned1w
  const maxPct  = items[0]?.importance_pct ?? 1

  if (!items.length) return null

  // Group by category for the legend
  const cats = [...new Set(items.map(i => i.category))]

  return (
    <div className="space-y-3">
      {/* Header + toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Feature Importance
        </span>
        <div className="flex gap-1 bg-dark-700/60 rounded-lg p-0.5">
          {['1d', '1w'].map(h => (
            <button
              key={h}
              onClick={() => setHz(h)}
              className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition-all ${
                hz === h
                  ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {h.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Category legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {cats.map(cat => {
          const m = CATEGORY_META[cat] ?? CATEGORY_META.other
          return (
            <div key={cat} className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.color }} />
              <span className="text-[10px] text-slate-600">{m.label}</span>
            </div>
          )
        })}
      </div>

      {/* Bars */}
      <div className="space-y-1.5">
        {items.map(item => (
          <FeatureRow key={item.name} item={item} maxPct={maxPct} />
        ))}
      </div>

      {/* Pruned footer */}
      {pruned.length > 0 && (
        <div className="flex items-start gap-1.5 pt-1 border-t border-dark-600/40">
          <Scissors size={10} className="text-slate-600 mt-0.5 flex-shrink-0" />
          <p className="text-[10px] text-slate-600 leading-relaxed">
            <span className="text-slate-500">Pruned (&lt;1%):</span>{' '}
            {pruned.map(f => FEATURE_LABELS[f] ?? f).join(', ')}
          </p>
        </div>
      )}
    </div>
  )
}
