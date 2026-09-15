from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Query

from app.services.volume_history_service import get_volume_history

router = APIRouter(prefix="/volume-history", tags=["Volume History"])


@router.get("/{symbol}")
async def volume_history(
    symbol: str,
    asset_type: str = Query("stock"),
):
    result = await get_volume_history(symbol.upper())
    if result is None:
        raise HTTPException(status_code=404, detail=f"No volume history available for {symbol}")
    return asdict(result)
