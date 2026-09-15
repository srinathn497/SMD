"""
Trade Idea Generation Service

Runs at 06:30 daily (after the 06:00 conviction scan).
Reads the conviction cache, picks the top qualifying symbols,
computes trade levels, and writes ranked TradeIdea rows for the day.
"""
import asyncio
import json
import logging
import random
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import delete, select

from app.database import AsyncSessionLocal
from app.models.conviction_cache import ConvictionCache
from app.models.trade_idea import TradeIdea
from app.services.scanner import market_scanner
from app.services.conviction_scanner import run_conviction_scan

logger = logging.getLogger("trade_idea_service")

# Limit concurrent yfinance calls during idea generation
_IDEA_SEM = asyncio.Semaphore(3)

# How many ideas to surface per day
MAX_IDEAS = 7

# Minimum score ratio to qualify (e.g. 0.40 = 40% of signals passed)
# Conviction label (WEAK/MODERATE/HIGH_CONVICTION) communicates signal quality to the user.
MIN_SCORE_RATIO = 0.40

# Default account size used for position sizing guidance
DEFAULT_ACCOUNT = 10_000.0
RISK_PCT = 0.01  # 1% risk per trade


# ── Thesis generation ─────────────────────────────────────────────────────────

def _build_thesis(direction: str, signals: list[dict]) -> str:
    fired = {s["name"] for s in signals if s.get("passed")}
    action = "bullish" if direction == "BUY" else "bearish"

    has_breakout   = "Breakout+Momentum" in fired
    has_mean_rev   = "Mean Reversion" in fired
    has_ml_daily   = "Daily ML direction" in fired
    has_ml_intra   = "15m ML direction" in fired
    has_technical  = "Technical aggregate" in fired
    has_volume     = "Volume" in fired
    has_sentiment  = "News sentiment" in fired
    has_intraday   = "Intraday signal" in fired or "Intraday score" in fired
    has_options    = bool({"Put/Call OI Ratio", "Max Pain", "IV Skew", "Put/Call Volume"} & fired)
    has_fundamntls = bool({"Fundamental Health", "FCF Yield", "Debt/Equity", "P/E Valuation"} & fired)

    if has_breakout and has_ml_daily and has_volume:
        return "Breaking out of consolidation with ML confirmation and above-average volume — momentum building"
    if has_breakout and has_volume:
        return "Price breakout on elevated volume — continuation move likely if momentum holds"
    if has_mean_rev and has_technical:
        adj = "deeply oversold" if direction == "BUY" else "overextended"
        return f"Stock is {adj} on technicals — mean-reversion setup with multi-indicator confirmation"
    if has_ml_daily and has_ml_intra and has_technical:
        return f"Triple confirmation: daily ML, intraday ML, and technical indicators all aligned {action}"
    if has_fundamntls and has_ml_daily:
        return f"Strong fundamentals underpin ML-driven {action} signal — quality setup with balance-sheet backstop"
    if has_options and has_ml_daily:
        return f"Unusual options flow (smart-money positioning) supports ML {action} signal"
    if has_ml_daily and has_technical:
        return f"ML model and technical indicators both signal {action} — dual-confirmation setup"
    if has_sentiment and has_technical:
        return f"Positive news flow aligns with technical {action} setup"
    if has_intraday and has_technical:
        return f"Intraday momentum aligns with technical {action} bias — short-term setup"
    n = len(fired)
    total = len(signals)
    return f"{n}/{total} signals confirm {action} bias — multi-framework convergence"


def _key_signals(signals: list[dict], direction: str) -> list[str]:
    """Return top 3 signal names that passed and support the direction."""
    # Prefer ML and breakout signals at the top
    priority = [
        "Daily ML direction", "Breakout+Momentum", "15m ML direction",
        "Technical aggregate", "Fundamental Health", "Put/Call OI Ratio",
        "Mean Reversion", "Volume", "News sentiment",
    ]
    fired = [s["name"] for s in signals if s.get("passed")]
    ordered = [p for p in priority if p in fired] + [f for f in fired if f not in priority]
    return ordered[:3]


def _time_horizon(signals: list[dict]) -> str:
    fired = {s["name"] for s in signals if s.get("passed")}
    if "Intraday signal" in fired or "Intraday score" in fired:
        return "MOMENTUM_1_2D"
    if "Breakout+Momentum" in fired:
        return "SWING_3_7D"
    fundamental_count = len({"Fundamental Health", "FCF Yield", "Debt/Equity", "P/E Valuation"} & fired)
    if fundamental_count >= 2:
        return "POSITIONAL_2_4W"
    return "SWING_3_7D"


def _invalidation(direction: str, stop_loss: float, symbol: str) -> str:
    action = "below" if direction == "BUY" else "above"
    return f"Thesis breaks if {symbol} closes {action} ${stop_loss:.2f} on above-average volume"


# ── Core generation ───────────────────────────────────────────────────────────

