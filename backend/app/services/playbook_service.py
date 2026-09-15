"""
Stock Playbook Service

Two functions:

  analyze_stock(symbol, asset_type)
      Runs live conviction analysis + options scan for any symbol.
      Returns a complete trade playbook: direction, all signals, ranked
      trade recommendations, what to watch for, and risk flags.

  get_opportunities()
      Reads the conviction cache and returns stocks that are close to a
      HIGH CONVICTION setup — ranked by how few signals are missing.
      Fast (DB-only, no live computation).
"""
import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.conviction_cache import ConvictionCache
from app.services.conviction import compute_conviction
from app.services.covered_call_service import (
    get_iv_environment,
    scan_cash_secured_puts,
)
from app.services.income_service import scan_options_to_buy
from app.services.market_context import get_earnings_dates

logger = logging.getLogger("playbook_service")


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class TradeRecommendation:
    strategy: str          # BUY_CALL | BUY_PUT | SELL_CSP | SELL_CC | WAIT
    priority: int          # 1 = primary, 2 = secondary
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


@dataclass
class WatchCondition:
    category: str          # technical | ml | volume | iv | earnings | fundamental
    condition: str         # what to watch for
    current_state: str     # what it is right now
    importance: str        # CRITICAL | HELPFUL


@dataclass
class StockPlaybook:
    symbol: str
    asset_type: str
    stock_price: float
    direction: str
    label: str
    score: int
    max_score: int
    confidence_pct: float
    signals: list[dict]
    iv_rank: float | None
    current_iv_pct: float | None
    iv_recommendation: str | None
    next_earnings_date: str | None
    days_to_earnings: int | None
    recommendations: list[TradeRecommendation]
    watch_conditions: list[WatchCondition]
    risk_flags: list[str]
    # ATR-based stock trade levels
    entry_price: float = 0.0
    take_profit: float = 0.0
    stop_loss: float = 0.0
    risk_reward: float = 0.0


@dataclass
class OpportunityItem:
    symbol: str
    direction: str
    label: str
    score: int
    max_score: int
    confidence_pct: float
    signals_passing: int
    signals_needed_for_high: int    # how many more to reach HIGH_CONVICTION
    missing_signal_names: list[str] # top failing signals to watch
    watch_summary: str              # plain English
    projected_trade: str            # trade if setup completes
    opportunity_score: float        # sort key: higher = closer to setup


# ── Signal → watch condition mapping ─────────────────────────────────────────

_WATCH_MAP: dict[str, dict] = {
    "Technical":       {"condition": "Technical indicators need to align — price above MA20, RSI above 50, MACD turning positive", "importance": "CRITICAL"},
    "Daily ML":        {"condition": "Daily ML model needs to predict direction with ≥55% confidence", "importance": "CRITICAL"},
    "15m ML":          {"condition": "15-minute intraday model needs to confirm direction", "importance": "HELPFUL"},
    "News":            {"condition": "News sentiment needs to improve — watch for positive catalyst or analyst upgrade", "importance": "HELPFUL"},
    "Volume":          {"condition": "Volume needs to surge above the 20-day average to confirm conviction", "importance": "HELPFUL"},
    "Intraday Signal": {"condition": "Intraday price action needs to align with the daily direction", "importance": "HELPFUL"},
    "Intraday Score":  {"condition": "Composite intraday score needs to reach ±2 threshold", "importance": "HELPFUL"},
    "Put/Call OI":     {"condition": "Options open interest needs more calls vs puts (bullish positioning)", "importance": "HELPFUL"},
    "Max Pain":        {"condition": "Max pain strike needs to be above current price (suggests gravitational pull upward)", "importance": "HELPFUL"},
    "IV Skew":         {"condition": "IV skew needs to normalize — put premium vs call premium imbalance", "importance": "HELPFUL"},
    "Put/Call Volume": {"condition": "Options volume needs to show more call activity than puts", "importance": "HELPFUL"},
    "Breakout":        {"condition": "Price needs to break above the 20-day high with above-average volume", "importance": "CRITICAL"},
    "Mean Reversion":  {"condition": "Wait for a deeper pullback — Z-score needs to reach -2.0 (oversold level) before buying", "importance": "HELPFUL"},
    "Fundamentals":    {"condition": "Fundamental health score needs to improve — check earnings growth, FCF, and margins", "importance": "HELPFUL"},
    "FCF Yield":       {"condition": "Free cash flow yield needs to turn positive (>0%) — company should not be burning cash", "importance": "HELPFUL"},
    "Debt/Equity":     {"condition": "Debt/Equity is elevated — monitor balance sheet for deleveraging progress", "importance": "HELPFUL"},
    "P/E Valuation":   {"condition": "P/E ratio is elevated — wait for valuation to compress or earnings to grow into the price", "importance": "HELPFUL"},
}


