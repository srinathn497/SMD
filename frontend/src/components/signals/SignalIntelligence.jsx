import { useState } from 'react'
import { useSignalPerformance, useBacktestStatus } from '../../api/signalPerformance'
import { Brain, TrendingUp, TrendingDown, Minus, Search, Loader2, RefreshCw } from 'lucide-react'

const STATUS_CFG = {
  boosted:   { label: 'Boosted',    color: 'text-green-400', bg: 'bg-green-400/10',  Icon: TrendingUp   },
  penalised: { label: 'Penalised',  color: 'text-red-400',   bg: 'bg-red-400/10',    Icon: TrendingDown },
  learning:  { label: 'Learning',   color: 'text-slate-400', bg: 'bg-slate-700/50',  Icon: Minus        },
}

function AccuracyBar({ pct }) {
  const isBetter = pct >= 50
  return (
    <div className="relative h-1.5 w-24 bg-slate-700 rounded-full overflow-hidden">
      <div className="absolute top-0 left-1/2 w-px h-full bg-slate-500 z-10" />
      {isBetter ? (
        <div className="absolute top-0 h-full bg-green-500 rounded-full"
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
    return <p className="px-6 py-8 text-center text-slate-500 text-sm">{emptyMsg}</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 border-b border-slate-700/50">
            <th className="text-left px-4 py-2 font-medium">Signal</th>
            <th className="text-center px-3 py-2 font-medium">W / L</th>
            <th className="text-center px-3 py-2 font-medium">Accuracy</th>
            <th className="text-center px-3 py-2 font-medium hidden sm:table-cell">Weight</th>
            <th className="text-center px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/30">
          {signals.map(sig => {
            const cfg       = STATUS_CFG[sig.status] ?? STATUS_CFG.learning
            const { Icon }  = cfg
            const learning  = sig.total_count < 10

            return (
              <tr key={sig.signal_name} className="hover:bg-slate-700/20 transition-colors">
                <td className="px-4 py-2.5 font-medium text-slate-200">{sig.signal_name}</td>
                <td className="px-3 py-2.5 text-center text-slate-400 tabular-nums">
                  <span className="text-green-400">{sig.win_count}</span>
                  <span className="text-slate-600 mx-1">/</span>
                  <span className="text-red-400">{sig.loss_count}</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col items-center gap-1">
                    <span className={`text-xs font-semibold tabular-nums ${
                      learning ? 'text-slate-500'
                      : sig.accuracy_pct >= 55 ? 'text-green-400'
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
                      sig.weight > 1.05 ? 'text-green-400'
                      : sig.weight < 0.95 ? 'text-red-400'
                      : 'text-slate-400'
                    }`}>{sig.weight.toFixed(2)}×</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${cfg.bg} ${cfg.color}`}>
                    <Icon size={10} />
                    {learning ? 'Learning' : cfg.label}
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

export default function SignalIntelligence() {
  const [symbol, setSymbol]     = useState('')
  const [inputVal, setInputVal] = useState('')
  const [mode, setMode]         = useState('global')  // 'global' | 'stock'

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
    <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 overflow-hidden">

      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-700/50 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10">
            <Brain size={17} className="text-purple-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Signal Intelligence</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {backtestRunning
                ? 'Running per-stock backtest… weights updating'
                : `Auto-tuned from ${totalResolved.toLocaleString()} resolved predictions + 6-month backtest`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {backtestRunning && <Loader2 size={14} className="text-purple-400 animate-spin" />}
          {learningActive && !backtestRunning && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-xs text-purple-300 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              Learning
            </span>
          )}
        </div>
      </div>

      {/* Tab + Search bar */}
      <div className="px-5 py-3 border-b border-slate-700/50 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg overflow-hidden border border-slate-700">
          {[
            { id: 'global', label: 'All Signals' },
            { id: 'stock',  label: 'Per Stock'   },
          ].map(({ id, label }) => (
            <button key={id}
              onClick={() => setMode(id)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === id
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {mode === 'stock' && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-1.5">
              <Search size={13} className="text-slate-400" />
              <input
                value={inputVal}
                onChange={e => setInputVal(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="AAPL"
                className="bg-transparent text-sm text-slate-200 placeholder-slate-500 outline-none w-20"
              />
            </div>
            <button onClick={handleSearch}
              className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium transition-colors">
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
        <div className="grid grid-cols-3 divide-x divide-slate-700/50 border-b border-slate-700/50">
          <div className="px-4 py-3 text-center">
            <div className="text-lg font-bold text-white">{globalSignals.length}</div>
            <div className="text-xs text-slate-400">Signals tracked</div>
          </div>
          <div className="px-4 py-3 text-center">
            <div className="text-lg font-bold text-green-400">{boosted}</div>
            <div className="text-xs text-slate-400">Boosted</div>
          </div>
          <div className="px-4 py-3 text-center">
            <div className="text-lg font-bold text-red-400">{penalised}</div>
            <div className="text-xs text-slate-400">Penalised</div>
          </div>
        </div>
      )}

      {/* Tables */}
      {isLoading ? (
        <div className="px-4 py-8 space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-9 bg-slate-700/40 rounded animate-pulse" />
          ))}
        </div>
      ) : mode === 'global' ? (
        <SignalTable
          signals={globalSignals}
          emptyMsg="No signal data yet — weights appear once predictions start resolving" />
      ) : (
        <>
          {symbol && perStockSignals.length > 0 && (
            <div className="px-5 py-2 border-b border-slate-700/30 text-xs text-slate-400">
              Showing backtested weights for <span className="text-white font-semibold">{symbol}</span>
              {' '}— {perStockSignals[0]?.total_count ?? 0}+ trading days evaluated
            </div>
          )}
          <SignalTable
            signals={perStockSignals}
            emptyMsg={
              symbol
                ? `No backtest data yet for ${symbol} — runs Sunday night or on startup`
                : 'Enter a stock symbol above to see its signal accuracy'
            } />
        </>
      )}

      <div className="px-5 py-2.5 border-t border-slate-700/50 text-xs text-slate-500">
        Global weights: live resolved predictions · Per-stock weights: 6-month price history backtest · Refresh: weekly Sunday 03:00
      </div>
    </div>
  )
}
