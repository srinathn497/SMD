import asyncio

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.scanner import market_scanner, ScanResult

router = APIRouter(prefix="/scan", tags=["Scanner"])


class ScanResultOut(BaseModel):
    symbol: str
    name: str
    asset_type: str
    price: float
    change_pct: float
    recommendation: str
    confidence_pct: float
    buy_count: int
    sell_count: int
    hold_count: int
    top_reason: str
    indicators: list
    error: str = ""
    entry_price: float = 0.0
    take_profit: float = 0.0
    stop_loss: float = 0.0
    risk_reward: float = 0.0
    expected_gain_pct: float = 0.0


class SingleScanRequest(BaseModel):
    symbol: str
    asset_type: str = "stock"
    name: str = ""


@router.get("/all", response_model=list[ScanResultOut])
async def scan_all(
    include_crypto: bool = Query(True),
    extra: str = Query("", description="Comma-separated extra symbols, e.g. PLTR:stock,ETH/USDT:crypto"),
):
    """
    Scan the full default universe (20 stocks + 10 crypto) plus any extras.
    Returns sorted: STRONG BUY first → STRONG SELL last.
    This call takes ~30-60s on first run (fetching & computing all symbols).
    """
    extra_symbols = []
    if extra:
        for item in extra.split(","):
            parts = item.strip().split(":")
            sym = parts[0].strip().upper()
            atype = parts[1].strip() if len(parts) > 1 else "stock"
            if sym:
                extra_symbols.append((sym, sym, atype))

    try:
        results = await market_scanner.scan_all(
            extra_symbols=extra_symbols or None,
            include_crypto=include_crypto,
        )
        return [ScanResultOut(**vars(r)) for r in results]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/single", response_model=ScanResultOut)
async def scan_single(req: SingleScanRequest):
    """Scan a single symbol and return its recommendation immediately."""
    try:
        result = await asyncio.wait_for(
            market_scanner.scan_symbol(
                req.symbol.upper(), req.name or req.symbol.upper(), req.asset_type
            ),
            timeout=30.0,
        )
        return ScanResultOut(**vars(result))
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail=f"Scan timed out for {req.symbol} — try again")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
