from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.services.smart_money_service import scan_smart_money
from app.services.scanner import DEFAULT_STOCKS, DEFAULT_CRYPTO

router = APIRouter(tags=["Smart Money"])


class SmartMoneyOut(BaseModel):
    symbol: str
    asset_type: str
    price: float
    signal: str
    signal_score: int
    # Options
    put_call_vol_ratio: float | None = None
    put_call_oi_ratio: float | None = None
    atm_iv_pct: float | None = None
    iv_skew_pct: float | None = None
    max_pain_strike: float | None = None
    max_pain_distance_pct: float | None = None
    options_bias: str
    expiration: str | None = None
    # Volume
    volume_today: int
    volume_avg_20d: int
    volume_surge_ratio: float
    vwap: float
    above_vwap: bool
    volume_bias: str
    scanned_at: str


@router.get("/smart-money", response_model=list[SmartMoneyOut])
async def get_smart_money(
    symbols: str | None = Query(
        default=None,
        description="Comma-separated symbols. Defaults to all DEFAULT_STOCKS.",
    ),
    include_crypto: bool = Query(default=False),
):
    if symbols:
        pairs = []
        for s in symbols.split(","):
            s = s.strip().upper()
            if not s:
                continue
            atype = "crypto" if (s.endswith("-USD") or s.endswith("-USDT")) else "stock"
            pairs.append((s, atype))
    else:
        pairs = [(sym, "stock") for sym, _ in DEFAULT_STOCKS]
        if include_crypto:
            pairs += [(sym, "crypto") for sym, _ in DEFAULT_CRYPTO]

    results = await scan_smart_money(pairs)
    return [SmartMoneyOut(**vars(r)) for r in results]
