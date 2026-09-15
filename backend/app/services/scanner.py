"""
Scanner: runs technical analysis across a pre-populated list of symbols
and returns ranked BUY / SELL / HOLD recommendations.
"""
import asyncio
import logging
from dataclasses import dataclass, field

import pandas_ta as ta_lib

from app.services.market_data import market_data_service
from app.services.technical import technical_analysis

logger = logging.getLogger("scanner")

# ──────────────────────────────────────────────────────────────────────────────
# Default universe — top US stocks + major crypto
# Users can add their own symbols via the watchlist
# ──────────────────────────────────────────────────────────────────────────────
DEFAULT_STOCKS = [
    # ── Mega-cap tech ──────────────────────────────────────────────────────────
    ("AAPL",  "Apple"),
    ("MSFT",  "Microsoft"),
    ("NVDA",  "NVIDIA"),
    ("GOOGL", "Alphabet"),
    ("AMZN",  "Amazon"),
    ("META",  "Meta"),
    ("TSLA",  "Tesla"),
    # ── Semiconductors ─────────────────────────────────────────────────────────
    ("AMD",   "AMD"),
    ("INTC",  "Intel"),
    ("MU",    "Micron"),
    ("QCOM",  "Qualcomm"),
    ("TSM",   "Taiwan Semi"),
    ("ARM",   "Arm Holdings"),
    ("AMAT",  "Applied Materials"),
    ("LRCX",  "Lam Research"),
    ("MRVL",  "Marvell Technology"),
    ("KLAC",  "KLA Corp"),
    # ── Enterprise software / cloud ────────────────────────────────────────────
    ("CRM",   "Salesforce"),
    ("ORCL",  "Oracle"),
    ("PLTR",  "Palantir"),
    ("SNOW",  "Snowflake"),
    ("NET",   "Cloudflare"),
    ("ADBE",  "Adobe"),
    ("NOW",   "ServiceNow"),
    ("INTU",  "Intuit"),
    ("WDAY",  "Workday"),
    # ── Cybersecurity ─────────────────────────────────────────────────────────
    ("CRWD",  "CrowdStrike"),
    ("DDOG",  "Datadog"),
    ("ZS",    "Zscaler"),
    # ── Financials ─────────────────────────────────────────────────────────────
    ("JPM",   "JPMorgan"),
    ("BAC",   "Bank of America"),
    ("GS",    "Goldman Sachs"),
    ("MS",    "Morgan Stanley"),
    ("V",     "Visa"),
    ("MA",    "Mastercard"),
    ("PYPL",  "PayPal"),
    ("COIN",  "Coinbase"),
    ("AXP",   "American Express"),
    ("C",     "Citigroup"),
    ("WFC",   "Wells Fargo"),
    ("SCHW",  "Charles Schwab"),
    ("BLK",   "BlackRock"),
    ("SQ",    "Block"),
    # ── Healthcare / pharma ────────────────────────────────────────────────────
    ("LLY",   "Eli Lilly"),
    ("JNJ",   "Johnson & Johnson"),
    ("PFE",   "Pfizer"),
    ("UNH",   "UnitedHealth"),
    ("ABBV",  "AbbVie"),
    ("AMGN",  "Amgen"),
    ("MRK",   "Merck"),
    ("BMY",   "Bristol-Myers"),
    ("CVS",   "CVS Health"),
    ("MDT",   "Medtronic"),
    # ── Consumer / retail ──────────────────────────────────────────────────────
    ("WMT",   "Walmart"),
    ("COST",  "Costco"),
    ("HD",    "Home Depot"),
    ("LOW",   "Lowe's"),
    ("TGT",   "Target"),
    ("NKE",   "Nike"),
    ("NFLX",  "Netflix"),
    ("DIS",   "Disney"),
    ("MCD",   "McDonald's"),
    ("SBUX",  "Starbucks"),
    ("KO",    "Coca-Cola"),
    ("PEP",   "PepsiCo"),
    ("PG",    "Procter & Gamble"),
    ("ABNB",  "Airbnb"),
    ("SHOP",  "Shopify"),
    # ── Energy ────────────────────────────────────────────────────────────────
    ("XOM",   "ExxonMobil"),
    ("CVX",   "Chevron"),
    # ── Industrials / defence ─────────────────────────────────────────────────
    ("BRK-B", "Berkshire"),
    ("BA",    "Boeing"),
    ("CAT",   "Caterpillar"),
    ("DE",    "Deere"),
    ("HON",   "Honeywell"),
    ("LMT",   "Lockheed Martin"),
    ("RTX",   "RTX Corp"),
    ("GE",    "GE Aerospace"),
    ("F",     "Ford"),
    ("GM",    "General Motors"),
    ("UBER",  "Uber"),
    # ── Telecom ───────────────────────────────────────────────────────────────
    ("T",     "AT&T"),
    ("VZ",    "Verizon"),
    # ── Real estate / utilities ───────────────────────────────────────────────
    ("AMT",   "American Tower"),
    ("NEE",   "NextEra Energy"),
    # ── Cybersecurity / fintech growth ────────────────────────────────────────
    ("PANW",  "Palo Alto Networks"),
    ("HOOD",  "Robinhood"),
    ("SOFI",  "SoFi Technologies"),
    ("RBLX",  "Roblox"),
    ("SPOT",  "Spotify"),
    # ── Broad market ETFs (highly liquid options) ─────────────────────────────
    ("SPY",   "S&P 500 ETF"),
    ("QQQ",   "Nasdaq 100 ETF"),
    ("IWM",   "Russell 2000 ETF"),
]