# ── Earnings helper ───────────────────────────────────────────────────────────

def _next_earnings(symbol: str) -> tuple[str | None, int | None]:
    """Return (date_str, days_away) for the next earnings date, or (None, None)."""
    try:
        today = date.today()
        dates = get_earnings_dates(symbol)
        future = [d for d in dates if d > today]
        if not future:
            return None, None
        nxt = min(future)
        days = (nxt - today).days
        return nxt.isoformat(), days
    except Exception:
        return None, None


# ── Trade recommendation builder ──────────────────────────────────────────────

def _build_recommendations(
    direction: str,
    iv_rank: float,
    csp_opps: list,
    buy_opps: list,
    days_to_earnings: int | None,
) -> list[TradeRecommendation]:
    recs: list[TradeRecommendation] = []
    earnings_warn = (
        f"⚠ Earnings in {days_to_earnings} days — IV is inflated (IV crush risk after report). Consider waiting."
        if days_to_earnings is not None and days_to_earnings <= 21 else None
    )

    if direction == "BUY":
        if iv_rank >= 45:
            # High IV + bullish → sell CSP is primary
            if csp_opps:
                b = csp_opps[0]
                recs.append(TradeRecommendation(
                    strategy="SELL_CSP", priority=1,
                    label="Sell Cash-Secured Put",
                    reason=f"Bullish conviction + IV Rank {iv_rank:.0f}% (elevated) = ideal for selling premium. Collect cash while waiting for upside.",
                    strike=b.strike, expiration=b.expiration, dte=b.dte,
                    premium=b.premium_per_contract,
                    annualized_yield_pct=b.annualized_yield_pct,
                    capital_required=b.capital_required,
                    breakeven=b.effective_buy_price,
                    earnings_warning=earnings_warn,
                ))
            calls = [o for o in buy_opps if o.option_type == "CALL"]
            if calls:
                b = calls[0]
                recs.append(TradeRecommendation(
                    strategy="BUY_CALL", priority=2,
                    label="Buy Call Option (alternative)",
                    reason="If you want leveraged upside instead of premium income, buy a call.",
                    strike=b.strike, expiration=b.expiration, dte=b.dte,
                    cost=b.cost_per_contract, breakeven=b.breakeven_price,
                    earnings_warning=earnings_warn,
                ))
        else:
            # Low IV + bullish → buy call is primary
            calls = [o for o in buy_opps if o.option_type == "CALL"]
            if calls:
                b = calls[0]
                recs.append(TradeRecommendation(
                    strategy="BUY_CALL", priority=1,
                    label="Buy Call Option",
                    reason=f"Bullish conviction + IV Rank {iv_rank:.0f}% (cheap) = options are affordable. Buy the upside.",
                    strike=b.strike, expiration=b.expiration, dte=b.dte,
                    cost=b.cost_per_contract, breakeven=b.breakeven_price,
                    earnings_warning=earnings_warn,
                ))
            if csp_opps:
                b = csp_opps[0]
                recs.append(TradeRecommendation(
                    strategy="SELL_CSP", priority=2,
                    label="Sell Cash-Secured Put (alternative)",
                    reason="If you'd rather collect income and potentially own shares at a discount.",
                    strike=b.strike, expiration=b.expiration, dte=b.dte,
                    premium=b.premium_per_contract,
                    annualized_yield_pct=b.annualized_yield_pct,
                    capital_required=b.capital_required,
                    breakeven=b.effective_buy_price,
                    earnings_warning=earnings_warn,
                ))

    elif direction == "SELL":
        puts = [o for o in buy_opps if o.option_type == "PUT"]
        if puts:
            b = puts[0]
            recs.append(TradeRecommendation(
                strategy="BUY_PUT", priority=1,
                label="Buy Put Option",
                reason=f"Bearish conviction — buy a put to profit from the expected decline.",
                strike=b.strike, expiration=b.expiration, dte=b.dte,
                cost=b.cost_per_contract, breakeven=b.breakeven_price,
                earnings_warning=earnings_warn,
            ))

    else:  # NEUTRAL
        if iv_rank >= 45 and csp_opps:
            b = csp_opps[0]
            recs.append(TradeRecommendation(
                strategy="SELL_CSP", priority=1,
                label="Sell Cash-Secured Put",
                reason=f"No clear direction but IV Rank {iv_rank:.0f}% is elevated — sell premium to collect income while waiting.",
                strike=b.strike, expiration=b.expiration, dte=b.dte,
                premium=b.premium_per_contract,
                annualized_yield_pct=b.annualized_yield_pct,
                capital_required=b.capital_required,
                breakeven=b.effective_buy_price,
                earnings_warning=earnings_warn,
            ))
        else:
            recs.append(TradeRecommendation(
                strategy="WAIT", priority=1,
                label="Wait — No Clear Setup",
                reason="Direction is NEUTRAL and IV is not elevated. No compelling options trade right now. Watch for conviction signals to align.",
            ))

    if not recs:
        recs.append(TradeRecommendation(
            strategy="WAIT", priority=1,
            label="Wait — No Options Data",
            reason="No liquid options found in the 21–45 DTE window. Check back or use a different expiry.",
        ))

    return recs


