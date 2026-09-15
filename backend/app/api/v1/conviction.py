"""
Conviction Leaderboard API
==========================

GET  /api/v1/conviction/leaderboard   — ranked list from DB cache
POST /api/v1/conviction/scan          — trigger a background scan
GET  /api/v1/conviction/scan/status   — check whether a scan is running
"""
import json
import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.conviction_cache import ConvictionCache
from app.services.conviction_scanner import is_scan_running, run_conviction_scan
from app.services.model_refresh import get_refresh_status, run_model_refresh
from app.services.scanner import DEFAULT_STOCKS, DEFAULT_CRYPTO

logger = logging.getLogger("conviction_api")

router = APIRouter(prefix="/conviction", tags=["Conviction Leaderboard"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class LeaderboardRow(BaseModel):
    symbol:      str
    asset_type:  str
    score:       int
    max_score:   int
    label:       str
    direction:   str
    signals:     list[Any]
    computed_at: str | None = None


class ScanStatusOut(BaseModel):
    running: bool


class ScanStartOut(BaseModel):
    status:  str
    symbols: int


class RefreshStatusOut(BaseModel):
    running:     bool
    total:       int
    trained:     int
    skipped:     int
    failed:      int
    current:     str | None = None
    started_at:  float | None = None
    finished_at: float | None = None
    last_error:  str | None = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _row_to_out(row: ConvictionCache) -> LeaderboardRow:
    try:
        signals = json.loads(row.signals_json)
    except Exception:
        signals = []
    return LeaderboardRow(
        symbol=row.symbol,
        asset_type=row.asset_type,
        score=row.score,
        max_score=row.max_score,
        label=row.label,
        direction=row.direction,
        signals=signals,
        computed_at=(row.computed_at.isoformat() + "Z") if row.computed_at else None,
    )


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/leaderboard", response_model=list[LeaderboardRow])
async def get_leaderboard(
    limit: int = Query(10, ge=1, le=50),
    min_score: int = Query(0, ge=0, le=7),
    direction: str = Query("all", description="all | BUY | SELL"),
    db: AsyncSession = Depends(get_db),
):
    """
    Return up to `limit` symbols sorted by conviction score descending.
    Optionally filter by minimum score and/or direction.
    """
    stmt = select(ConvictionCache).where(ConvictionCache.score >= min_score)
    if direction.upper() in ("BUY", "SELL"):
        stmt = stmt.where(ConvictionCache.direction == direction.upper())
    stmt = stmt.order_by(ConvictionCache.score.desc()).limit(limit)

    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [_row_to_out(r) for r in rows]


@router.post("/scan", response_model=ScanStartOut)
async def trigger_scan(background_tasks: BackgroundTasks):
    """
    Trigger a background conviction scan for all 30 default symbols.
    Returns immediately; results become available in /leaderboard as they're saved.
    """
    if is_scan_running():
        return ScanStartOut(status="already_running", symbols=0)

    total = len(DEFAULT_STOCKS) + len(DEFAULT_CRYPTO)
    background_tasks.add_task(run_conviction_scan)
    logger.info(f"[conviction_api] Scan triggered via API — {total} symbols queued")
    return ScanStartOut(status="started", symbols=total)


@router.get("/scan/status", response_model=ScanStatusOut)
async def get_scan_status():
    """Check whether a conviction scan is currently running."""
    return ScanStatusOut(running=is_scan_running())


@router.post("/refresh-models", response_model=RefreshStatusOut)
async def trigger_model_refresh(
    background_tasks: BackgroundTasks,
    force: bool = Query(False, description="Retrain every symbol, not just stale ones"),
):
    """
    Retrain stale / old-schema daily ML bundles in the background.

    Run this after the machine has been off for a while — it grinds through the
    whole universe so a subsequent /scan doesn't have to retrain inline (which
    it can't finish inside its timeout).  Progress: /refresh-models/status.
    """
    st = get_refresh_status()
    if st["running"]:
        return RefreshStatusOut(**st)

    background_tasks.add_task(run_model_refresh, None, force)
    logger.info(f"[conviction_api] model refresh triggered (force={force})")
    return RefreshStatusOut(**{**st, "running": True})


@router.get("/refresh-models/status", response_model=RefreshStatusOut)
async def get_model_refresh_status():
    """Live progress of the background model-refresh job."""
    return RefreshStatusOut(**get_refresh_status())
