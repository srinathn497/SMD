import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.market_data import market_data_service
from app.services.alert_engine import set_broadcast_callback
from app.services.trade_service import set_trade_broadcast_callback

logger = logging.getLogger("websocket")
router = APIRouter(tags=["WebSocket"])


class ConnectionManager:
    def __init__(self):
        # symbol -> set of websockets
        self._subscribers: dict[str, set[WebSocket]] = {}
        self._all: set[WebSocket] = set()

    async def connect(self, ws: WebSocket, symbols: list[str]):
        await ws.accept()
        self._all.add(ws)
        for sym in symbols:
            self._subscribers.setdefault(sym.upper(), set()).add(ws)

    def disconnect(self, ws: WebSocket):
        self._all.discard(ws)
        for subscribers in self._subscribers.values():
            subscribers.discard(ws)

    async def broadcast(self, message: dict[str, Any]):
        dead = set()
        for ws in list(self._all):
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.disconnect(ws)

    async def send_to_symbol(self, symbol: str, message: dict[str, Any]):
        subscribers = self._subscribers.get(symbol.upper(), set())
        dead = set()
        for ws in list(subscribers):
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.disconnect(ws)

    @property
    def watched_symbols(self) -> list[str]:
        return [s for s, subs in self._subscribers.items() if subs]


manager = ConnectionManager()
set_broadcast_callback(manager.broadcast)
set_trade_broadcast_callback(manager.broadcast)

_price_poll_task: asyncio.Task | None = None


async def _price_poll_loop(interval: int = 10):
    while True:
        symbols = manager.watched_symbols
        for sym in symbols:
            try:
                asset_type = "crypto" if "/" in sym else "stock"
                quote = await market_data_service.get_quote(sym, asset_type)
                await manager.send_to_symbol(sym, {
                    "type": "price_update",
                    "symbol": sym,
                    "price": quote.price,
                    "change": quote.change,
                    "change_pct": quote.change_pct,
                })
            except Exception as e:
                logger.debug(f"Price poll error for {sym}: {e}")
        await asyncio.sleep(interval)


def start_price_poll(interval: int = 10):
    global _price_poll_task
    if _price_poll_task is None or _price_poll_task.done():
        _price_poll_task = asyncio.create_task(_price_poll_loop(interval))


@router.websocket("/ws/prices")
async def websocket_prices(ws: WebSocket, symbols: str = "AAPL"):
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    await manager.connect(ws, symbol_list)
    start_price_poll()
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)
