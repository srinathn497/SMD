from fastapi import APIRouter, Query

from app.schemas.news import SentimentSummary
from app.services.news_service import get_news

router = APIRouter(tags=["News"])


@router.get("/news/{symbol}", response_model=SentimentSummary)
async def get_symbol_news(
    symbol: str,
    asset_type: str = Query("stock", description="stock | crypto"),
):
    """Fetch recent news headlines and aggregate sentiment for a symbol."""
    return await get_news(symbol.upper(), asset_type)
