"""
Covered Call & Cash-Secured Put Scanner

Premium-selling strategies for income generation:
  scan_covered_calls()     → OTM calls to SELL against shares you own
  scan_cash_secured_puts() → OTM puts to SELL on conviction BUY stocks
  get_iv_environment()     → IV Rank + sell/buy recommendation per symbol

IV Rank is computed using 30-day rolling Historical Volatility as a proxy
for the 52-week IV range — avoids expensive historical options chain fetches.
"""
import logging
import math
import time
from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd
import yfinance as yf
from scipy.stats import norm

logger = logging.getLogger("covered_call_service")

_chain_cache: dict[str, tuple[float, dict]] = {}
_iv_cache: dict[str, tuple[float, object]] = {}
_CACHE_TTL = 30 * 60
_RISK_FREE = 0.045
_DTE_MIN = 21
_DTE_MAX = 45
_CC_DELTA_MIN, _CC_DELTA_MAX = 0.15, 0.35
_CSP_DELTA_MIN, _CSP_DELTA_MAX = 0.15, 0.35


@dataclass
class CoveredCallOpp:
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


@dataclass
class CSPOpp:
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


@dataclass
class IVEnvironment:
    symbol: str
    current_iv_pct: float
    iv_rank: float
    hv_30d_pct: float
    iv_hv_spread: float
    recommendation: str   # SELL_PREMIUM | BUY_OPTIONS | NEUTRAL
    rec_reason: str


# ── Black-Scholes Greeks ──────────────────────────────────────────────────────

def _bs_delta(S: float, K: float, T: float, sigma: float,
              r: float = _RISK_FREE, option_type: str = "call") -> float:
    if T <= 0 or sigma <= 0:
        return 0.0
    try:
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        return float(norm.cdf(d1) if option_type == "call" else norm.cdf(d1) - 1)
    except Exception:
        return 0.0


def _bs_theta(S: float, K: float, T: float, sigma: float,
              r: float = _RISK_FREE, option_type: str = "call") -> float:
    """Daily theta per share (negative = time decay cost for option buyer)."""
    if T <= 0 or sigma <= 0:
        return 0.0
    try:
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)
        annual = -(S * sigma * norm.pdf(d1)) / (2 * math.sqrt(T))
        if option_type == "call":
            annual -= r * K * math.exp(-r * T) * norm.cdf(d2)
        else:
            annual += r * K * math.exp(-r * T) * norm.cdf(-d2)
        return float(annual / 365)
    except Exception:
        return 0.0


# ── Shared chain fetcher ──────────────────────────────────────────────────────

def _fetch_chain(symbol: str) -> dict | None:
    """
    Fetch options chain for DTE_MIN–DTE_MAX window. Cached 30 min.
    Returns {"price": float, "chains": {exp_str: (calls_df, puts_df, dte)}}
    """
    sym = symbol.upper()
    cached = _chain_cache.get(sym)
    if cached and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]

    try:
        ticker = yf.Ticker(sym)
        hist = ticker.history(period="2d")
        if hist.empty:
            return None
        S = float(hist["Close"].iloc[-1])

        expirations = ticker.options
        if not expirations:
            return None

        today = date.today()
        chains: dict[str, tuple] = {}
        for exp_str in expirations:
            try:
                dte = (date.fromisoformat(exp_str) - today).days
                if not (_DTE_MIN <= dte <= _DTE_MAX):
                    continue
                chain = ticker.option_chain(exp_str)
                chains[exp_str] = (chain.calls.copy(), chain.puts.copy(), dte)
                if len(chains) >= 2:
                    break
            except Exception:
                continue

        result = {"price": S, "chains": chains}
        _chain_cache[sym] = (time.time(), result)
        return result

    except Exception as e:
        logger.warning(f"[{sym}] chain fetch failed: {e}")
        return None


# ── Covered Calls ─────────────────────────────────────────────────────────────

