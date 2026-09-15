import asyncio

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.schemas.signals import IntradayContext, IntraPredictionResult, OptionsFlowData, PredictionResult, SignalResult
from app.services.conviction import compute_conviction
from app.services.intraday import compute_intraday
from app.services.intraday_predictor import intra_predictor
from app.services.market_data import market_data_service
from app.services.ml_predictor import ml_predictor
from app.services.news_service import get_news
from app.services.technical import technical_analysis


class ConvictionSignalOut(BaseModel):
    name:   str
    passed: bool
    detail: str

class ConvictionOut(BaseModel):
    symbol:         str
    score:          int
    max_score:      int
    label:          str
    direction:      str
    confidence_pct: float = 0.0
    signals:        list[ConvictionSignalOut]

router = APIRouter(prefix="/signals", tags=["Signals & Predictions"])

VALID_PERIODS = {"6mo", "1y", "2y", "3y"}


@router.get("/{symbol}", response_model=SignalResult)
async def get_signals(
    symbol: str,
    asset_type: str = Query("stock"),
    interval: str = Query("1d"),
):
    try:
        df = await market_data_service.get_ohlcv_df(symbol, asset_type, interval)
        return technical_analysis.compute_all(df, symbol, asset_type)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


VALID_HORIZONS = {"1d", "1w", "1m"}


@router.get("/predict/{symbol}", response_model=PredictionResult)
async def get_prediction(
    symbol: str,
    asset_type: str = Query("stock"),
    training_period: str = Query("3y", description="Training window: 6mo | 1y | 2y | 3y"),
    horizon: str = Query("1d", description="Prediction horizon: 1d | 1w | 1m"),
):
    if training_period not in VALID_PERIODS:
        raise HTTPException(
            status_code=422,
            detail=f"training_period must be one of {VALID_PERIODS}",
        )
    if horizon not in VALID_HORIZONS:
        raise HTTPException(
            status_code=422,
            detail=f"horizon must be one of {VALID_HORIZONS}",
        )
    try:
        # Fetch OHLCV and news sentiment concurrently
        df_task      = market_data_service.get_ohlcv_df(symbol, asset_type, "1d", period=training_period)
        news_task    = get_news(symbol, asset_type)
        df, news     = await asyncio.gather(df_task, news_task, return_exceptions=True)

        if isinstance(df, Exception):
            raise df

        sentiment_score = 0.0
        sentiment_label = "NEUTRAL"
        if not isinstance(news, Exception):
            sentiment_score = news.score
            sentiment_label = news.label

        return await asyncio.to_thread(
            ml_predictor.predict,
            symbol, df, training_period,
            sentiment_score=sentiment_score,
            sentiment_label=sentiment_label,
            horizon=horizon,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/predict/{symbol}/cache")
async def clear_prediction_cache(symbol: str):
    """Delete the saved model bundle so the next predict call forces a full retrain."""
    cleared = ml_predictor.clear_cache(symbol)
    return JSONResponse({"symbol": symbol.upper(), "cleared": cleared})


@router.get("/intraday-predict/{symbol}", response_model=IntraPredictionResult)
async def get_intraday_prediction(
    symbol: str,
    asset_type: str = Query("stock"),
):
    """
    15-minute LightGBM intraday prediction.
    Target: will price be higher in ~1 hour (4 × 15 min bars)?
    Model trains on 60 days of 15m OHLCV data; results cached for 24 h per symbol.
    """
    try:
        m15_task = market_data_service.get_ohlcv_df(symbol, asset_type, "15m", period="60d")
        d1_task  = market_data_service.get_ohlcv_df(symbol, asset_type, "1d",  period="3mo")
        df_15m, df_1d = await asyncio.gather(m15_task, d1_task)
        return await asyncio.to_thread(intra_predictor.predict, symbol, df_15m, df_1d, asset_type)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/intraday-predict/{symbol}/cache")
async def clear_intraday_prediction_cache(symbol: str):
    """Delete the 15m model bundle so the next predict call forces a full retrain."""
    cleared = intra_predictor.clear_cache(symbol)
    return JSONResponse({"symbol": symbol.upper(), "cleared": cleared})


@router.get("/conviction/{symbol}", response_model=ConvictionOut)
async def get_conviction(
    symbol: str,
    asset_type: str = Query("stock"),
):
    """
    Conviction Score (0–7): counts how many independent signals agree.
    HIGH_CONVICTION ≥ 6 · MODERATE ≥ 4 · WEAK ≥ 2 · NEUTRAL < 2
    """
    try:
        result = await compute_conviction(symbol.upper(), asset_type)
        return ConvictionOut(
            symbol         = result.symbol,
            score          = result.score,
            max_score      = result.max_score,
            label          = result.label,
            direction      = result.direction,
            confidence_pct = result.confidence_pct,
            signals        = [ConvictionSignalOut(**s) for s in result.signals],
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/options/{symbol}", response_model=OptionsFlowData | None)
async def get_options_flow_endpoint(
    symbol: str,
    asset_type: str = Query("stock"),
):
    """
    Real-time options chain metrics: P/C OI ratio, P/C volume ratio,
    ATM implied volatility, IV skew, and max pain strike/distance.
    Returns null for crypto or symbols with thin options markets (OI < 1000).
    Results cached 30 minutes.
    """
    from app.services.options_service import get_options_flow
    result = await asyncio.to_thread(get_options_flow, symbol)
    return result


@router.get("/intraday/{symbol}", response_model=IntradayContext)
async def get_intraday_context(
    symbol: str,
    asset_type: str = Query("stock"),
    daily_direction: str = Query("UNKNOWN", description="Daily ML direction: UP | DOWN | UNKNOWN"),
    daily_confidence: float = Query(0.0, description="Daily ML confidence 0–100"),
):
    """
    Intraday decision context: 1h RSI, VWAP deviation, day extension vs ATR,
    volume pulse, time-of-day awareness, composite score, support/resistance,
    and a fused Combined Verdict when daily ML direction is supplied.
    """
    try:
        h1_task = market_data_service.get_ohlcv_df(symbol, asset_type, "1h", period="30d")
        d1_task = market_data_service.get_ohlcv_df(symbol, asset_type, "1d", period="3mo")
        df_1h, df_1d = await asyncio.gather(h1_task, d1_task)
        return compute_intraday(
            df_1h, df_1d, symbol,
            daily_direction=daily_direction,
            daily_confidence=daily_confidence,
            asset_type=asset_type,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