# ── Watch conditions builder ──────────────────────────────────────────────────

def _build_watch_conditions(
    signals: list[dict],
    direction: str,
    iv_rank: float | None,
    days_to_earnings: int | None,
) -> list[WatchCondition]:
    conditions: list[WatchCondition] = []

    for sig in signals:
        if sig["passed"]:
            continue
        meta = _WATCH_MAP.get(sig["name"])
        if meta is None:
            continue
        conditions.append(WatchCondition(
            category=sig["name"].lower().replace("/", "_").replace(" ", "_"),
            condition=meta["condition"],
            current_state=sig["detail"] if sig["detail"] != "unavailable" else "Data not available",
            importance=meta["importance"],
        ))

    if iv_rank is not None and iv_rank < 40 and direction in ("BUY", "NEUTRAL"):
        conditions.append(WatchCondition(
            category="iv",
            condition=f"For premium selling: wait for IV Rank to reach 40%+ (currently {iv_rank:.0f}%). Sell covered calls or CSPs when IV is elevated.",
            current_state=f"IV Rank {iv_rank:.0f}% — too low to sell premium attractively",
            importance="HELPFUL",
        ))

    if days_to_earnings is not None:
        if days_to_earnings <= 7:
            conditions.append(WatchCondition(
                category="earnings",
                condition=f"Earnings in {days_to_earnings} day(s) — avoid entering new positions. Wait until after the report.",
                current_state=f"Earnings in {days_to_earnings} days (VERY SOON)",
                importance="CRITICAL",
            ))
        elif days_to_earnings <= 21:
            conditions.append(WatchCondition(
                category="earnings",
                condition=f"Earnings in {days_to_earnings} days — options premium is inflated (IV crush risk). Consider waiting until after the report.",
                current_state=f"Earnings in {days_to_earnings} days",
                importance="HELPFUL",
            ))

    return conditions


# ── Opportunity scanner ───────────────────────────────────────────────────────

_PROJECTED_TRADE = {
    "BUY":  "Sell Cash-Secured Put or Buy Call",
    "SELL": "Buy Put Option",
}

