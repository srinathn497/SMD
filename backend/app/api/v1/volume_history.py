import asyncio
from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Query

from app.services.volume_flow_service import compute_flow
from app.services.volume_history_service import get_volume_24h, get_volume_history

router = APIRouter(prefix="/volume-history", tags=["Volume History"])


def _is_crypto(sym: str, asset_type: str) -> bool:
    # Search can return asset_type "stock" for crypto tickers, so check the suffix too
    return asset_type == "crypto" or sym.endswith(("-USD", "-USDT"))


@router.get("/{symbol}/flow")
async def volume_flow(
    symbol: str,
    asset_type: str = Query("stock"),
):
    """Buying vs selling over the last 5/10/15/20/30/60 minutes."""
    sym = symbol.upper()
    result = await asyncio.to_thread(compute_flow, sym, _is_crypto(sym, asset_type))
    if result is None:
        raise HTTPException(status_code=404, detail=f"No buy/sell flow available for {symbol}")
    return asdict(result)


@router.get("/{symbol}/24h")
async def volume_24h(
    symbol: str,
    asset_type: str = Query("stock"),
):
    sym = symbol.upper()
    result = await get_volume_24h(sym, _is_crypto(sym, asset_type))
    if result is None:
        raise HTTPException(status_code=404, detail=f"No hourly volume available for {symbol}")
    return asdict(result)


@router.get("/{symbol}")
async def volume_history(
    symbol: str,
    asset_type: str = Query("stock"),
):
    result = await get_volume_history(symbol.upper())
    if result is None:
        raise HTTPException(status_code=404, detail=f"No volume history available for {symbol}")
    return asdict(result)
