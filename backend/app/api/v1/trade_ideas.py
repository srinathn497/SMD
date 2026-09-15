import asyncio
import json
from datetime import datetime

from fastapi import APIRouter

from app.services.trade_idea_service import generate_trade_ideas, get_latest_ideas
from app.services.conviction_scanner import is_scan_running

router = APIRouter(prefix="/trade-ideas", tags=["Trade Ideas"])

# Track the background generate task so we can report its status
_generate_task: asyncio.Task | None = None


def _serialise(idea) -> dict:
    return {
        "id":               idea.id,
        "trade_date":       idea.trade_date,
        "rank":             idea.rank,
        "symbol":           idea.symbol,
        "asset_type":       idea.asset_type,
        "direction":        idea.direction,
        "price":            idea.price,
        "entry_low":        idea.entry_low,
        "entry_high":       idea.entry_high,
        "stop_loss":        idea.stop_loss,
        "target1":          idea.target1,
        "target2":          idea.target2,
        "risk_reward":      idea.risk_reward,
        "conviction_score": idea.conviction_score,
        "conviction_max":   idea.conviction_max,
        "conviction_label": idea.conviction_label,
        "thesis":           idea.thesis,
        "key_signals":      json.loads(idea.key_signals_json or "[]"),
        "invalidation":     idea.invalidation,
        "time_horizon":     idea.time_horizon,
        "risk_per_share":   idea.risk_per_share,
        "position_size_1pct": idea.position_size_1pct,
        "generated_at":     idea.generated_at.isoformat() if isinstance(idea.generated_at, datetime) else idea.generated_at,
    }


@router.get("")
async def list_trade_ideas():
    ideas = await get_latest_ideas()
    return [_serialise(i) for i in ideas]


@router.post("/generate")
async def trigger_generate():
    """Fire-and-forget: start a fresh conviction scan + idea generation in the background.
    Returns immediately — poll /generate/status to know when it finishes."""
    global _generate_task

    already_running = is_scan_running() or (
        _generate_task is not None and not _generate_task.done()
    )
    if already_running:
        return {"status": "already_scanning"}

    _generate_task = asyncio.create_task(generate_trade_ideas(fresh_scan=True))
    return {"status": "scanning"}


@router.get("/generate/status")
async def generate_status():
    """Returns whether a scan is currently running."""
    scanning = is_scan_running() or (
        _generate_task is not None and not _generate_task.done()
    )
    return {"scanning": bool(scanning)}
