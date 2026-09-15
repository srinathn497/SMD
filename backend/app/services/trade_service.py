"""
Trade service: open/close trades, monitor TP/SL, compute P&L stats.
The scheduler calls check_trades_job() every 30 minutes.
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.trade import Trade
from app.schemas.trade import TradeCreate, TradeStats

logger = logging.getLogger("trade_service")

# Injected by main.py startup so trade_service can broadcast WebSocket events
_broadcast_callback = None


def set_trade_broadcast_callback(fn):
    global _broadcast_callback
    _broadcast_callback = fn


def _calc_pnl(direction: str, entry: float, close: float, qty: float) -> tuple[float, float]:
    """Returns (pnl, pnl_pct)."""
    if direction == "BUY":
        pnl = (close - entry) * qty
    else:
        pnl = (entry - close) * qty
    pnl_pct = (pnl / (entry * qty) * 100) if entry * qty else 0.0
    return round(pnl, 4), round(pnl_pct, 2)


class TradeService:

    # ── Open ──────────────────────────────────────────────────────────────
    async def open_trade(self, data: TradeCreate) -> Trade:
        async with AsyncSessionLocal() as session:
            trade = Trade(
                symbol=data.symbol.upper(),
                asset_type=data.asset_type,
                direction=data.direction,
                entry_price=data.entry_price,
                take_profit=data.take_profit,
                stop_loss=data.stop_loss,
                quantity=data.quantity,
                status="OPEN",
                signal=data.signal,
                top_reason=data.top_reason,
            )
            session.add(trade)
            await session.commit()
            await session.refresh(trade)
            return trade

    # ── List / get ────────────────────────────────────────────────────────
    async def get_all_trades(self) -> list[Trade]:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Trade).order_by(Trade.open_at.desc())
            )
            return result.scalars().all()

    async def get_open_trades(self) -> list[Trade]:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Trade).where(Trade.status == "OPEN").order_by(Trade.open_at.desc())
            )
            return result.scalars().all()

    # ── Close ─────────────────────────────────────────────────────────────
    async def close_trade(
        self, trade_id: int, close_price: float, reason: str = "MANUAL"
    ) -> Trade | None:
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(Trade).where(Trade.id == trade_id))
            trade = result.scalar_one_or_none()
            if trade is None:
                return None

            pnl, pnl_pct = _calc_pnl(trade.direction, trade.entry_price, close_price, trade.quantity)
            trade.close_price = round(close_price, 6)
            trade.close_at = datetime.now(timezone.utc)
            trade.pnl = pnl
            trade.pnl_pct = pnl_pct

            if reason in ("HIT_TP", "HIT_SL"):
                trade.status = reason
            else:
                trade.status = "CLOSED"

            await session.commit()
            await session.refresh(trade)
            return trade

    # ── Delete ────────────────────────────────────────────────────────────
    async def delete_trade(self, trade_id: int) -> bool:
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(Trade).where(Trade.id == trade_id))
            trade = result.scalar_one_or_none()
            if trade is None:
                return False
            await session.delete(trade)
            await session.commit()
            return True

    # ── Scheduler: check TP/SL ────────────────────────────────────────────
    async def check_trades(self) -> None:
        from app.services.market_data import market_data_service

        open_trades = await self.get_open_trades()
        if not open_trades:
            return

        for trade in open_trades:
            try:
                _, price, _ = await market_data_service.get_scan_data(
                    trade.symbol, trade.asset_type
                )

                hit_tp = hit_sl = False
                if trade.direction == "BUY":
                    hit_tp = price >= trade.take_profit
                    hit_sl = price <= trade.stop_loss
                else:  # SELL
                    hit_tp = price <= trade.take_profit
                    hit_sl = price >= trade.stop_loss

                if hit_tp or hit_sl:
                    level = "TP" if hit_tp else "SL"
                    logger.info(
                        f"Trade {trade.id} {trade.symbol} reached {level} @ {price:.4f} "
                        f"(manual close required)"
                    )
            except Exception as e:
                logger.warning(f"Trade check failed for trade {trade.id} ({trade.symbol}): {e}")

    # ── Stats ─────────────────────────────────────────────────────────────
    async def get_stats(self) -> TradeStats:
        trades = await self.get_all_trades()
        closed = [t for t in trades if t.status != "OPEN"]
        wins = [t for t in closed if t.status == "HIT_TP"]
        losses = [t for t in closed if t.status == "HIT_SL"]
        pnls = [t.pnl for t in closed if t.pnl is not None]

        win_rate = (len(wins) / len(closed) * 100) if closed else 0.0
        return TradeStats(
            total_trades=len(trades),
            open_count=sum(1 for t in trades if t.status == "OPEN"),
            closed_count=len(closed),
            win_count=len(wins),
            loss_count=len(losses),
            win_rate_pct=round(win_rate, 1),
            total_pnl=round(sum(pnls), 4) if pnls else 0.0,
            best_trade_pnl=round(max(pnls), 4) if pnls else None,
            worst_trade_pnl=round(min(pnls), 4) if pnls else None,
        )


trade_service = TradeService()


async def check_trades_job():
    """Entry point for APScheduler."""
    await trade_service.check_trades()