DEFAULT_CRYPTO = [
    ("BTC-USD",  "Bitcoin"),
    ("ETH-USD",  "Ethereum"),
    ("SOL-USD",  "Solana"),
    ("BNB-USD",  "BNB"),
    ("XRP-USD",  "XRP"),
    ("ADA-USD",  "Cardano"),
    ("DOGE-USD", "Dogecoin"),
    ("AVAX-USD", "Avalanche"),
    ("DOT-USD",  "Polkadot"),
    ("LINK-USD", "Chainlink"),
]

# Score weights: BUY=+1, SELL=-1, HOLD=0
SCORE_MAP = {"BUY": 1, "SELL": -1, "HOLD": 0}

RECOMMENDATION_LABELS = {
    (4, 4):   "STRONG BUY",
    (3, 4):   "BUY",
    (2, 4):   "WEAK BUY",
    (-1, 4):  "HOLD",
    (-2, 4):  "WEAK SELL",
    (-3, 4):  "SELL",
    (-4, 4):  "STRONG SELL",
}


def _score_to_label(buy_count: int, sell_count: int, hold_count: int, total: int) -> str:
    net = buy_count - sell_count
    if net >= 3:
        return "STRONG BUY"
    elif net == 2:
        return "BUY"
    elif net == 1:
        return "WEAK BUY"
    elif net == -1:
        return "WEAK SELL"
    elif net == -2:
        return "SELL"
    elif net <= -3:
        return "STRONG SELL"
    return "HOLD"


@dataclass
class ScanResult:
    symbol: str
    name: str
    asset_type: str
    price: float
    change_pct: float
    recommendation: str       # STRONG BUY | BUY | WEAK BUY | HOLD | WEAK SELL | SELL | STRONG SELL
    confidence_pct: float
    buy_count: int
    sell_count: int
    hold_count: int
    top_reason: str           # Most important indicator detail
    indicators: list = field(default_factory=list)
    error: str = ""
    entry_price: float = 0.0
    take_profit: float = 0.0
    stop_loss: float = 0.0
    risk_reward: float = 0.0
    expected_gain_pct: float = 0.0