def scan_covered_calls(
    symbol: str,
    shares_owned: float,
    avg_cost: float,
) -> list[CoveredCallOpp]:
    """
    Find best OTM calls to SELL against shares you already own.
    Requires at least 100 shares (1 contract = 100 shares).
    Target delta 0.15–0.35: enough premium, manageable assignment risk.
    """
    sym = symbol.upper()
    if sym.endswith("-USD") or sym.endswith("-USDT"):
        return []
    contracts_available = int(shares_owned // 100)
    if contracts_available < 1:
        return []

    chain_data = _fetch_chain(sym)
    if not chain_data:
        return []

    S = chain_data["price"]
    results: list[CoveredCallOpp] = []

    for exp_str, (calls_df, _, dte) in chain_data["chains"].items():
        T = dte / 365.0
        df = calls_df[
            (calls_df["strike"] > S * 1.005) &
            (calls_df["bid"] > 0.05) &
            (calls_df["openInterest"].fillna(0) >= 50)
        ].copy()
        if df.empty:
            continue

        for _, row in df.iterrows():
            K = float(row["strike"])
            bid = float(row["bid"])
            ask = float(row["ask"])
            oi = int(row["openInterest"]) if pd.notna(row["openInterest"]) else 0
            vol = int(row["volume"]) if pd.notna(row["volume"]) else 0
            iv = float(row["impliedVolatility"]) if pd.notna(row["impliedVolatility"]) else 0.0
            if iv <= 0:
                continue

            delta = _bs_delta(S, K, T, iv, option_type="call")
            if not (_CC_DELTA_MIN <= delta <= _CC_DELTA_MAX):
                continue

            theta = _bs_theta(S, K, T, iv, option_type="call") * 100
            prem_contract = round(bid * 100, 2)
            ann_yield = (bid / K) * (365 / dte) * 100
            score = (
                ann_yield * 0.5
                + min(1.0, oi / 500) * 10 * 0.3
                + max(0.0, 1 - abs(delta - 0.25) / 0.25) * 10 * 0.2
            )

            results.append(CoveredCallOpp(
                symbol=sym,
                stock_price=round(S, 4),
                shares_owned=shares_owned,
                avg_cost=round(avg_cost, 4),
                contracts_available=contracts_available,
                expiration=exp_str,
                dte=dte,
                strike=round(K, 2),
                bid=round(bid, 4),
                ask=round(ask, 4),
                premium_per_contract=prem_contract,
                total_premium=round(prem_contract * contracts_available, 2),
                delta=round(delta, 4),
                theta_per_day=round(theta, 4),
                iv_pct=round(iv * 100, 2),
                annualized_yield_pct=round(ann_yield, 2),
                return_on_stock_pct=round((bid / S) * 100, 2),
                new_cost_basis=round(avg_cost - bid, 4),
                upside_to_strike_pct=round((K - S) / S * 100, 2),
                max_profit_if_called=round((K - avg_cost + bid) * contracts_available * 100, 2),
                open_interest=oi,
                volume=vol,
                score=round(score, 4),
            ))

    results.sort(key=lambda x: x.score, reverse=True)
    return results[:2]


# ── Cash-Secured Puts ─────────────────────────────────────────────────────────

def scan_cash_secured_puts(
    symbol: str,
    conviction: str,
) -> list[CSPOpp]:
    """
    Find OTM puts to SELL on conviction BUY stocks.
    You collect premium upfront. If assigned, you buy 100 shares at strike
    (effective cost = strike - premium received).
    Target delta -0.15 to -0.35: enough premium, acceptable assignment risk.
    """
    sym = symbol.upper()
    if sym.endswith("-USD") or sym.endswith("-USDT"):
        return []

    chain_data = _fetch_chain(sym)
    if not chain_data:
        return []

    S = chain_data["price"]
    results: list[CSPOpp] = []

    for exp_str, (_, puts_df, dte) in chain_data["chains"].items():
        T = dte / 365.0
        df = puts_df[
            (puts_df["strike"] < S * 0.995) &
            (puts_df["bid"] > 0.05) &
            (puts_df["openInterest"].fillna(0) >= 50)
        ].copy()
        if df.empty:
            continue

        for _, row in df.iterrows():
            K = float(row["strike"])
            bid = float(row["bid"])
            ask = float(row["ask"])
            oi = int(row["openInterest"]) if pd.notna(row["openInterest"]) else 0
            vol = int(row["volume"]) if pd.notna(row["volume"]) else 0
            iv = float(row["impliedVolatility"]) if pd.notna(row["impliedVolatility"]) else 0.0
            if iv <= 0:
                continue

            delta = _bs_delta(S, K, T, iv, option_type="put")
            abs_delta = abs(delta)
            if not (_CSP_DELTA_MIN <= abs_delta <= _CSP_DELTA_MAX):
                continue

            theta = _bs_theta(S, K, T, iv, option_type="put") * 100
            prem_contract = round(bid * 100, 2)
            capital = round(K * 100, 2)
            ann_yield = (bid / K) * (365 / dte) * 100
            eff_buy = K - bid
            discount = (S - eff_buy) / S * 100
            score = (
                ann_yield * 0.5
                + min(1.0, oi / 500) * 10 * 0.3
                + max(0.0, 1 - abs(abs_delta - 0.25) / 0.25) * 10 * 0.2
            )

            results.append(CSPOpp(
                symbol=sym,
                conviction=conviction,
                stock_price=round(S, 4),
                expiration=exp_str,
                dte=dte,
                strike=round(K, 2),
                bid=round(bid, 4),
                ask=round(ask, 4),
                premium_per_contract=prem_contract,
                delta=round(delta, 4),
                theta_per_day=round(theta, 4),
                iv_pct=round(iv * 100, 2),
                capital_required=capital,
                annualized_yield_pct=round(ann_yield, 2),
                effective_buy_price=round(eff_buy, 4),
                discount_pct=round(discount, 2),
                assignment_prob_pct=round(abs_delta * 100, 1),
                open_interest=oi,
                volume=vol,
                score=round(score, 4),
            ))

    results.sort(key=lambda x: x.score, reverse=True)
    return results[:2]


# ── IV Environment ────────────────────────────────────────────────────────────

def get_iv_environment(symbol: str) -> IVEnvironment | None:
    """
    Compute IV Rank and give a sell/buy recommendation.
    IV Rank = (current IV - 52w IV low) / (52w IV high - low) × 100.
    Uses 30-day rolling Historical Volatility as a proxy for the IV range
    (avoids fetching a full year of historical options chains).
    """
    sym = symbol.upper()
    if sym.endswith("-USD") or sym.endswith("-USDT"):
        return None

    cached = _iv_cache.get(sym)
    if cached and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]

    try:
        ticker = yf.Ticker(sym)
        hist = ticker.history(period="1y")
        if hist.empty or len(hist) < 60:
            return None

        closes = hist["Close"].dropna()
        log_ret = np.log(closes / closes.shift(1)).dropna()
        hv_series = (log_ret.rolling(30).std() * np.sqrt(252) * 100).dropna()
        if len(hv_series) < 30:
            return None

        hv_now = float(hv_series.iloc[-1])
        hv_high = float(hv_series.max())
        hv_low = float(hv_series.min())

        chain_data = _fetch_chain(sym)
        if not chain_data or not chain_data["chains"]:
            return None

        first_exp = next(iter(chain_data["chains"]))
        calls_df, puts_df, _ = chain_data["chains"][first_exp]
        S = chain_data["price"]

        atm_call = calls_df.iloc[(calls_df["strike"] - S).abs().argsort()[:1]]
        atm_put = puts_df.iloc[(puts_df["strike"] - S).abs().argsort()[:1]]

        c_iv = float(atm_call["impliedVolatility"].values[0]) if not atm_call.empty else 0.0
        p_iv = float(atm_put["impliedVolatility"].values[0]) if not atm_put.empty else 0.0
        current_iv = float(np.nanmean([v for v in [c_iv, p_iv] if v > 0])) * 100 if any(v > 0 for v in [c_iv, p_iv]) else hv_now

        rng = hv_high - hv_low
        iv_rank = max(0.0, min(100.0, (current_iv - hv_low) / rng * 100)) if rng >= 1 else 50.0
        iv_hv_spread = round(current_iv - hv_now, 2)

        if iv_rank >= 50:
            rec = "SELL_PREMIUM"
            reason = f"IV Rank {iv_rank:.0f}% — options are expensive. Ideal time to sell covered calls or cash-secured puts."
        elif iv_rank <= 30:
            rec = "BUY_OPTIONS"
            reason = f"IV Rank {iv_rank:.0f}% — options are cheap. Good time to buy calls or puts for directional bets."
        else:
            rec = "NEUTRAL"
            reason = f"IV Rank {iv_rank:.0f}% — mid-range conditions. Either strategy works; weigh your market view."

        result = IVEnvironment(
            symbol=sym,
            current_iv_pct=round(current_iv, 2),
            iv_rank=round(iv_rank, 1),
            hv_30d_pct=round(hv_now, 2),
            iv_hv_spread=iv_hv_spread,
            recommendation=rec,
            rec_reason=reason,
        )
        _iv_cache[sym] = (time.time(), result)
        return result

    except Exception as e:
        logger.warning(f"[{sym}] IV environment failed: {e}")
        return None
