from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.alert import Alert
from app.models.watchlist import WatchlistItem
from app.schemas.alerts import AlertCreate, AlertOut, WatchlistItemCreate, WatchlistItemOut

router = APIRouter(tags=["Alerts & Watchlist"])


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------
@router.get("/alerts", response_model=list[AlertOut])
async def list_alerts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Alert).order_by(Alert.created_at.desc()))
    return result.scalars().all()


@router.post("/alerts", response_model=AlertOut, status_code=201)
async def create_alert(data: AlertCreate, db: AsyncSession = Depends(get_db)):
    alert = Alert(**data.model_dump())
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    return alert


@router.delete("/alerts/{alert_id}", status_code=204)
async def delete_alert(alert_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    await db.delete(alert)
    await db.commit()


@router.patch("/alerts/{alert_id}/reset", response_model=AlertOut)
async def reset_alert(alert_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(
        update(Alert).where(Alert.id == alert_id).values(
            is_triggered=False, triggered_at=None, triggered_price=None, is_active=True
        )
    )
    await db.commit()
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Watchlist
# ---------------------------------------------------------------------------
@router.get("/watchlist", response_model=list[WatchlistItemOut])
async def list_watchlist(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(WatchlistItem).order_by(WatchlistItem.added_at.desc()))
    return result.scalars().all()


@router.post("/watchlist", response_model=WatchlistItemOut, status_code=201)
async def add_to_watchlist(data: WatchlistItemCreate, db: AsyncSession = Depends(get_db)):
    item = WatchlistItem(**data.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/watchlist/{item_id}", status_code=204)
async def remove_from_watchlist(item_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(WatchlistItem).where(WatchlistItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.delete(item)
    await db.commit()
