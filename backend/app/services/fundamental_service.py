"""
Fundamental Analysis Service

Fetches key fundamental metrics from yfinance for stocks.
Results cached 6 hours per symbol — fundamentals change slowly.

Metrics:
  Valuation   — trailing P/E, forward P/E, P/B, EV/EBITDA, FCF yield
  Growth      — revenue YoY, EPS YoY, gross/operating/net margins
  Balance     — debt/equity, current ratio
  Quality     — ROE, ROA
  Consensus   — analyst buy/hold/sell counts, mean price target, upside %

Health Score (0–6) and direction (BUY / SELL / NEUTRAL):
  Each of 6 criteria adds 1 point:
    1. Revenue growth YoY > 10%
    2. EPS growth YoY    > 10%
    3. ROE               > 15%
    4. Debt/Equity       < 1.5  (or not applicable)
    5. Free Cash Flow    > 0
    6. Analyst consensus majority BUY

  5–6 → STRONG  → BUY
  3–4 → MODERATE → NEUTRAL
  0–2 → WEAK    → SELL
"""
import logging
import time

import yfinance as yf
from dataclasses import dataclass, field

logger = logging.getLogger("fundamental_service")

_CACHE: dict[str, tuple[float, object]] = {}
_CACHE_TTL = 6 * 3600  # 6 hours


@dataclass
class AnalystConsensus:
    buy_count:    int | None = None
    hold_count:   int | None = None
    sell_count:   int | None = None
    total_count:  int | None = None
    target_mean:  float | None = None
    target_high:  float | None = None
    target_low:   float | None = None
    upside_pct:   float | None = None
    recommendation: str = "N/A"


@dataclass
class FundamentalData:
    symbol: str

    # ── Valuation ─────────────────────────────────────────────────────────────
    pe_ratio:      float | None = None
    forward_pe:    float | None = None
    pb_ratio:      float | None = None
    ev_ebitda:     float | None = None
    fcf_yield_pct: float | None = None   # FCF / market_cap × 100

    # ── Growth ────────────────────────────────────────────────────────────────
    revenue_growth_yoy: float | None = None   # e.g. 22.5 = 22.5%
    eps_growth_yoy:     float | None = None
    gross_margin:       float | None = None
    operating_margin:   float | None = None
    net_margin:         float | None = None

    # ── Balance sheet ─────────────────────────────────────────────────────────
    debt_to_equity: float | None = None
    current_ratio:  float | None = None

    # ── Quality / profitability ───────────────────────────────────────────────
    roe: float | None = None   # e.g. 12.5 = 12.5%
    roa: float | None = None

    # ── Analyst consensus ─────────────────────────────────────────────────────
    consensus: AnalystConsensus = field(default_factory=AnalystConsensus)

    # ── Health assessment ─────────────────────────────────────────────────────
    health_score:     int = 0          # 0–6
    health_label:     str = "UNKNOWN"  # STRONG / MODERATE / WEAK / UNKNOWN
    health_direction: str = "NEUTRAL"  # BUY / SELL / NEUTRAL

    # ── Score breakdown (which criteria passed) ───────────────────────────────
    criteria: dict = field(default_factory=dict)


def _safe(info: dict, key: str, scale: float = 1.0) -> float | None:
    """Extract a numeric field from info dict, return None if missing/invalid."""
    v = info.get(key)
    if v is None or not isinstance(v, (int, float)):
        return None
    try:
        result = float(v) * scale
        if result != result:   # NaN check
            return None
        return result
    except (TypeError, ValueError):
        return None


def _recommendation_label(key: str | None) -> str:
    mapping = {
        "strong_buy":  "Strong Buy",
        "buy":         "Buy",
        "hold":        "Hold",
        "underperform": "Underperform",
        "sell":        "Sell",
    }
    return mapping.get((key or "").lower(), "N/A")


def _analyst_consensus(ticker: yf.Ticker, current_price: float | None, info: dict) -> AnalystConsensus:
    c = AnalystConsensus()

    # Try recommendations_summary (DataFrame with strongBuy/buy/hold/sell/strongSell)
    try:
        df = ticker.recommendations_summary
        if df is not None and not df.empty:
            latest = df[df["period"] == "0m"]
            if latest.empty:
                latest = df.iloc[[0]]
            row = latest.iloc[0]
            c.buy_count  = int(row.get("strongBuy", 0)) + int(row.get("buy", 0))
            c.hold_count = int(row.get("hold", 0))
            c.sell_count = int(row.get("sell", 0)) + int(row.get("strongSell", 0))
            c.total_count = c.buy_count + c.hold_count + c.sell_count
    except Exception:
        pass

    # Fallback: use numberOfAnalystOpinions from info
    if c.total_count is None:
        n = _safe(info, "numberOfAnalystOpinions")
        if n is not None:
            c.total_count = int(n)

    # Price targets
    c.target_mean = _safe(info, "targetMeanPrice")
    c.target_high = _safe(info, "targetHighPrice")
    c.target_low  = _safe(info, "targetLowPrice")
    c.recommendation = _recommendation_label(info.get("recommendationKey"))

    if c.target_mean and current_price and current_price > 0:
        c.upside_pct = round((c.target_mean - current_price) / current_price * 100, 1)

    return c


