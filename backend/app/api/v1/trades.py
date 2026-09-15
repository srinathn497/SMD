from fastapi import APIRouter, HTTPException

from app.schemas.trade import TradeCloseRequest, TradeCreate, TradeOut, TradeStats
from app.services.trade_service import trade_service

router = APIRouter(prefix="/trades", tags=["Trades"])


@router.get("", response_model=list[TradeOut])
async def list_trades():
    """Return all trades (open + closed), newest first."""
    return await trade_service.get_all_trades()


@router.get("/stats", response_model=TradeStats)
async def get_stats():
    """Win rate, total P&L, and counts."""
    return await trade_service.get_stats()


@router.post("", response_model=TradeOut, status_code=201)
async def open_trade(data: TradeCreate):
    """Open a new trade from a scan recommendation."""
    return await trade_service.open_trade(data)


@router.post("/{trade_id}/close", response_model=TradeOut)
async def close_trade(trade_id: int, body: TradeCloseRequest):
    """
    Manually close a trade.
    If close_price is null, the current market price is fetched automatically.
    """
    if body.close_price is None:
        # Fetch current price
        from app.services.market_data import market_data_service
        from sqlalchemy import select
        from app.database import AsyncSessionLocal
        from app.models.trade import Trade as TradeModel

        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(TradeModel).where(TradeModel.id == trade_id)
            )
            trade = result.scalar_one_or_none()
            if trade is None:
                raise HTTPException(status_code=404, detail="Trade not found")
            _, price, _ = await market_data_service.get_scan_data(
                trade.symbol, trade.asset_type
            )
        close_price = price
    else:
        close_price = body.close_price

    closed = await trade_service.close_trade(trade_id, close_price, "MANUAL")
    if closed is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    return closed


@router.delete("/{trade_id}", status_code=204)
async def delete_trade(trade_id: int):
    """Permanently delete a trade record."""
    deleted = await trade_service.delete_trade(trade_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Trade not found")
