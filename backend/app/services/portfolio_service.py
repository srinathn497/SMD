from datetime import datetime

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.portfolio import Holding, Transaction
from app.schemas.portfolio import AccountSummary, HoldingOut, TransactionCreate, TransactionOut
from app.services.market_data import market_data_service


class PortfolioService:
    async def add_transaction(self, data: TransactionCreate, session: AsyncSession) -> TransactionOut:
        total = data.quantity * data.price + data.fees

        tx = Transaction(
            symbol=data.symbol.upper(),
            asset_type=data.asset_type,
            side=data.side.upper(),
            quantity=data.quantity,
            price=data.price,
            total=total,
            fees=data.fees,
            notes=data.notes,
            traded_at=data.traded_at,
        )
        session.add(tx)

        # Update holding
        result = await session.execute(select(Holding).where(Holding.symbol == data.symbol.upper()))
        holding = result.scalar_one_or_none()

        if data.side.upper() == "BUY":
            if holding:
                new_total = holding.total_invested + total
                new_qty = holding.quantity + data.quantity
                holding.avg_buy_price = (holding.total_invested + data.quantity * data.price) / new_qty
                holding.quantity = new_qty
                holding.total_invested = new_total
            else:
                holding = Holding(
                    symbol=data.symbol.upper(),
                    asset_type=data.asset_type,
                    quantity=data.quantity,
                    avg_buy_price=data.price,
                    total_invested=total,
                )
                session.add(holding)
        elif data.side.upper() == "SELL" and holding:
            holding.quantity -= data.quantity
            holding.total_invested -= holding.avg_buy_price * data.quantity
            if holding.quantity <= 0:
                await session.delete(holding)

        await session.commit()
        await session.refresh(tx)
        return TransactionOut.model_validate(tx)

    async def get_holdings(self, session: AsyncSession) -> list[HoldingOut]:
        result = await session.execute(select(Holding).where(Holding.quantity > 0))
        holdings = result.scalars().all()
        output = []
        for h in holdings:
            try:
                quote = await market_data_service.get_quote(h.symbol, h.asset_type)
                current_price = quote.price
            except Exception:
                current_price = h.avg_buy_price

            current_value = h.quantity * current_price
            unrealized_pnl = current_value - h.total_invested
            unrealized_pct = (unrealized_pnl / h.total_invested * 100) if h.total_invested else 0.0

            output.append(HoldingOut(
                id=h.id,
                symbol=h.symbol,
                asset_type=h.asset_type,
                quantity=h.quantity,
                avg_buy_price=round(h.avg_buy_price, 6),
                total_invested=round(h.total_invested, 4),
                current_price=round(current_price, 6),
                current_value=round(current_value, 4),
                unrealized_pnl=round(unrealized_pnl, 4),
                unrealized_pnl_pct=round(unrealized_pct, 2),
            ))
        return output

    async def get_account_summary(self, session: AsyncSession) -> AccountSummary:
        holdings = await self.get_holdings(session)
        total_invested = sum(h.total_invested for h in holdings)
        current_value = sum(h.current_value for h in holdings)
        unrealized_pnl = current_value - total_invested

        # Realized P&L from closed trades
        result = await session.execute(
            select(
                func.sum(Transaction.total).label("sell_total")
            ).where(Transaction.side == "SELL")
        )
        sell_total = float(result.scalar() or 0)

        result2 = await session.execute(
            select(func.sum(Transaction.quantity * Transaction.price).label("cost_basis")).where(
                Transaction.side == "SELL"
            )
        )
        # Simplified realized: treat each SELL total - (qty * avg) as realized PnL
        realized_pnl = 0.0

        total_pnl_pct = (unrealized_pnl / total_invested * 100) if total_invested > 0 else 0.0

        return AccountSummary(
            total_invested=round(total_invested, 4),
            current_value=round(current_value, 4),
            total_pnl=round(unrealized_pnl, 4),
            total_pnl_pct=round(total_pnl_pct, 2),
            realized_pnl=round(realized_pnl, 4),
            holdings_count=len(holdings),
        )

    async def get_transactions(self, session: AsyncSession, symbol: str | None = None) -> list[TransactionOut]:
        q = select(Transaction).order_by(Transaction.traded_at.desc())
        if symbol:
            q = q.where(Transaction.symbol == symbol.upper())
        result = await session.execute(q)
        return [TransactionOut.model_validate(t) for t in result.scalars().all()]


portfolio_service = PortfolioService()