async def get_opportunities() -> list[OpportunityItem]:
    """
    Read conviction_cache and return stocks close to a HIGH CONVICTION setup.
    Excludes stocks already at HIGH_CONVICTION and NEUTRAL stocks.
    Sorted by opportunity_score (closest to threshold first).
    """
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(ConvictionCache).where(
                ConvictionCache.direction.in_(["BUY", "SELL"]),
                ConvictionCache.label.in_(["MODERATE", "WEAK"]),
                ConvictionCache.asset_type != "crypto",
            )
        )
        rows = result.scalars().all()

    items: list[OpportunityItem] = []
    for row in rows:
        try:
            signals = json.loads(row.signals_json or "[]")
            if not signals:
                continue

            total = len(signals)
            passing = sum(1 for s in signals if s.get("passed"))
            failing = [s for s in signals if not s.get("passed")]

            # HIGH_CONVICTION threshold: 78% of signals passing
            hc_threshold = max(1, round(total * 0.78))
            needed = max(0, hc_threshold - passing)

            # Top failing signals to watch (CRITICAL first, then others, max 3)
            def _importance(sig_name: str) -> int:
                meta = _WATCH_MAP.get(sig_name, {})
                return 0 if meta.get("importance") == "CRITICAL" else 1

            top_failing = sorted(failing, key=lambda s: _importance(s["name"]))[:3]
            missing_names = [s["name"] for s in top_failing]

            # Plain English watch summary
            if needed == 0:
                watch_summary = "Very close to HIGH CONVICTION — monitor for final signal flip"
            elif needed == 1:
                watch_summary = f"One signal away — watch: {missing_names[0] if missing_names else 'remaining signal'}"
            elif needed == 2:
                watch_summary = f"Two signals needed: {', '.join(missing_names[:2])}"
            else:
                watch_summary = f"Needs {needed} more signals. Key: {', '.join(missing_names[:2])}"

            # Opportunity score: higher = closer to HIGH CONVICTION
            opp_score = passing / total if total > 0 else 0.0

            items.append(OpportunityItem(
                symbol=row.symbol,
                direction=row.direction,
                label=row.label,
                score=row.score,
                max_score=row.max_score,
                confidence_pct=round(row.score / row.max_score * 100, 1) if row.max_score else 0.0,
                signals_passing=passing,
                signals_needed_for_high=needed,
                missing_signal_names=missing_names,
                watch_summary=watch_summary,
                projected_trade=_PROJECTED_TRADE.get(row.direction, "Watch and wait"),
                opportunity_score=round(opp_score, 4),
            ))
        except Exception as e:
            logger.debug(f"[{row.symbol}] opportunity build failed: {e}")

    items.sort(key=lambda x: x.opportunity_score, reverse=True)
    return items[:20]


# ── Full stock analyzer ───────────────────────────────────────────────────────

