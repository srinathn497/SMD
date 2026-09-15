import asyncio

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.schemas.market import HistoryResponse, QuoteData, SearchResult
from app.services.market_data import market_data_service

router = APIRouter(prefix="/market", tags=["Market Data"])


@router.get("/quote", response_model=QuoteData)
async def get_quote(
    symbol: str = Query(..., description="Ticker symbol, e.g. AAPL or BTC/USDT"),
    asset_type: str = Query("stock", description="stock or crypto"),
):
    try:
        return await market_data_service.get_quote(symbol, asset_type)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/history", response_model=HistoryResponse)
async def get_history(
    symbol: str = Query(...),
    asset_type: str = Query("stock"),
    interval: str = Query("1d", description="1m,5m,15m,30m,1h,4h,1d,1wk"),
    period: str = Query(None, description="Override default period, e.g. 365d"),
):
    try:
        return await market_data_service.get_history(symbol, asset_type, interval, period)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/search", response_model=list[SearchResult])
async def search(q: str = Query(..., min_length=1)):
    try:
        return await market_data_service.search_symbols(q)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── VIX regime ────────────────────────────────────────────────────────────────

class VixRegimeOut(BaseModel):
    vix_level:    float
    vix_change_5d: float | None   # % change over 5 days
    regime:       str             # CALM | NORMAL | ELEVATED | HIGH | PANIC | CRISIS
    title:        str             # short label shown in banner heading
    message:      str             # one-line explanation
    action:       str             # what the user should do
    predictions_suppressed: bool  # True when VIX > 30 and we stop logging predictions


_VIX_THRESHOLDS = [
    # (min_vix, regime,    title,                    message,                                                              action)
    (40, "CRISIS",   "Crisis-Level Fear",      "Extreme tail event in progress. Historical panic levels.",            "Avoid all new entries. Protect capital. This is a rare event."),
    (30, "PANIC",    "Market Panic",           "VIX > 30 signals fear-driven selling. ML predictions suppressed.",   "Reduce exposure. Tighten stops. Wait for VIX to fall below 25 before re-entering."),
    (25, "HIGH",     "High Volatility",        "Elevated fear. Technicals are less reliable — noise dominates.",     "Use wider stops. Reduce position size by 30–50%. Favour quality over momentum."),
    (20, "ELEVATED", "Elevated Volatility",    "Above-average fear. Market participants are cautious.",              "Tighten risk management. Avoid high-beta names. Watch for VIX direction."),
    (15, "NORMAL",   "Normal Conditions",      "Healthy volatility range. Signals are reliable.",                    "Trade normally. Follow conviction scores and ML predictions."),
    (0,  "CALM",     "Low Volatility / Calm",  "Complacent market. Often precedes sharp moves.",                     "Be alert for sudden reversals. Complacency can reverse quickly."),
]


@router.get("/vix", response_model=VixRegimeOut)
async def get_vix_regime():
    """
    Returns current VIX level, 5-day change, and regime classification.
    Used to surface market panic warnings to users and explain suppressed predictions.
    """
    from app.services.market_context import get_market_df as _get_mdf

    vix_df = await asyncio.to_thread(_get_mdf, "^VIX")
    if vix_df.empty or "close" not in vix_df.columns:
        raise HTTPException(status_code=503, detail="VIX data unavailable")

    vix_level = float(vix_df["close"].iloc[-1])

    # Sanity check — yfinance occasionally returns garbage rows (e.g. 733) for ^VIX
    if vix_level < 5 or vix_level > 150:
        raise HTTPException(status_code=503, detail=f"VIX data out of plausible range ({vix_level})")

    # 5-day percentage change (how fast fear is moving)
    vix_change_5d: float | None = None
    if len(vix_df) >= 6:
        prev = float(vix_df["close"].iloc[-6])
        if prev > 0:
            vix_change_5d = round((vix_level - prev) / prev * 100, 1)

    # Classify regime
    regime = title = message = action = ""
    for min_v, r, t, m, a in _VIX_THRESHOLDS:
        if vix_level >= min_v:
            regime, title, message, action = r, t, m, a
            break

    return VixRegimeOut(
        vix_level=round(vix_level, 2),
        vix_change_5d=vix_change_5d,
        regime=regime,
        title=title,
        message=message,
        action=action,
        predictions_suppressed=vix_level > 30,
    )
