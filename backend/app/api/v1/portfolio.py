import asyncio
import dataclasses

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.portfolio import AccountSummary, HoldingOut, TransactionCreate, TransactionOut
from app.services.portfolio_service import portfolio_service
from app.services.risk_service import compute_portfolio_risk

router = APIRouter(prefix="/portfolio", tags=["Portfolio"])


@router.get("/summary", response_model=AccountSummary)
async def account_summary(db: AsyncSession = Depends(get_db)):
    return await portfolio_service.get_account_summary(db)


@router.get("/holdings", response_model=list[HoldingOut])
async def get_holdings(db: AsyncSession = Depends(get_db)):
    return await portfolio_service.get_holdings(db)


@router.get("/transactions", response_model=list[TransactionOut])
async def get_transactions(
    symbol: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await portfolio_service.get_transactions(db, symbol)


@router.post("/transactions", response_model=TransactionOut, status_code=201)
async def add_transaction(data: TransactionCreate, db: AsyncSession = Depends(get_db)):
    return await portfolio_service.add_transaction(data, db)


@router.get("/risk")
async def get_portfolio_risk(db: AsyncSession = Depends(get_db)):
    holdings = await portfolio_service.get_holdings(db)
    holding_dicts = [
        {"symbol": h.symbol, "current_value": h.current_value, "asset_type": h.asset_type}
        for h in holdings
    ]
    result = await asyncio.to_thread(compute_portfolio_risk, holding_dicts)
    return dataclasses.asdict(result)
