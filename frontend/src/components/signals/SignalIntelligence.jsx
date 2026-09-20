import { useState, useEffect } from 'react'
import { useSignalPerformance, useBacktestStatus } from '../../api/signalPerformance'
import { Brain, TrendingUp, TrendingDown, Minus, Search, Loader2 } from 'lucide-react'
import Tooltip from '../ui/Tooltip'

// ── Tooltip text ───────────────────────────────────────────────────────────────

const TIPS = {
  heading:
    'Tracks how reliable each conviction signal has actually been, and auto-adjusts its weight based on results.\n\n"This Stock" backtests signal accuracy against 6 months of price history for one symbol. "All Signals" shows live weights tuned from every resolved prediction across the universe.',

  winLoss:
    'Win / Loss — how many times this signal\'s direction call matched (win) or missed (loss) the actual price move.\n\nFewer than 10 calls is too small a sample to trust — shown as "Learning" instead of a weight.',

  accuracy:
    'Win rate for this signal alone.\n\n≥55% = the signal has a real edge (green).\n≤45% = the signal is actively wrong more than right (red).\nIn between = no clear edge either way.',

  weight:
    'Multiplier applied to this signal\'s vote in the conviction score.\n\n>1.05× = boosted — it has been more reliable than average, so it counts for more.\n<0.95× = penalised — it has been less reliable, so it counts for less.\n~1.0× = neutral, or still learning (fewer than 10 resolved calls).',

  status:
    'Boosted = weight raised because this signal has out-performed.\nPenalised = weight cut because this signal has under-performed.\nLearning = fewer than 10 resolved calls — not enough data yet to adjust its weight.',

  modeToggle:
    '"This Stock" — signal accuracy backtested specifically for this symbol (6-month price history).\n"All Signals" — live weights tuned from every resolved prediction across the whole scanned universe, not just this symbol.',

  statsTracked:
    'Total number of distinct signals being tracked and weighted across the universe.',
  statsBoosted:
    'Signals currently weighted above 1.0× because they have out-performed.',
  statsPenalised:
    'Signals currently weighted below 1.0× because they have under-performed.',
}

const STATUS_CFG = {
  boosted:   { label: 'Boosted',    color: 'text-brand-400', bg: 'bg-brand-500/10',  Icon: TrendingUp   },
  penalised: { label: 'Penalised',  color: 'text-red-400',   bg: 'bg-red-400/10',    Icon: TrendingDown },
  learning:  { label: 'Learning',   color: 'text-slate-400', bg: 'bg-dark-600/50',   Icon: Minus        },
}

function AccuracyBar({ pct }) {
  const isBetter = pct >= 50
  return (
    <div className="relative h-1.5 w-24 bg-dark-600 rounded-full overflow-hidden">
      <div className="absolute top-0 left-1/2 w-px h-full bg-slate-500 z-10" />
      {isBetter ? (
        <div className="absolute top-0 h-full bg-brand-500 rounded-full"
          style={{ left: '50%', width: `${Math.min((pct - 50) * 2, 100)}%` }} />
      ) : (
        <div className="absolute top-0 h-full bg-red-500 rounded-full"
          style={{ right: '50%', width: `${Math.min((50 - pct) * 2, 100)}%` }} />
      )}
    </div>
  )
}

