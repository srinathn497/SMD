import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.option_trade import OptionTrade
from app.schemas.option_trade import OptionTradeCreate

logger = logging.getLogger("option_trade_service")


def _calc_pnl(ask_at_entry: float, close_price: float, quantity: int, trade_side: str = "LONG") -> tuple[float, float]:
    if trade_side == "SHORT":
        # Short: profit when option price falls (we sold premium, buy back cheaper)
        pnl = (ask_at_entry - close_price) * 100 * quantity
        pnl_pct = ((ask_at_entry - close_price) / ask_at_entry * 100) if ask_at_entry else 0.0
    else:
        pnl = (close_price - ask_at_entry) * 100 * quantity
        pnl_pct = ((close_price - ask_at_entry) / ask_at_entry * 100) if ask_at_entry else 0.0
    return round(pnl, 4), round(pnl_pct, 2)


class OptionTradeService:

    async def open_trade(self, data: OptionTradeCreate) -> OptionTrade:
        async with AsyncSessionLocal() as session:
            trade = OptionTrade(**data.model_dump())
            session.add(trade)
            await session.commit()
            await session.refresh(trade)
            return trade

    async def get_all(self) -> list[OptionTrade]:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(OptionTrade).order_by(OptionTrade.entry_at.desc())
            )
            return result.scalars().all()

    async def close_trade(self, trade_id: int, close_price: float) -> OptionTrade | None:
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(OptionTrade).where(OptionTrade.id == trade_id))
            trade = result.scalar_one_or_none()
            if trade is None:
                return None
            pnl, pnl_pct = _calc_pnl(trade.ask_at_entry, close_price, trade.quantity, trade.trade_side)
            trade.close_price = round(close_price, 6)
            trade.close_at = datetime.now(timezone.utc)
            trade.pnl = pnl
            trade.pnl_pct = pnl_pct
            trade.status = "CLOSED"
            await session.commit()
            await session.refresh(trade)
            return trade

    async def delete_trade(self, trade_id: int) -> bool:
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(OptionTrade).where(OptionTrade.id == trade_id))
            trade = result.scalar_one_or_none()
            if trade is None:
                return False
            await session.delete(trade)
            await session.commit()
            return True


option_trade_service = OptionTradeService()
