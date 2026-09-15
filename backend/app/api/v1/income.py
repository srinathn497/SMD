"""
Options Income API

GET /api/v1/income/options-scan       — buy calls/puts on conviction signals
GET /api/v1/income/covered-calls      — sell calls on holdings you own (100+ shares)
GET /api/v1/income/cash-secured-puts  — sell puts on conviction BUY stocks
GET /api/v1/income/iv-environment     — IV Rank + sell/buy recommendation per symbol
"""
import asyncio
from dataclasses import asdict

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.conviction_cache import ConvictionCache
from app.models.portfolio import Holding
from app.services.covered_call_service import (
    get_iv_environment,
    scan_cash_secured_puts,
    scan_covered_calls,
)
from app.services.income_service import scan_options_to_buy
from app.services.playbook_service import (
    analyze_stock,
    get_opportunities,
)

router = APIRouter(prefix="/income", tags=["Options Income"])

_SCAN_LABELS = {"HIGH_CONVICTION", "MODERATE", "WEAK"}
_DIRECTIONAL = {"BUY", "SELL"}


# ── Buy Options schemas ───────────────────────────────────────────────────────

class OptionOppOut(BaseModel):
    symbol: str
    option_type: str
    conviction: str
    stock_price: float
    expiration: str
    dte: int
    strike: float
    ask: float
    bid: float
    cost_per_contract: float
    delta: float
    theta_per_day: float
    iv_pct: float
    breakeven_price: float
    profit_target_option: float
    stop_loss_option: float
    time_stop_date: str
    stock_move_needed_pct: float
    open_interest: int
    volume: int
    score: float


class StockScanResult(BaseModel):
    symbol: str
    direction: str
    conviction: str
    options: list[OptionOppOut]


# ── Covered Call schemas ──────────────────────────────────────────────────────

class CCOppOut(BaseModel):
    symbol: str
    stock_price: float
    shares_owned: float
    avg_cost: float
    contracts_available: int
    expiration: str
    dte: int
    strike: float
    bid: float
    ask: float
    premium_per_contract: float
    total_premium: float
    delta: float
    theta_per_day: float
    iv_pct: float
    annualized_yield_pct: float
    return_on_stock_pct: float
    new_cost_basis: float
    upside_to_strike_pct: float
    max_profit_if_called: float
    open_interest: int
    volume: int
    score: float


class CCHoldingResult(BaseModel):
    symbol: str
    shares_owned: float
    avg_cost: float
    current_price: float
    opportunities: list[CCOppOut]


# ── CSP schemas ───────────────────────────────────────────────────────────────

class CSPOppOut(BaseModel):
    symbol: str
    conviction: str
    stock_price: float
    expiration: str
    dte: int
    strike: float
    bid: float
    ask: float
    premium_per_contract: float
    delta: float
    theta_per_day: float
    iv_pct: float
    capital_required: float
    annualized_yield_pct: float
    effective_buy_price: float
    discount_pct: float
    assignment_prob_pct: float
    open_interest: int
    volume: int
    score: float


class CSPSymbolResult(BaseModel):
    symbol: str
    conviction: str
    current_price: float
    opportunities: list[CSPOppOut]


# ── IV Environment schema ─────────────────────────────────────────────────────

class IVEnvironmentOut(BaseModel):
    symbol: str
    current_iv_pct: float
    iv_rank: float
    hv_30d_pct: float
    iv_hv_spread: float
    recommendation: str
    rec_reason: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

# ── Playbook schemas ──────────────────────────────────────────────────────────

class TradeRecOut(BaseModel):
    strategy: str
    priority: int
    label: str
    reason: str
    strike: float | None = None
    expiration: str | None = None
    dte: int | None = None
    premium: float | None = None
    annualized_yield_pct: float | None = None
    capital_required: float | None = None
    cost: float | None = None
    breakeven: float | None = None
    earnings_warning: str | None = None


class WatchConditionOut(BaseModel):
    category: str
    condition: str
    current_state: str
    importance: str


