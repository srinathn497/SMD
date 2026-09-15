import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Trophy, RefreshCw, Loader2, TrendingUp, TrendingDown, Minus, Cpu } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import {
  useConvictionLeaderboard, useConvictionScanStatus, useTriggerConvictionScan,
  useModelRefreshStatus, useTriggerModelRefresh,
} from '../../api/conviction'
import { useMarketStore } from '../../store/marketStore'

// ── Tooltip text ───────────────────────────────────────────────────────────────

const TIPS = {
  heading:
    'Conviction Score ranks every symbol by how many independent signals agree on a direction.\n\n17 signals are checked for stocks: ML models, RSI/MACD/BB technicals, news sentiment, volume, intraday score, breakout, mean reversion, fundamentals (FCF, D/E, P/E), and options-proxy signals.\n\nThresholds: ≥78% of signals = HIGH CONVICTION · ≥50% = MODERATE · ≥28% = WEAK.',

  score:
    'Number of signals agreeing on this symbol\'s direction out of the total signals evaluated.\n\nHigher score = more signals in agreement = stronger conviction.\n\n≥78%: 🔥 HIGH CONVICTION\n≥50%: ⚡ MODERATE\n≥28%: 〰 WEAK\n<28%: — NEUTRAL',

  direction:
    'Majority direction across all signals.\n\nBUY = majority of signals point UP.\nSELL = majority of signals point DOWN.\nNEUTRAL = signals are split with no clear majority.',

  label:
    'Conviction strength based on % of signals agreeing:\n🔥 HIGH CONVICTION (≥78%): Strong supermajority — most reliable signal.\n⚡ MODERATE (≥50%): Simple majority — clear lean.\n〰 WEAK (≥28%): Minority agreement — treat as a watch, not an entry.\n— NEUTRAL (<28%): No directional signal.',

  scanBtn:
    'Re-run the conviction scan for all ~100 symbols.\nTakes ~4–8 minutes. Results update in real time as each symbol is scored.\n\nThe scan also runs automatically every day at 06:00.',

  refreshBtn:
    'Retrain stale / old-schema ML models in the background.\n\nRun this after the machine has been off for a while — otherwise Scan skips the ML signal for every stale symbol. Only symbols that actually need it are retrained; safe to leave running.',
}

// ── Config ─────────────────────────────────────────────────────────────────────