async def generate_trade_ideas(fresh_scan: bool = False) -> list[TradeIdea]:
    """
    1. (fresh_scan only) Short-circuit: if today's ideas already exist, return them.
    2. Read conviction cache for all symbols (no new scan — cache is updated by the 06:00 cron
       or by the startup catch-up; Fresh Scan uses whatever is already in the cache).
    3. Filter to qualifying symbols (score ratio >= MIN_SCORE_RATIO, direction != NEUTRAL).
    4. Call scanner for entry/ATR levels on each qualifying symbol (semaphore=3).
    5. Build TradeIdea objects, ranked by conviction score.
    6. Persist to DB (replaces today's ideas).
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Once-per-day short-circuit: if today's ideas already exist don't rescan
    if fresh_scan:
        async with AsyncSessionLocal() as session:
            existing = (
                await session.execute(
                    select(TradeIdea).where(TradeIdea.trade_date == today).limit(1)
                )
            ).scalars().first()
        if existing is not None:
            logger.info("Trade ideas for %s already generated — returning existing", today)
            return await get_latest_ideas()

    async with AsyncSessionLocal() as session:
        rows = (await session.execute(select(ConvictionCache))).scalars().all()

    qualifying = [
        r for r in rows
        if r.direction != "NEUTRAL"
        and r.max_score > 0
        and (r.score / r.max_score) >= MIN_SCORE_RATIO
    ]

    # Group by conviction tier and shuffle within each tier so regenerating
    # surfaces different stocks from the qualifying pool each time.
    tier_order = ["HIGH_CONVICTION", "MODERATE", "WEAK"]
    groups: dict[str, list] = defaultdict(list)
    for r in qualifying:
        groups[r.label].append(r)
    for g in groups.values():
        random.shuffle(g)
    candidates = []
    for tier in tier_order:
        candidates.extend(groups.get(tier, []))
        if len(candidates) >= MAX_IDEAS * 2:
            break
    candidates = candidates[:MAX_IDEAS * 2]

    if not candidates:
        logger.info("No qualifying symbols for trade ideas today")
        return []

    # Scan candidates concurrently — semaphore limits to 3 concurrent yfinance calls
    # Each task has its own 25s timeout; no outer timeout so partial results are never lost
    async def _scan_one(cached: ConvictionCache):
        async with _IDEA_SEM:
            try:
                result = await asyncio.wait_for(
                    market_scanner.scan_symbol(cached.symbol, cached.symbol, cached.asset_type),
                    timeout=25.0,
                )
                return cached, result
            except Exception as e:
                logger.warning("Scan failed for %s: %s", cached.symbol, e)
                return cached, None

    scan_tasks = [_scan_one(c) for c in candidates]
    raw_results = await asyncio.gather(*scan_tasks, return_exceptions=True)
    # Filter out any BaseException items that slipped past _scan_one's try/except
    scan_results = [r for r in raw_results if not isinstance(r, BaseException)]

    ideas: list[TradeIdea] = []
    for cached, scan in scan_results:
        if scan is None or scan.error:
            continue
        if len(ideas) >= MAX_IDEAS:
            break

        direction = cached.direction
        price = scan.price
        if price <= 0:
            continue

        # ATR-based levels from scanner (stop = 1× ATR, tp = 1.5× ATR)
        stop_loss = scan.stop_loss
        target1   = scan.take_profit
        # Extend target2 to 2.5× ATR for letting winners run
        atr = abs(price - stop_loss)   # 1× ATR
        if direction == "BUY":
            target2 = round(price + 2.5 * atr, 4)
        else:
            target2 = round(price - 2.5 * atr, 4)

        risk_per_share = abs(price - stop_loss)
        risk_reward    = round(abs(target2 - price) / risk_per_share, 2) if risk_per_share > 0 else 0.0

        # Entry zone: ±0.2% around current price
        entry_low  = round(price * 0.998, 4)
        entry_high = round(price * 1.002, 4)

        # Position sizing: risk 1% of default account
        risk_amount = DEFAULT_ACCOUNT * RISK_PCT
        pos_size = int(risk_amount / risk_per_share) if risk_per_share > 0 else 0

        signals = json.loads(cached.signals_json) if cached.signals_json else []

        idea = TradeIdea(
            trade_date      = today,
            rank            = len(ideas) + 1,
            symbol          = cached.symbol,
            asset_type      = cached.asset_type,
            direction       = direction,
            price           = price,
            entry_low       = entry_low,
            entry_high      = entry_high,
            stop_loss       = stop_loss,
            target1         = target1,
            target2         = target2,
            risk_reward     = risk_reward,
            conviction_score= cached.score,
            conviction_max  = cached.max_score,
            conviction_label= cached.label,
            thesis          = _build_thesis(direction, signals),
            key_signals_json= json.dumps(_key_signals(signals, direction)),
            invalidation    = _invalidation(direction, stop_loss, cached.symbol),
            time_horizon    = _time_horizon(signals),
            risk_per_share  = round(risk_per_share, 4),
            position_size_1pct = pos_size,
            generated_at    = datetime.now(timezone.utc),
        )
        ideas.append(idea)

    if not ideas:
        logger.info("No trade ideas generated for %s", today)
        return []

    async with AsyncSessionLocal() as session:
        # Replace today's ideas atomically
        await session.execute(delete(TradeIdea).where(TradeIdea.trade_date == today))
        session.add_all(ideas)
        await session.commit()

    logger.info("Generated %d trade ideas for %s", len(ideas), today)
    return ideas


async def get_latest_ideas() -> list[TradeIdea]:
    """Return today's ideas; fall back to the most recent date if none yet today."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(TradeIdea)
                .where(TradeIdea.trade_date == today)
                .order_by(TradeIdea.rank)
            )
        ).scalars().all()
        if rows:
            return list(rows)
        # Fall back to most recent available date
        rows = (
            await session.execute(
                select(TradeIdea).order_by(TradeIdea.trade_date.desc(), TradeIdea.rank)
            )
        ).scalars().all()
        return list(rows)