class StockPlaybookOut(BaseModel):
    symbol: str
    asset_type: str
    stock_price: float
    direction: str
    label: str
    score: int
    max_score: int
    confidence_pct: float
    signals: list[dict]
    iv_rank: float | None = None
    current_iv_pct: float | None = None
    iv_recommendation: str | None = None
    next_earnings_date: str | None = None
    days_to_earnings: int | None = None
    recommendations: list[TradeRecOut]
    watch_conditions: list[WatchConditionOut]
    risk_flags: list[str]
    entry_price: float = 0.0
    take_profit: float = 0.0
    stop_loss: float = 0.0
    risk_reward: float = 0.0


class OpportunityItemOut(BaseModel):
    symbol: str
    direction: str
    label: str
    score: int
    max_score: int
    confidence_pct: float
    signals_passing: int
    signals_needed_for_high: int
    missing_signal_names: list[str]
    watch_summary: str
    projected_trade: str
    opportunity_score: float


# ── Playbook endpoints ────────────────────────────────────────────────────────

@router.get("/analyze", response_model=StockPlaybookOut)
async def get_stock_playbook(
    symbol: str = Query(..., description="Stock ticker symbol e.g. AAPL"),
    asset_type: str = Query(default="stock", description="stock | crypto"),
):
    """Full live analysis + trade playbook for any symbol. Takes ~5-10 seconds."""
    from fastapi import HTTPException
    try:
        result = await analyze_stock(symbol.upper(), asset_type)
        return StockPlaybookOut(
            symbol=result.symbol,
            asset_type=result.asset_type,
            stock_price=result.stock_price,
            direction=result.direction,
            label=result.label,
            score=result.score,
            max_score=result.max_score,
            confidence_pct=result.confidence_pct,
            signals=result.signals,
            iv_rank=result.iv_rank,
            current_iv_pct=result.current_iv_pct,
            iv_recommendation=result.iv_recommendation,
            next_earnings_date=result.next_earnings_date,
            days_to_earnings=result.days_to_earnings,
            recommendations=[TradeRecOut(**r.__dict__) for r in result.recommendations],
            watch_conditions=[WatchConditionOut(**w.__dict__) for w in result.watch_conditions],
            risk_flags=result.risk_flags,
            entry_price=result.entry_price,
            take_profit=result.take_profit,
            stop_loss=result.stop_loss,
            risk_reward=result.risk_reward,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/opportunities", response_model=list[OpportunityItemOut])
async def get_opportunity_scan():
    """
    Stocks close to a HIGH CONVICTION setup from the conviction cache.
    Instant — reads from DB, no live computation.
    """
    items = await get_opportunities()
    return [OpportunityItemOut(**item.__dict__) for item in items]


@router.get("/options-scan", response_model=list[StockScanResult])
async def get_options_scan(
    min_dte: int = Query(default=25, ge=7, le=60),
    max_dte: int = Query(default=60, ge=14, le=180),
    min_delta: float = Query(default=0.35, ge=0.1, le=0.9),
    max_delta: float = Query(default=0.65, ge=0.1, le=0.9),
    conviction_filter: str = Query(default="all", description="all | high | moderate"),
    db: AsyncSession = Depends(get_db),
):
    labels = _SCAN_LABELS
    if conviction_filter == "high":
        labels = {"HIGH_CONVICTION"}
    elif conviction_filter == "moderate":
        labels = {"MODERATE"}

    result = await db.execute(
        select(ConvictionCache).where(
            ConvictionCache.label.in_(labels),
            ConvictionCache.asset_type != "crypto",
            ConvictionCache.direction.in_(list(_DIRECTIONAL)),
        )
    )
    rows = result.scalars().all()
    if not rows:
        return []

    async def _scan_one(row: ConvictionCache) -> StockScanResult | None:
        try:
            opps = await asyncio.to_thread(
                scan_options_to_buy,
                row.symbol, row.direction, row.label,
                min_dte=min_dte, max_dte=max_dte,
                min_delta=min_delta, max_delta=max_delta,
            )
            return StockScanResult(
                symbol=row.symbol,
                direction=row.direction,
                conviction=row.label,
                options=[OptionOppOut(**asdict(o)) for o in opps],
            )
        except Exception:
            return None

    raw = await asyncio.gather(*[_scan_one(r) for r in rows], return_exceptions=True)
    results = [r for r in raw if isinstance(r, StockScanResult) and r.options]
    label_order = {"HIGH_CONVICTION": 0, "MODERATE": 1, "WEAK": 2}
    results.sort(key=lambda r: (label_order.get(r.conviction, 9), -len(r.options)))
    return results


@router.get("/covered-calls", response_model=list[CCHoldingResult])
async def get_covered_calls(db: AsyncSession = Depends(get_db)):
    """Scan covered call opportunities for all stock holdings with 100+ shares."""
    result = await db.execute(
        select(Holding).where(
            Holding.quantity >= 100,
            Holding.asset_type == "stock",
        )
    )
    holdings = result.scalars().all()
    if not holdings:
        return []

    async def _scan_one(h: Holding) -> CCHoldingResult | None:
        try:
            opps = await asyncio.to_thread(
                scan_covered_calls, h.symbol, h.quantity, h.avg_buy_price
            )
            current_price = opps[0].stock_price if opps else h.avg_buy_price
            return CCHoldingResult(
                symbol=h.symbol,
                shares_owned=h.quantity,
                avg_cost=round(h.avg_buy_price, 4),
                current_price=round(current_price, 4),
                opportunities=[CCOppOut(**asdict(o)) for o in opps],
            )
        except Exception:
            return None

    raw = await asyncio.gather(*[_scan_one(h) for h in holdings], return_exceptions=True)
    return [r for r in raw if isinstance(r, CCHoldingResult)]


@router.get("/cash-secured-puts", response_model=list[CSPSymbolResult])
async def get_cash_secured_puts(db: AsyncSession = Depends(get_db)):
    """Scan CSP opportunities on HIGH_CONVICTION and MODERATE BUY stocks."""
    result = await db.execute(
        select(ConvictionCache).where(
            ConvictionCache.label.in_({"HIGH_CONVICTION", "MODERATE"}),
            ConvictionCache.direction == "BUY",
            ConvictionCache.asset_type != "crypto",
        )
    )
    rows = result.scalars().all()
    if not rows:
        return []

    async def _scan_one(row: ConvictionCache) -> CSPSymbolResult | None:
        try:
            opps = await asyncio.to_thread(
                scan_cash_secured_puts, row.symbol, row.label
            )
            current_price = opps[0].stock_price if opps else 0.0
            return CSPSymbolResult(
                symbol=row.symbol,
                conviction=row.label,
                current_price=round(current_price, 4),
                opportunities=[CSPOppOut(**asdict(o)) for o in opps],
            )
        except Exception:
            return None

    raw = await asyncio.gather(*[_scan_one(r) for r in rows], return_exceptions=True)
    results = [r for r in raw if isinstance(r, CSPSymbolResult)]
    label_order = {"HIGH_CONVICTION": 0, "MODERATE": 1}
    results.sort(key=lambda r: label_order.get(r.conviction, 9))
    return results


@router.get("/iv-environment", response_model=list[IVEnvironmentOut])
async def get_iv_environment_scan(db: AsyncSession = Depends(get_db)):
    """IV Rank and sell/buy recommendation for holdings + conviction BUY stocks."""
    holding_result = await db.execute(
        select(Holding).where(Holding.asset_type == "stock", Holding.quantity > 0)
    )
    conviction_result = await db.execute(
        select(ConvictionCache).where(
            ConvictionCache.label.in_({"HIGH_CONVICTION", "MODERATE"}),
            ConvictionCache.asset_type != "crypto",
        )
    )
    symbols = list({
        h.symbol for h in holding_result.scalars().all()
    } | {
        r.symbol for r in conviction_result.scalars().all()
    })
    symbols = symbols[:15]  # cap for performance

    async def _scan_one(sym: str) -> IVEnvironmentOut | None:
        try:
            env = await asyncio.to_thread(get_iv_environment, sym)
            if env is None:
                return None
            return IVEnvironmentOut(**asdict(env))
        except Exception:
            return None

    raw = await asyncio.gather(*[_scan_one(s) for s in symbols], return_exceptions=True)
    results = [r for r in raw if isinstance(r, IVEnvironmentOut)]
    results.sort(key=lambda r: r.iv_rank, reverse=True)
    return results
