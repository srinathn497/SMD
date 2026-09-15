"""
News & Sentiment service.
Fetches RSS headlines from Yahoo Finance (stocks) or Google News (crypto/fallback),
scores each article with keyword-based sentiment, and caches results for 15 minutes.
"""
import asyncio
import logging
import time
from email.utils import parsedate_to_datetime
from urllib.parse import quote as url_quote

import feedparser

from app.schemas.news import NewsArticle, SentimentSummary

logger = logging.getLogger("news_service")

# 15-minute in-memory cache: {symbol -> (timestamp, SentimentSummary)}
_cache: dict[str, tuple[float, SentimentSummary]] = {}
CACHE_TTL = 15 * 60  # seconds

# ── Sentiment keyword sets ─────────────────────────────────────────────────────
POSITIVE_WORDS = {
    "surge", "surges", "surged", "beat", "beats", "growth", "grows", "profit",
    "profits", "upgrade", "upgraded", "upgrades", "bullish", "bull", "record",
    "rally", "soar", "soars", "soared", "rise", "rises", "rose", "outperform",
    "outperforms", "strong", "strength", "gain", "gains", "boost", "boosts",
    "boosted", "breakthrough", "positive", "higher", "high", "revenue", "buy",
    "opportunity", "recovery", "recover", "recovered", "top", "best",
}

NEGATIVE_WORDS = {
    "crash", "crashes", "crashed", "loss", "losses", "bankruptcy", "bankrupt",
    "downgrade", "downgraded", "downgrades", "bearish", "bear", "decline",
    "declines", "declined", "miss", "misses", "missed", "weak", "weakness",
    "fall", "falls", "fell", "drop", "drops", "dropped", "plunge", "plunges",
    "plunged", "negative", "lower", "low", "layoff", "layoffs", "recall",
    "lawsuit", "investigation", "fraud", "cut", "cuts", "warning", "sell",
    "risk", "concern", "concerns", "default", "debt", "pressure", "volatile",
}


def _score_text(text: str) -> float:
    """Return sentiment score in [-1, +1] based on keyword matches."""
    words = set(text.lower().split())
    pos = len(words & POSITIVE_WORDS)
    neg = len(words & NEGATIVE_WORDS)
    return (pos - neg) / (pos + neg + 1)


def _label(score: float) -> str:
    if score > 0.1:
        return "POSITIVE"
    if score < -0.1:
        return "NEGATIVE"
    return "NEUTRAL"


def _parse_feed(feed, max_articles: int) -> list[NewsArticle]:
    articles = []
    for entry in feed.entries[:max_articles]:
        title = getattr(entry, "title", "")
        url   = getattr(entry, "link", "")
        desc  = getattr(entry, "summary", "")
        source = getattr(getattr(entry, "source", None), "title", None) or \
                 feed.feed.get("title", "Unknown")

        # Parse published date
        published = ""
        if hasattr(entry, "published"):
            try:
                published = parsedate_to_datetime(entry.published).strftime("%b %d, %Y %H:%M")
            except Exception:
                published = entry.published

        text = f"{title} {desc}"
        score = _score_text(text)
        articles.append(NewsArticle(
            title=title,
            url=url,
            published=published,
            source=source,
            sentiment_score=round(score, 4),
            sentiment_label=_label(score),
        ))
    return articles


async def _fetch_rss(url: str) -> feedparser.FeedParserDict:
    """Fetch RSS in a thread to avoid blocking the event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, feedparser.parse, url)


async def get_news(symbol: str, asset_type: str, max_articles: int = 8) -> SentimentSummary:
    """
    Fetch news for a symbol. Returns cached result if fresher than 15 min.
    """
    cache_key = symbol.upper()
    now = time.time()

    if cache_key in _cache:
        cached_at, cached_summary = _cache[cache_key]
        if now - cached_at < CACHE_TTL:
            return cached_summary

    articles: list[NewsArticle] = []

    # ── Primary source ─────────────────────────────────────────────────────────
    if asset_type == "stock":
        # Yahoo Finance RSS — great for stocks
        url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol}&region=US&lang=en-US"
    else:
        # Google News for crypto
        q = url_quote(f"{symbol} cryptocurrency price")
        url = f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"

    try:
        feed = await _fetch_rss(url)
        articles = _parse_feed(feed, max_articles)
    except Exception as e:
        logger.warning(f"Primary RSS failed for {symbol}: {e}")

    # ── Fallback: Google News ──────────────────────────────────────────────────
    if not articles:
        try:
            q = url_quote(f"{symbol} stock")
            fallback_url = f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
            feed = await _fetch_rss(fallback_url)
            articles = _parse_feed(feed, max_articles)
        except Exception as e:
            logger.warning(f"Fallback RSS failed for {symbol}: {e}")

    # ── Aggregate ──────────────────────────────────────────────────────────────
    agg_score = round(sum(a.sentiment_score for a in articles) / max(len(articles), 1), 4)

    summary = SentimentSummary(
        symbol=symbol,
        score=agg_score,
        label=_label(agg_score),
        article_count=len(articles),
        articles=articles,
    )

    _cache[cache_key] = (now, summary)
    return summary


news_service = object()  # namespace marker — use get_news() directly