async def analyze_stock(symbol: str, asset_type: str = "stock") -> StockPlaybook:
    """
    Run a full live analysis on any symbol and return a complete trade playbook.
    Takes ~5-10 seconds (live conviction + options scan + IV environment).
    """
    sym = symbol.upper()
    is_stock = asset_type == "stock"

    # Parallel: conviction + IV environment + earnings date
    conviction_task = compute_conviction(sym, asset_type)
    iv_task = asyncio.to_thread(get_iv_environment, sym) if is_stock else asyncio.sleep(0)
    earnings_task = asyncio.to_thread(_next_earnings, sym) if is_stock else asyncio.sleep(0)

    conviction_result, iv_result, earnings_result = await asyncio.gather(
        conviction_task, iv_task, earnings_task, return_exceptions=True
    )

    if isinstance(conviction_result, Exception):
        raise conviction_result

    if isinstance(iv_result, Exception) or not is_stock:
        iv_result = None
    if isinstance(earnings_result, Exception) or not is_stock:
        earnings_result = (None, None)

    earnings_date, days_to_earnings = earnings_result if isinstance(earnings_result, tuple) else (None, None)

    # Extract conviction data
    direction = conviction_result.direction
    iv_rank = iv_result.iv_rank if iv_result else 50.0
    current_iv = iv_result.current_iv_pct if iv_result else None
    iv_rec = iv_result.recommendation if iv_result else None

    # Stock price + ATR-based trade levels
    stock_price = 0.0
    entry_price = take_profit = stop_loss = risk_reward = 0.0
    try:
        import yfinance as yf
        import pandas_ta as ta_lib
        hist = yf.Ticker(sym).history(period="30d")
        if not hist.empty:
            stock_price = round(float(hist["Close"].iloc[-1]), 4)
            atr_s = ta_lib.atr(hist["High"], hist["Low"], hist["Close"], length=14)
            atr = float(atr_s.dropna().iloc[-1]) if atr_s is not None and not atr_s.dropna().empty else stock_price * 0.015
            entry_price = stock_price
            if direction == "BUY":
                take_profit = round(stock_price + 1.5 * atr, 4)
                stop_loss   = round(stock_price - 1.0 * atr, 4)
            elif direction == "SELL":
                take_profit = round(stock_price - 1.5 * atr, 4)
                stop_loss   = round(stock_price + 1.0 * atr, 4)
            else:
                take_profit = stop_loss = stock_price
            risk_reward = (
                round(abs(take_profit - stock_price) / abs(stock_price - stop_loss), 2)
                if stop_loss != stock_price else 0.0
            )
    except Exception:
        pass

    # Options scans (parallel, stocks only)
    csp_opps, buy_opps = [], []
    if is_stock:
        csp_task = asyncio.to_thread(scan_cash_secured_puts, sym, conviction_result.label)
        buy_direction = direction if direction in ("BUY", "SELL") else "BUY"
        buy_task = asyncio.to_thread(
            scan_options_to_buy, sym, buy_direction, conviction_result.label
        )
        csp_raw, buy_raw = await asyncio.gather(csp_task, buy_task, return_exceptions=True)
        if not isinstance(csp_raw, Exception):
            csp_opps = csp_raw
        if not isinstance(buy_raw, Exception):
            buy_opps = buy_raw

    # Build playbook components
    recommendations = _build_recommendations(
        direction, iv_rank, csp_opps, buy_opps, days_to_earnings
    )
    watch_conditions = _build_watch_conditions(
        conviction_result.signals, direction, iv_rank, days_to_earnings
    )

    # Risk flags
    risk_flags: list[str] = []
    if days_to_earnings is not None and days_to_earnings <= 14:
        risk_flags.append(f"Earnings in {days_to_earnings} days — high IV crush risk")
    for sig in conviction_result.signals:
        if sig["name"] == "Debt/Equity" and not sig["passed"] and "high leverage" in sig.get("detail", ""):
            risk_flags.append(f"High debt: {sig['detail']}")
        if sig["name"] == "FCF Yield" and not sig["passed"] and "negative" in sig.get("detail", ""):
            risk_flags.append(f"Negative FCF: {sig['detail']}")
        if sig["name"] == "P/E Valuation" and not sig["passed"] and ">" in sig.get("detail", ""):
            risk_flags.append(f"Elevated valuation: {sig['detail']}")

    return StockPlaybook(
        symbol=sym,
        asset_type=asset_type,
        stock_price=stock_price,
        direction=direction,
        label=conviction_result.label,
        score=conviction_result.score,
        max_score=conviction_result.max_score,
        confidence_pct=conviction_result.confidence_pct,
        signals=conviction_result.signals,
        iv_rank=iv_rank if iv_result else None,
        current_iv_pct=current_iv,
        iv_recommendation=iv_rec,
        next_earnings_date=earnings_date,
        days_to_earnings=days_to_earnings,
        recommendations=recommendations,
        watch_conditions=watch_conditions,
        risk_flags=risk_flags,
        entry_price=entry_price,
        take_profit=take_profit,
        stop_loss=stop_loss,
        risk_reward=risk_reward,
    )