const LABEL_CONFIG = {
  HIGH_CONVICTION: { color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30', emoji: '🔥' },
  MODERATE:        { color: 'text-brand-400',  bg: 'bg-brand-500/10 border-brand-500/30',   emoji: '⚡' },
  WEAK:            { color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30', emoji: '〰' },
  NEUTRAL:         { color: 'text-slate-500',  bg: 'bg-dark-600 border-dark-500',           emoji: '—'  },
}

const DIR_CONFIG = {
  BUY:     { color: 'text-emerald-400', Icon: TrendingUp },
  SELL:    { color: 'text-red-400',     Icon: TrendingDown },
  NEUTRAL: { color: 'text-slate-500',   Icon: Minus },
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ScoreBar({ score, maxScore = 7 }) {
  const pct = Math.round((score / maxScore) * 100)
  const color =
    score >= 6 ? 'bg-yellow-500' :
    score >= 4 ? 'bg-brand-500' :
    score >= 2 ? 'bg-orange-500' :
    'bg-slate-600'
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 bg-dark-600 rounded-full overflow-hidden" style={{ minWidth: 60 }}>
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap">{score}/{maxScore}</span>
    </div>
  )
}

function DirectionBadge({ direction }) {
  const cfg = DIR_CONFIG[direction] ?? DIR_CONFIG.NEUTRAL
  const { Icon } = cfg
  return (
    <span className={`flex items-center gap-1 text-xs font-semibold ${cfg.color}`}>
      <Icon size={12} />
      {direction}
    </span>
  )
}

function LabelBadge({ label }) {
  const cfg = LABEL_CONFIG[label] ?? LABEL_CONFIG.NEUTRAL
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cfg.bg} ${cfg.color} whitespace-nowrap`}>
      {cfg.emoji} {label.replace('_', ' ')}
    </span>
  )
}

function GapInfo({ row }) {
  if (row.label === 'HIGH_CONVICTION' || row.label === 'NEUTRAL' || row.direction === 'NEUTRAL') return null
  if (!row.signals || row.signals.length === 0) return null

  const hcThreshold = Math.max(1, Math.round(row.max_score * 0.78))
  const needed = Math.max(0, hcThreshold - row.score)
  if (needed === 0) return (
    <p className="text-xs text-brand-400 mt-0.5">Almost HIGH CONVICTION — monitor for final flip</p>
  )

  const failing = row.signals.filter(s => !s.passed)
  const names = failing.slice(0, 3).map(s => s.name)
  const color = row.label === 'MODERATE' ? 'text-brand-400' : 'text-orange-400'

  return (
    <div className={`mt-0.5 text-xs ${color} flex flex-wrap items-center gap-x-1.5 gap-y-0`}>
      <span className="text-slate-500">{needed} more {needed === 1 ? 'signal' : 'signals'} needed ·</span>
      {names.map(n => (
        <span key={n} className="bg-dark-600 border border-dark-500 rounded px-1 py-px text-slate-400">{n}</span>
      ))}
    </div>
  )
}

function LeaderboardRow({ rank, row, onClick, onAnalyze }) {
  return (
    <tr
      className="border-b border-dark-600/40 hover:bg-dark-700/40 cursor-pointer transition-colors group"
      onClick={() => onClick(row.symbol, row.asset_type)}
    >
      <td className="pl-4 pr-2 py-3 text-sm text-slate-400 tabular-nums w-8">{rank}</td>
      <td className="px-2 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-100 text-sm">{row.symbol}</span>
            {row.asset_type === 'crypto' && (
              <span className="text-xs text-slate-500 uppercase">crypto</span>
            )}
            {onAnalyze && row.asset_type !== 'crypto' && (
              <button
                onClick={e => { e.stopPropagation(); onAnalyze(row.symbol, row.asset_type) }}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1.5 py-px rounded bg-brand-600/20 border border-brand-600/30 text-brand-400 hover:bg-brand-600/30"
              >
                Analyze
              </button>
            )}
          </div>
          <GapInfo row={row} />
        </div>
      </td>
      <td className="px-2 py-3 w-40">
        <ScoreBar score={row.score} maxScore={row.max_score} />
      </td>
      <td className="px-2 py-3 w-24">
        <DirectionBadge direction={row.direction} />
      </td>
      <td className="px-2 pr-4 py-3 text-right">
        <LabelBadge label={row.label} />
      </td>
    </tr>
  )
}

function EmptyState({ onScan, scanning }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
      <Trophy size={36} className="text-slate-600" />
      <div>
        <p className="text-slate-300 font-medium">No leaderboard data yet</p>
        <p className="text-slate-500 text-sm mt-1">
          Run a scan to rank all 50 symbols by conviction score. Takes ~4 min.
        </p>
      </div>
      <button
        onClick={onScan}
        disabled={scanning}
        className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
      >
        {scanning ? <Loader2 size={14} className="animate-spin" /> : <Trophy size={14} />}
        {scanning ? 'Scanning…' : 'Run First Scan'}
      </button>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ConvictionLeaderboard({ onAnalyze } = {}) {
  const [minScore, setMinScore] = useState(0)
  const [direction, setDirection] = useState('all')
  const limit = 10

  const qc = useQueryClient()
  const [justTriggered, setJustTriggered] = useState(false)
  const wasRunning = useRef(false)
  const trigger = useTriggerConvictionScan()
  const { data: scanStatus } = useConvictionScanStatus(true)
  const setSymbol = useMarketStore(s => s.setSymbol)
  const navigate = useNavigate()

  const scanning = trigger.isPending || justTriggered || !!scanStatus?.running
  const { data: rows = [], isLoading } = useConvictionLeaderboard(limit, minScore, direction, scanning)

  // ── Model refresh ──────────────────────────────────────────────────────────
  const refreshTrigger = useTriggerModelRefresh()
  const [refreshJustTriggered, setRefreshJustTriggered] = useState(false)
  const { data: refreshStatus } = useModelRefreshStatus(true)
  const refreshing = refreshTrigger.isPending || refreshJustTriggered || !!refreshStatus?.running

  const rs = refreshStatus
  const refreshDone = rs ? (rs.trained ?? 0) + (rs.skipped ?? 0) + (rs.failed ?? 0) : 0
  const refreshProgress = rs?.total ? `${refreshDone}/${rs.total}` : ''

  useEffect(() => {
    if (refreshStatus?.running && refreshJustTriggered) setRefreshJustTriggered(false)
  }, [refreshStatus?.running, refreshJustTriggered])

  const handleRefreshModels = () => {
    if (refreshing || scanning) return
    setRefreshJustTriggered(true)
    refreshTrigger.mutate(false, { onError: () => setRefreshJustTriggered(false) })
  }

  useEffect(() => {
    if (scanStatus?.running) {
      wasRunning.current = true
    }
    // Scan just finished — force an immediate refetch so timestamp updates right away.
    if (!scanStatus?.running && wasRunning.current) {
      wasRunning.current = false
      setJustTriggered(false)
      qc.refetchQueries({ queryKey: ['conviction-leaderboard'] })
    }
  }, [scanStatus?.running, qc])

  const handleScan = () => {
    if (!scanning) {
      setJustTriggered(true)   // immediately disable button before first poll
      trigger.mutate(undefined, {
        onError: () => setJustTriggered(false),   // reset on failure
      })
    }
  }

  const handleRowClick = (symbol, assetType) => {
    setSymbol(symbol, assetType)
    navigate('/market')
  }

  // Show date + time of most recent scan (use MAX across all rows — more robust than rows[0])
  const computedAt = (() => {
    const timestamps = rows.map(r => r.computed_at).filter(Boolean)
    if (!timestamps.length) return null
    const raw = timestamps.reduce((a, b) => (a > b ? a : b))
    const d   = new Date(raw)
    const now = new Date()
    const isToday     = d.toDateString() === now.toDateString()
    const isYesterday = d.toDateString() === new Date(now - 864e5).toDateString()
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const dateStr = isToday ? 'Today' : isYesterday ? 'Yesterday'
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    return `${dateStr} ${timeStr}`
  })()

  return (
    <div className="card space-y-0">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 p-4 border-b border-dark-600/60">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-yellow-400" />
          <Tooltip text={TIPS.heading} wide>
            <h3 className="font-semibold text-slate-100 cursor-help underline decoration-dotted">Conviction Leaderboard</h3>
          </Tooltip>
          <span className="text-xs text-slate-400">Top {limit} by signal agreement</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Direction filter */}
          <select
            value={direction}
            onChange={e => setDirection(e.target.value)}
            className="text-xs bg-dark-700 border border-dark-500 rounded-md px-2 py-1 text-slate-300 focus:outline-none focus:border-brand-500"
          >
            <option value="all">All Directions</option>
            <option value="BUY">BUY only</option>
            <option value="SELL">SELL only</option>
          </select>

          {/* Score filter */}
          <select
            value={minScore}
            onChange={e => setMinScore(Number(e.target.value))}
            className="text-xs bg-dark-700 border border-dark-500 rounded-md px-2 py-1 text-slate-300 focus:outline-none focus:border-brand-500"
          >
            <option value={0}>Any Score</option>
            <option value={4}>≥ 4 Moderate</option>
            <option value={6}>≥ 6 High</option>
          </select>

          {/* Last updated */}
          {computedAt && (
            <span className="text-xs text-slate-400" title="Time of last conviction scan">
              Scanned: {computedAt}
            </span>
          )}

          {/* Refresh Models button */}
          <Tooltip text={TIPS.refreshBtn} align="right">
          <button
            onClick={handleRefreshModels}
            disabled={refreshing || scanning}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-dark-500 text-slate-400 hover:text-slate-200 hover:border-brand-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {refreshing
              ? <Loader2 size={12} className="animate-spin" />
              : <Cpu size={12} />
            }
            {refreshing ? `Training ${refreshProgress}` : 'Refresh Models'}
          </button>
          </Tooltip>

          {/* Scan button */}
          <Tooltip text={TIPS.scanBtn} align="right">
          <button
            onClick={handleScan}
            disabled={scanning || refreshing}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-dark-500 text-slate-400 hover:text-slate-200 hover:border-brand-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scanning
              ? <Loader2 size={12} className="animate-spin" />
              : <RefreshCw size={12} />
            }
            {scanning ? 'Scanning…' : 'Scan'}
          </button>
          </Tooltip>
        </div>
      </div>

      {/* Model-refresh banner */}
      {refreshing && (
        <div className="px-4 py-2 bg-brand-500/5 border-b border-brand-500/20 flex items-center gap-2">
          <Loader2 size={12} className="animate-spin text-brand-400" />
          <p className="text-xs text-brand-400">
            Retraining ML models{refreshProgress ? ` — ${refreshProgress}` : ''}
            {rs?.failed ? ` · ${rs.failed} failed` : ''}. Runs in the background — safe to leave this page.
          </p>
        </div>
      )}

      {/* Scanning banner */}
      {scanning && (
        <div className="px-4 py-2 bg-brand-500/5 border-b border-brand-500/20 flex items-center gap-2">
          <Loader2 size={12} className="animate-spin text-brand-400" />
          <p className="text-xs text-brand-400">
            Scanning 50 symbols — computing conviction scores… (~4 min)
          </p>
        </div>
      )}

      {/* Table or empty state */}
      {isLoading ? (
        <div className="flex items-center justify-center py-10 gap-2 text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Loading leaderboard…</span>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState onScan={handleScan} scanning={scanning} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 uppercase tracking-wider border-b border-dark-600/40">
                <th className="pl-4 pr-2 py-2 text-left font-medium w-8">#</th>
                <th className="px-2 py-2 text-left font-medium">Symbol</th>
                <th className="px-2 py-2 text-left font-medium w-40">
                  <Tooltip text={TIPS.score}>
                    <span className="cursor-help underline decoration-dotted">Score</span>
                  </Tooltip>
                </th>
                <th className="px-2 py-2 text-left font-medium w-24">
                  <Tooltip text={TIPS.direction}>
                    <span className="cursor-help underline decoration-dotted">Direction</span>
                  </Tooltip>
                </th>
                <th className="px-2 pr-4 py-2 text-right font-medium">
                  <Tooltip text={TIPS.label} align="right">
                    <span className="cursor-help underline decoration-dotted">Conviction</span>
                  </Tooltip>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <LeaderboardRow
                  key={row.symbol}
                  rank={i + 1}
                  row={row}
                  onClick={handleRowClick}
                  onAnalyze={onAnalyze}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