def _health_score(data: FundamentalData) -> tuple[int, dict]:
    """
    Returns (score 0–6, criteria_dict).
    Each criterion is True/False/None (None = data unavailable, skipped).
    """
    criteria = {}

    # 1. Revenue growth > 10%
    if data.revenue_growth_yoy is not None:
        criteria["revenue_growth"] = data.revenue_growth_yoy > 10.0
    else:
        criteria["revenue_growth"] = None

    # 2. EPS growth > 10%
    if data.eps_growth_yoy is not None:
        criteria["eps_growth"] = data.eps_growth_yoy > 10.0
    else:
        criteria["eps_growth"] = None

    # 3. ROE > 15%
    if data.roe is not None:
        criteria["roe_quality"] = data.roe > 15.0
    else:
        criteria["roe_quality"] = None

    # 4. Debt/Equity < 1.5
    if data.debt_to_equity is not None:
        criteria["low_debt"] = data.debt_to_equity < 1.5
    else:
        criteria["low_debt"] = None

    # 5. FCF yield > 0 (positive free cash flow)
    if data.fcf_yield_pct is not None:
        criteria["positive_fcf"] = data.fcf_yield_pct > 0.0
    else:
        criteria["positive_fcf"] = None

    # 6. Analyst majority BUY
    c = data.consensus
    if c.buy_count is not None and c.total_count and c.total_count > 0:
        criteria["analyst_buy"] = c.buy_count > (c.total_count / 2)
    elif c.recommendation in ("Strong Buy", "Buy"):
        criteria["analyst_buy"] = True
    elif c.recommendation in ("Sell", "Underperform"):
        criteria["analyst_buy"] = False
    else:
        criteria["analyst_buy"] = None

    score = sum(1 for v in criteria.values() if v is True)
    return score, criteria


def get_fundamentals(symbol: str, current_price: float | None = None) -> FundamentalData:
    """
    Fetch fundamental metrics for a stock symbol.
    Results cached 6 hours. Returns FundamentalData with health_direction set.
    Raises ValueError for crypto or unsupported symbols.
    """
    sym_upper = symbol.upper()
    if sym_upper.endswith(("-USD", "-USDT")):
        raise ValueError(f"{symbol} is crypto — fundamentals not applicable")

    # Cache hit
    if sym_upper in _CACHE:
        ts, cached = _CACHE[sym_upper]
        if time.time() - ts < _CACHE_TTL:
            # Update upside if we have a fresher price
            if current_price and cached.consensus.target_mean:
                cached.consensus.upside_pct = round(
                    (cached.consensus.target_mean - current_price) / current_price * 100, 1
                )
            return cached

    logger.info(f"[fundamentals] Fetching {sym_upper}")
    ticker = yf.Ticker(sym_upper)
    info   = ticker.info or {}

    mktcap  = _safe(info, "marketCap")
    fcf_raw = _safe(info, "freeCashflow")

    data = FundamentalData(symbol=sym_upper)

    # Valuation
    data.pe_ratio   = _safe(info, "trailingPE")
    data.forward_pe = _safe(info, "forwardPE")
    data.pb_ratio   = _safe(info, "priceToBook")
    data.ev_ebitda  = _safe(info, "enterpriseToEbitda")
    if fcf_raw is not None and mktcap and mktcap > 0:
        data.fcf_yield_pct = round(fcf_raw / mktcap * 100, 2)

    # Growth (yfinance returns decimals, convert to pct)
    rg = _safe(info, "revenueGrowth")
    eg = _safe(info, "earningsGrowth")
    data.revenue_growth_yoy = round(rg * 100, 1) if rg is not None else None
    data.eps_growth_yoy     = round(eg * 100, 1) if eg is not None else None

    # Margins (decimal → pct)
    gm = _safe(info, "grossMargins")
    om = _safe(info, "operatingMargins")
    nm = _safe(info, "profitMargins")
    data.gross_margin     = round(gm * 100, 1) if gm is not None else None
    data.operating_margin = round(om * 100, 1) if om is not None else None
    data.net_margin       = round(nm * 100, 1) if nm is not None else None

    # Balance sheet
    data.debt_to_equity = _safe(info, "debtToEquity")
    data.current_ratio  = _safe(info, "currentRatio")
    if data.debt_to_equity is not None:
        data.debt_to_equity = round(data.debt_to_equity / 100, 2)  # yfinance returns as %, normalise

    # Profitability
    roe = _safe(info, "returnOnEquity")
    roa = _safe(info, "returnOnAssets")
    data.roe = round(roe * 100, 1) if roe is not None else None
    data.roa = round(roa * 100, 1) if roa is not None else None

    # Analyst consensus
    px = current_price or _safe(info, "currentPrice") or _safe(info, "regularMarketPrice")
    data.consensus = _analyst_consensus(ticker, px, info)

    # Health score
    data.health_score, data.criteria = _health_score(data)
    if data.health_score >= 5:
        data.health_label     = "STRONG"
        data.health_direction = "BUY"
    elif data.health_score >= 3:
        data.health_label     = "MODERATE"
        data.health_direction = "NEUTRAL"
    else:
        data.health_label     = "WEAK"
        data.health_direction = "SELL"

    _CACHE[sym_upper] = (time.time(), data)
    logger.info(f"[fundamentals] {sym_upper} — score {data.health_score}/6 ({data.health_label})")
    return data
