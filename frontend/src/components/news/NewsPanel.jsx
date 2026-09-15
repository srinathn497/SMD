import { ExternalLink, Newspaper } from 'lucide-react'
import { useNews } from '../../api/news'
import Tooltip from '../ui/Tooltip'
import Badge, { toneFromSignal } from '../ui/Badge'

const TIPS = {
  heading:
    'News & Sentiment — fetches the latest headlines from Yahoo Finance RSS (stocks) or Google News (crypto). Each article is scored by matching positive/negative keywords in the headline. The aggregate score is the average across all articles.',
  sentimentBar:
    'Sentiment bar — shows the aggregate mood of recent news. The bar grows right of center for positive sentiment, left for negative. Score range: −1.0 (all negative) to +1.0 (all positive). Scores between −0.1 and +0.1 are treated as NEUTRAL.',
  negative:
    'Negative sentiment — articles scored negative contain words like: crash, loss, downgrade, bearish, decline, fraud, layoff, plunge. A NEGATIVE aggregate means most recent headlines carry a bearish tone.',
  positive:
    'Positive sentiment — articles scored positive contain words like: surge, beat, growth, profit, upgrade, bullish, record, rally, outperform. A POSITIVE aggregate means most recent headlines carry a bullish tone.',
  articleSentiment:
    'Per-article sentiment label — POSITIVE: more bullish keywords than bearish. NEGATIVE: more bearish keywords than bullish. NEUTRAL: roughly equal or no strong keywords. Hover for the score in brackets.',
}

const SENTIMENT_CONFIG = {
  POSITIVE: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400' },
  NEUTRAL:  { color: 'text-yellow-400',  bg: 'bg-yellow-500/10 border-yellow-500/30',   dot: 'bg-yellow-400' },
  NEGATIVE: { color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30',         dot: 'bg-red-400' },
}

function SentimentBadge({ label, score }) {
  return (
    <Badge tone={toneFromSignal(label)} className="gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {label}
      <span className="opacity-60">({score > 0 ? '+' : ''}{score.toFixed(2)})</span>
    </Badge>
  )
}

function SentimentBar({ score }) {
  // score is -1 to +1; map to 0-100% with 50% as neutral
  const pct = Math.round((score + 1) / 2 * 100)
  const color = score > 0.1 ? 'bg-emerald-500' : score < -0.1 ? 'bg-red-500' : 'bg-yellow-500'
  return (
    <div className="relative w-full h-1.5 bg-dark-600 rounded-full overflow-hidden">
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-dark-500 z-10" />
      <div
        className={`absolute top-0 bottom-0 ${color} transition-all duration-500`}
        style={score >= 0
          ? { left: '50%', width: `${pct - 50}%` }
          : { right: `${100 - pct}%`, width: `${50 - pct}%`, left: `${pct}%` }
        }
      />
    </div>
  )
}

export default function NewsPanel({ symbol, assetType }) {
  const { data, isPending, isError } = useNews(symbol, assetType)

  if (!symbol) return null

  if (isPending) {
    return (
      <div className="card space-y-3 animate-pulse">
        <div className="h-4 bg-dark-600 rounded w-32" />
        {[1, 2, 3].map(i => <div key={i} className="h-12 bg-dark-600 rounded" />)}
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="card">
        <p className="text-xs text-slate-600">News unavailable</p>
      </div>
    )
  }

  return (
    <div className="card space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Newspaper size={15} className="text-slate-500" />
          <Tooltip text={TIPS.heading} wide>
            <span className="text-sm font-semibold text-slate-200 cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
              News & Sentiment
            </span>
          </Tooltip>
        </div>
        <SentimentBadge label={data.label} score={data.score} />
      </div>

      {/* Sentiment bar */}
      <div className="space-y-1">
        <Tooltip text={TIPS.sentimentBar} wide>
          <div className="w-full cursor-help">
            <SentimentBar score={data.score} />
          </div>
        </Tooltip>
        <div className="flex justify-between text-xs text-slate-600">
          <Tooltip text={TIPS.negative} wide>
            <span className="cursor-help underline decoration-dotted decoration-slate-700 underline-offset-2">Negative</span>
          </Tooltip>
          <span>{data.article_count} articles</span>
          <Tooltip text={TIPS.positive} wide align="right">
            <span className="cursor-help underline decoration-dotted decoration-slate-700 underline-offset-2">Positive</span>
          </Tooltip>
        </div>
      </div>

      {/* Articles */}
      {data.articles.length === 0 ? (
        <p className="text-xs text-slate-600 text-center py-2">No recent news found</p>
      ) : (
        <div className="space-y-2">
          {data.articles.slice(0, 5).map((article, i) => {
            const acfg = SENTIMENT_CONFIG[article.sentiment_label] ?? SENTIMENT_CONFIG.NEUTRAL
            return (
              <a
                key={i}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block group p-2.5 rounded-lg bg-dark-700/50 hover:bg-dark-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-slate-300 group-hover:text-slate-100 leading-snug flex-1 line-clamp-2">
                    {article.title}
                  </p>
                  <ExternalLink size={11} className="text-slate-600 group-hover:text-slate-400 flex-shrink-0 mt-0.5" />
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <Tooltip text={TIPS.articleSentiment}>
                    <span className={`text-xs font-medium cursor-help ${acfg.color}`}>{article.sentiment_label}</span>
                  </Tooltip>
                  <span className="text-slate-600 text-xs">·</span>
                  <span className="text-xs text-slate-600">{article.source}</span>
                  <span className="text-slate-600 text-xs">·</span>
                  <span className="text-xs text-slate-600">{article.published}</span>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