function SignalTable({ signals, emptyMsg }) {
  if (!signals || signals.length === 0)
    return <p className="px-4 py-8 text-center text-slate-500 text-sm">{emptyMsg}</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-dark-600/40">
            <th className="text-left pl-4 pr-2 py-2 font-medium">Signal</th>
            <th className="text-center px-3 py-2 font-medium">
              <Tooltip text={TIPS.winLoss}>
                <span className="cursor-help underline decoration-dotted">W / L</span>
              </Tooltip>
            </th>
            <th className="text-center px-3 py-2 font-medium">
              <Tooltip text={TIPS.accuracy}>
                <span className="cursor-help underline decoration-dotted">Accuracy</span>
              </Tooltip>
            </th>
            <th className="text-center px-3 py-2 font-medium hidden sm:table-cell">
              <Tooltip text={TIPS.weight}>
                <span className="cursor-help underline decoration-dotted">Weight</span>
              </Tooltip>
            </th>
            <th className="text-center pl-3 pr-4 py-2 font-medium">
              <Tooltip text={TIPS.status}>
                <span className="cursor-help underline decoration-dotted">Status</span>
              </Tooltip>
            </th>
          </tr>
        </thead>
        <tbody>
          {signals.map(sig => {
            const cfg       = STATUS_CFG[sig.status] ?? STATUS_CFG.learning
            const { Icon }  = cfg
            const learning  = sig.total_count < 10

            return (
              <tr key={sig.signal_name} className="border-b border-dark-600/20 hover:bg-dark-700/30 transition-colors">
                <td className="pl-4 pr-2 py-2.5 font-medium text-slate-200">{sig.signal_name}</td>
                <td className="px-3 py-2.5 text-center text-slate-400 tabular-nums">
                  <span className="text-brand-400">{sig.win_count}</span>
                  <span className="text-slate-600 mx-1">/</span>
                  <span className="text-red-400">{sig.loss_count}</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col items-center gap-1">
                    <span className={`text-xs font-semibold tabular-nums ${
                      learning ? 'text-slate-500'
                      : sig.accuracy_pct >= 55 ? 'text-brand-400'
                      : sig.accuracy_pct <= 45 ? 'text-red-400'
                      : 'text-slate-300'
                    }`}>
                      {learning ? '—' : `${sig.accuracy_pct.toFixed(0)}%`}
                    </span>
                    {!learning && <AccuracyBar pct={sig.accuracy_pct} />}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                  {learning ? (
                    <span className="text-slate-600 text-xs">1.0×</span>
                  ) : (
                    <span className={`text-xs font-semibold ${
                      sig.weight > 1.05 ? 'text-brand-400'
                      : sig.weight < 0.95 ? 'text-red-400'
                      : 'text-slate-400'
                    }`}>{sig.weight.toFixed(2)}×</span>
                  )}
                </td>
                <td className="pl-3 pr-4 py-2.5 text-center">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                    <Icon size={10} />
                    {cfg.label}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// `symbol`: when provided (embedded in the Market tab), scopes this component
// to that one stock — opens straight into "This Stock" mode with no internal
// search box (redundant with the page's own symbol search) and re-scopes
// automatically as the selected symbol changes. Omit it (Recommendations page)
// to get the original universe-wide view with its own symbol lookup.
export default function SignalIntelligence({ symbol: symbolProp } = {}) {
  const embedded = !!symbolProp
  const [symbol, setSymbol]     = useState(symbolProp || '')
  const [inputVal, setInputVal] = useState('')
  const [mode, setMode]         = useState(embedded ? 'stock' : 'global')  // 'global' | 'stock'

  // Re-scope if the embedding page's selected symbol changes.
  useEffect(() => {
    if (symbolProp) { setSymbol(symbolProp); setMode('stock') }
  }, [symbolProp])

  const { data, isLoading }        = useSignalPerformance(mode === 'stock' ? symbol : null)
  const { data: btStatus }         = useBacktestStatus()

  const globalSignals   = data?.global_signals   ?? []
  const perStockSignals = data?.per_stock_signals ?? []
  const totalResolved   = data?.total_resolved    ?? 0
  const learningActive  = data?.learning_active   ?? false
  const backtestRunning = btStatus?.running       ?? false

  const boosted    = globalSignals.filter(s => s.status === 'boosted').length
  const penalised  = globalSignals.filter(s => s.status === 'penalised').length

  const handleSearch = () => {
    const s = inputVal.trim().toUpperCase()
    if (s) { setSymbol(s); setMode('stock') }
  }

  return (
    <div className="card space-y-0">

      {/* Header */}
      <div className="px-4 py-4 border-b border-dark-600/60 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-brand-500/10">
            <Brain size={17} className="text-brand-400" />
          </div>
          <div>
            <Tooltip text={TIPS.heading} wide>
              <h3 className="text-sm font-semibold text-slate-100 cursor-help underline decoration-dotted inline-block">
                Signal Intelligence{embedded && symbol ? ` — ${symbol}` : ''}
              </h3>
            </Tooltip>
            <p className="text-xs text-slate-500 mt-0.5">
              {backtestRunning
                ? 'Running per-stock backtest… weights updating'
                : embedded
                  ? `${data?.per_stock_signals?.[0]?.total_count ?? 0} trading days evaluated · 6-month backtest`
                  : `Auto-tuned from ${totalResolved.toLocaleString()} resolved predictions + 6-month backtest`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {backtestRunning && <Loader2 size={14} className="text-brand-400 animate-spin" />}
          {learningActive && !backtestRunning && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-xs text-brand-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
              Learning
            </span>
          )}
        </div>
      </div>

      {/* Tab + Search bar */}
      <div className="px-4 py-3 border-b border-dark-600/60 flex flex-wrap items-center gap-3">
        <Tooltip text={TIPS.modeToggle} wide>
          <div className="flex rounded-lg overflow-hidden border border-dark-600 cursor-help">
            {[
              { id: 'stock',  label: 'This Stock' },
              { id: 'global', label: 'All Signals' },
            ].map(({ id, label }) => (
              <button key={id}
                onClick={() => setMode(id)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === id
                    ? 'bg-brand-600 text-dark-900'
                    : 'bg-dark-700 text-slate-400 hover:text-slate-200'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </Tooltip>

        {mode === 'stock' && !embedded && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-dark-700 border border-dark-600 rounded-lg px-3 py-1.5">
              <Search size={13} className="text-slate-500" />
              <input
                value={inputVal}
                onChange={e => setInputVal(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="AAPL"
                className="bg-transparent text-sm text-slate-200 placeholder-slate-600 outline-none w-20"
              />
            </div>
            <button onClick={handleSearch}
              className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-dark-900 text-xs font-semibold transition-colors">
              Search
            </button>
            {symbol && (
              <button onClick={() => { setSymbol(''); setInputVal(''); }}
                className="text-xs text-slate-500 hover:text-slate-300">
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Stats row — global mode only */}
      {mode === 'global' && learningActive && (
        <div className="grid grid-cols-3 divide-x divide-dark-600/60 border-b border-dark-600/60">
          <Tooltip text={TIPS.statsTracked}>
            <div className="px-4 py-3 text-center cursor-help">
              <div className="text-lg font-bold text-slate-100">{globalSignals.length}</div>
              <div className="text-xs text-slate-500 underline decoration-dotted">Signals tracked</div>
            </div>
          </Tooltip>
          <Tooltip text={TIPS.statsBoosted}>
            <div className="px-4 py-3 text-center cursor-help">
              <div className="text-lg font-bold text-brand-400">{boosted}</div>
              <div className="text-xs text-slate-500 underline decoration-dotted">Boosted</div>
            </div>
          </Tooltip>
          <Tooltip text={TIPS.statsPenalised}>
            <div className="px-4 py-3 text-center cursor-help">
              <div className="text-lg font-bold text-red-400">{penalised}</div>
              <div className="text-xs text-slate-500 underline decoration-dotted">Penalised</div>
            </div>
          </Tooltip>
        </div>
      )}

      {/* Tables */}
      {isLoading ? (
        <div className="px-4 py-8 space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-9 bg-dark-700/60 rounded animate-pulse" />
          ))}
        </div>
      ) : mode === 'global' ? (
        <SignalTable
          signals={globalSignals}
          emptyMsg="No signal data yet — weights appear once predictions start resolving" />
      ) : (
        <SignalTable
          signals={perStockSignals}
          emptyMsg={
            symbol
              ? `No backtest data yet for ${symbol} — runs Sunday night or on startup`
              : 'Enter a stock symbol above to see its signal accuracy'
          } />
      )}

      <div className="px-4 py-2.5 border-t border-dark-600/60 text-xs text-slate-500">
        Global weights: live resolved predictions · Per-stock weights: 6-month price history backtest · Refresh: weekly Sunday 03:00
      </div>
    </div>
  )
}
