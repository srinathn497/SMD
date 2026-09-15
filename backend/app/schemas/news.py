from pydantic import BaseModel


class NewsArticle(BaseModel):
    title: str
    url: str
    published: str        # human-readable date string
    source: str
    sentiment_score: float   # -1.0 to +1.0
    sentiment_label: str     # POSITIVE | NEUTRAL | NEGATIVE


class SentimentSummary(BaseModel):
    symbol: str
    score: float             # aggregate score -1.0 to +1.0
    label: str               # POSITIVE | NEUTRAL | NEGATIVE
    article_count: int
    articles: list[NewsArticle]