class MarketScanner:
    async def scan_symbol(
        self, symbol: str, name: str, asset_type: str
    ) -> ScanResult:
        try:
            # ONE yfinance call — derives price/change from history, no extra quote fetch
            df, price, change_pct = await market_data_service.get_scan_data(symbol, asset_type)
            result = technical_analysis.compute_all(df, symbol, asset_type)

            recommendation = _score_to_label(
                result.buy_count, result.sell_count, result.hold_count,
                len(result.indicators)
            )

            # Top reason = indicator with strongest non-HOLD signal
            top_ind = next(
                (i for i in result.indicators if i.signal != "HOLD"),
                result.indicators[0] if result.indicators else None
            )
            top_reason = top_ind.detail if top_ind else "Insufficient data"

            # ATR-based trade levels ──────────────────────────────────────
            atr_s = ta_lib.atr(df["high"], df["low"], df["close"], length=14)
            atr = float(atr_s.iloc[-1]) if atr_s is not None and not atr_s.empty else price * 0.015

            if recommendation in ("STRONG BUY", "BUY", "WEAK BUY"):
                take_profit = round(price + 1.5 * atr, 4)
                stop_loss   = round(price - 1.0 * atr, 4)
            elif recommendation in ("STRONG SELL", "SELL", "WEAK SELL"):
                take_profit = round(price - 1.5 * atr, 4)
                stop_loss   = round(price + 1.0 * atr, 4)
            else:
                take_profit = stop_loss = price

            risk_reward = (
                round(abs(take_profit - price) / abs(price - stop_loss), 2)
                if price != stop_loss else 0.0
            )
            expected_gain_pct = round(abs(take_profit - price) / price * 100, 2) if price else 0.0

            return ScanResult(
                symbol=symbol,
                name=name,
                asset_type=asset_type,
                price=price,
                change_pct=change_pct,
                recommendation=recommendation,
                confidence_pct=result.confidence_pct,
                buy_count=result.buy_count,
                sell_count=result.sell_count,
                hold_count=result.hold_count,
                top_reason=top_reason,
                indicators=[
                    {"name": i.name, "signal": i.signal, "detail": i.detail}
                    for i in result.indicators
                ],
                entry_price=round(price, 4),
                take_profit=take_profit,
                stop_loss=stop_loss,
                risk_reward=risk_reward,
                expected_gain_pct=expected_gain_pct,
            )
        except Exception as e:
            logger.warning(f"Scan failed for {symbol}: {e}")
            return ScanResult(
                symbol=symbol, name=name, asset_type=asset_type,
                price=0, change_pct=0, recommendation="HOLD",
                confidence_pct=0, buy_count=0, sell_count=0, hold_count=0,
                top_reason="", error=str(e),
            )

    async def scan_all(
        self,
        extra_symbols: list[tuple[str, str, str]] | None = None,
        include_crypto: bool = True,
        concurrency: int = 5,
    ) -> list[ScanResult]:
        """
        Scan all default symbols + any extra ones.
        extra_symbols: list of (symbol, name, asset_type)
        Returns sorted: STRONG BUY first, STRONG SELL last.
        """
        tasks_args = []
        for sym, name in DEFAULT_STOCKS:
            tasks_args.append((sym, name, "stock"))
        if include_crypto:
            for sym, name in DEFAULT_CRYPTO:
                tasks_args.append((sym, name, "crypto"))
        if extra_symbols:
            tasks_args.extend(extra_symbols)

        # Remove duplicates
        seen = set()
        unique = []
        for t in tasks_args:
            if t[0] not in seen:
                seen.add(t[0])
                unique.append(t)

        # Batch scan: 5 concurrent, small delay between batches
        results = []
        batch_size = 5
        for i in range(0, len(unique), batch_size):
            batch = unique[i:i + batch_size]
            batch_results = await asyncio.gather(
                *[self.scan_symbol(sym, name, atype) for sym, name, atype in batch]
            )
            results.extend(batch_results)
            if i + batch_size < len(unique):
                await asyncio.sleep(1.0)  # pause between batches

        # Filter out hard errors, sort by recommendation strength
        order = ["STRONG BUY", "BUY", "WEAK BUY", "HOLD", "WEAK SELL", "SELL", "STRONG SELL"]
        valid = [r for r in results if not r.error]
        failed = [r for r in results if r.error]

        valid.sort(key=lambda r: (order.index(r.recommendation), -r.confidence_pct))
        return valid + failed


market_scanner = MarketScanner()
