from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
import asyncio

router = APIRouter(prefix="/fundamentals", tags=["Fundamentals"])


class AnalystConsensusOut(BaseModel):
    buy_count:      int | None
    hold_count:     int | None
    sell_count:     int | None
    total_count:    int | None
    target_mean:    float | None
    target_high:    float | None
    target_low:     float | None
    upside_pct:     float | None
    recommendation: str


class FundamentalOut(BaseModel):
    symbol:              str
    pe_ratio:            float | None
    forward_pe:          float | None
    pb_ratio:            float | None
    ev_ebitda:           float | None
    fcf_yield_pct:       float | None
    revenue_growth_yoy:  float | None
    eps_growth_yoy:      float | None
    gross_margin:        float | None
    operating_margin:    float | None
    net_margin:          float | None
    debt_to_equity:      float | None
    current_ratio:       float | None
    roe:                 float | None
    roa:                 float | None
    consensus:           AnalystConsensusOut
    health_score:        int
    health_label:        str
    health_direction:    str
    criteria:            dict


@router.get("/{symbol}", response_model=FundamentalOut)
async def get_fundamentals(
    symbol: str,
    current_price: float | None = Query(None, description="Current market price for upside calculation"),
):
    from app.services.fundamental_service import get_fundamentals as _fetch
    try:
        data = await asyncio.to_thread(_fetch, symbol.upper(), current_price)
        return FundamentalOut(
            symbol=data.symbol,
            pe_ratio=data.pe_ratio,
            forward_pe=data.forward_pe,
            pb_ratio=data.pb_ratio,
            ev_ebitda=data.ev_ebitda,
            fcf_yield_pct=data.fcf_yield_pct,
            revenue_growth_yoy=data.revenue_growth_yoy,
            eps_growth_yoy=data.eps_growth_yoy,
            gross_margin=data.gross_margin,
            operating_margin=data.operating_margin,
            net_margin=data.net_margin,
            debt_to_equity=data.debt_to_equity,
            current_ratio=data.current_ratio,
            roe=data.roe,
            roa=data.roa,
            consensus=AnalystConsensusOut(**data.consensus.__dict__),
            health_score=data.health_score,
            health_label=data.health_label,
            health_direction=data.health_direction,
            criteria=data.criteria,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch fundamentals: {e}")
