from fastapi import APIRouter, HTTPException

from app.schemas.option_trade import OptionTradeCreate, OptionTradeCloseRequest, OptionTradeOut
from app.services.option_trade_service import option_trade_service

router = APIRouter(prefix="/option-trades", tags=["Option Trades"])


@router.get("", response_model=list[OptionTradeOut])
async def list_option_trades():
    return await option_trade_service.get_all()


@router.post("", response_model=OptionTradeOut, status_code=201)
async def open_option_trade(data: OptionTradeCreate):
    return await option_trade_service.open_trade(data)


@router.patch("/{trade_id}/close", response_model=OptionTradeOut)
async def close_option_trade(trade_id: int, body: OptionTradeCloseRequest):
    trade = await option_trade_service.close_trade(trade_id, body.close_price)
    if trade is None:
        raise HTTPException(status_code=404, detail="Option trade not found")
    return trade


@router.delete("/{trade_id}", status_code=204)
async def delete_option_trade(trade_id: int):
    ok = await option_trade_service.delete_trade(trade_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Option trade not found")
