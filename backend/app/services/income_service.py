"""
Options Buy Scanner

Reads conviction signals and finds the best options to BUY for each
bullish or bearish stock.

  BUY conviction  → buy CALL options
  SELL conviction → buy PUT options

For each option found, the trade plan is:
  Entry         : pay the ask price (cost_per_contract = ask × 100)
  Profit target : sell option at +75% gain (ask × 1.75)
  Stop loss     : sell option at -50% loss (ask × 0.50)
  Time stop     : exit when DTE drops to 14 — theta accelerates below this
  Break-even    : stock price at expiry where you neither gain nor lose

Greeks are computed via Black-Scholes (scipy). IV is from yfinance option chain.

Cached 30 minutes per symbol.
"""
import logging
import math
import time
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd
import yfinance as yf
from scipy.stats import norm

logger = logging.getLogger("income_service")

_cache: dict[str, tuple[float, list]] = {}
_CACHE_TTL = 30 * 60
_RISK_FREE = 0.045
_TIME_STOP_DTE = 14   # always exit before this DTE


def _refresh_crumb() -> None:
    """Force yfinance to fetch a fresh crumb/cookie on next request."""
    try:
        import yfinance.utils as yf_utils
        if hasattr(yf_utils, 'get_crumb'):
            yf_utils.get_crumb(force=True)
            return
    except Exception:
        pass
    try:
        # Fallback: a minimal download resets the session crumb
        yf.download("SPY", period="1d", progress=False, auto_adjust=True)
    except Exception:
        pass


@dataclass
class OptionBuyOpportunity:
    symbol: str
    option_type: str       # CALL | PUT
    conviction: str        # HIGH_CONVICTION | MODERATE
    stock_price: float

    expiration: str
    dte: int
    strike: float
    ask: float
    bid: float
    cost_per_contract: float   # ask × 100 — what you actually spend

    delta: float
    theta_per_day: float       # daily dollar decay per contract (negative)
    iv_pct: float

    breakeven_price: float     # stock must reach this at expiry to not lose
    profit_target_option: float  # sell option here (+75%)
    stop_loss_option: float      # sell option here (−50%)
    time_stop_date: str          # exit by this date regardless

    stock_move_needed_pct: float  # % move stock needs for break-even

    open_interest: int
    volume: int
    score: float


def _bs_delta(S, K, T, sigma, r=_RISK_FREE, option_type="call"):
    if T <= 0 or sigma <= 0:
        return 0.0
    try:
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        if option_type == "call":
            return float(norm.cdf(d1))
        return float(norm.cdf(d1) - 1)
    except Exception:
        return 0.0


def _bs_theta(S, K, T, sigma, r=_RISK_FREE, option_type="call"):
    """Daily theta in $ per share (multiply by 100 for per-contract)."""
    if T <= 0 or sigma <= 0:
        return 0.0
    try:
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)
        pdf_d1 = norm.pdf(d1)
        annual_theta = -(S * sigma * pdf_d1) / (2 * math.sqrt(T))
        if option_type == "call":
            annual_theta -= r * K * math.exp(-r * T) * norm.cdf(d2)
        else:
            annual_theta += r * K * math.exp(-r * T) * norm.cdf(-d2)
        return float(annual_theta / 365)   # per day, per share
    except Exception:
        return 0.0


def _pick_expiries(expirations, min_dte=25, max_dte=60):
    today = date.today()
    chosen = []
    for exp_str in expirations:
        try:
            dte = (date.fromisoformat(exp_str) - today).days
            if min_dte <= dte <= max_dte:
                chosen.append(exp_str)
            if len(chosen) >= 2:
                break
        except ValueError:
            continue
    return chosen


def scan_options_to_buy(
    symbol: str,
    direction: str,          # "BUY"/"UP" → calls, "SELL"/"DOWN" → puts
    conviction: str,
    *,
    min_dte: int = 25,
    max_dte: int = 60,
    min_delta: float = 0.35,
    max_delta: float = 0.65,
    min_oi: int = 50,
) -> list[OptionBuyOpportunity]:
    """
    Find the best 1-3 options to buy for a bullish or bearish conviction signal.
    Returns empty list for crypto, no options data, or fetch errors.
    """
    sym = symbol.upper()
    if sym.endswith("-USD") or sym.endswith("-USDT"):
        return []

    opt_type = "call" if direction in ("UP", "BUY") else "put"
    cache_key = f"{sym}:{direction}:{min_dte}:{max_dte}"
    cached = _cache.get(cache_key)
    if cached is not None and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]

    try:
        ticker = yf.Ticker(sym)
        hist = ticker.history(period="2d")
        if hist.empty:
            _cache[cache_key] = (time.time(), [])
            return []
        S = float(hist["Close"].iloc[-1])

        try:
            expirations = ticker.options
        except Exception as e:
            err_str = str(e)
            if "401" in err_str or "Unauthorized" in err_str or "Crumb" in err_str:
                logger.warning(f"[{sym}] Yahoo Finance auth error — refreshing crumb and retrying")
                _refresh_crumb()
                ticker = yf.Ticker(sym)
                expirations = ticker.options
            else:
                raise

        if not expirations:
            _cache[cache_key] = (time.time(), [])
            return []

        target_expiries = _pick_expiries(expirations, min_dte, max_dte)
        if not target_expiries:
            _cache[cache_key] = (time.time(), [])
            return []

        today = date.today()
        results: list[OptionBuyOpportunity] = []

        for exp_str in target_expiries:
            try:
                chain = ticker.option_chain(exp_str)
                if chain is None:
                    continue
                raw_df = chain.calls if opt_type == "call" else chain.puts
                if raw_df is None or raw_df.empty:
                    continue
                df: pd.DataFrame = raw_df.copy()
            except Exception as e:
                err_str = str(e)
                if "401" in err_str or "Unauthorized" in err_str or "Crumb" in err_str:
                    logger.warning(f"[{sym}] Auth error on chain {exp_str} — refreshing crumb")
                    _refresh_crumb()
                    # Don't cache the failure; let the next scan retry cleanly
                    return []
                logger.debug(f"[{sym}] chain fetch failed for {exp_str}: {e}")
                continue

            dte = (date.fromisoformat(exp_str) - today).days
            if dte <= 0:
                continue
            T = dte / 365.0
            time_stop_date = (date.fromisoformat(exp_str) - timedelta(days=_TIME_STOP_DTE)).isoformat()

            # Require real ask and liquidity
            df = df[df["ask"] > 0.05]
            df = df[df["openInterest"].fillna(0) >= min_oi]
            if df.empty:
                continue

            for _, row in df.iterrows():
                K = float(row["strike"])
                ask = float(row["ask"])
                bid = float(row["bid"])
                oi = int(row["openInterest"]) if pd.notna(row["openInterest"]) else 0
                vol = int(row["volume"]) if pd.notna(row["volume"]) else 0
                iv = float(row["impliedVolatility"]) if pd.notna(row["impliedVolatility"]) else 0.0

                if iv <= 0:
                    continue

                delta = _bs_delta(S, K, T, iv, option_type=opt_type)
                abs_delta = abs(delta)

                if not (min_delta <= abs_delta <= max_delta):
                    continue

                theta_share = _bs_theta(S, K, T, iv, option_type=opt_type)
                theta_contract = theta_share * 100   # per contract, per day

                # Trade plan
                if opt_type == "call":
                    breakeven = K + ask
                    stock_move = (breakeven - S) / S * 100
                else:
                    breakeven = K - ask
                    stock_move = (S - breakeven) / S * 100

                profit_target = round(ask * 1.75, 4)   # +75%
                stop_loss_opt = round(ask * 0.50, 4)   # −50%

                # Rank: favour near-ATM delta, lower IV (cheaper), good liquidity
                # Higher score = better opportunity
                delta_score = 1.0 - abs(abs_delta - 0.50)   # peak at delta=0.50
                iv_score    = max(0, 1.0 - iv)               # lower IV is better
                liq_score   = min(1.0, oi / 1000)
                score = delta_score * 0.5 + iv_score * 0.3 + liq_score * 0.2

                results.append(OptionBuyOpportunity(
                    symbol=sym,
                    option_type=opt_type.upper(),
                    conviction=conviction,
                    stock_price=round(S, 4),
                    expiration=exp_str,
                    dte=dte,
                    strike=round(K, 2),
                    ask=round(ask, 4),
                    bid=round(bid, 4),
                    cost_per_contract=round(ask * 100, 2),
                    delta=round(delta, 4),
                    theta_per_day=round(theta_contract, 4),
                    iv_pct=round(iv * 100, 2),
                    breakeven_price=round(breakeven, 4),
                    profit_target_option=round(profit_target, 4),
                    stop_loss_option=round(stop_loss_opt, 4),
                    time_stop_date=time_stop_date,
                    stock_move_needed_pct=round(stock_move, 2),
                    open_interest=oi,
                    volume=vol,
                    score=round(score, 4),
                ))

        results.sort(key=lambda x: x.score, reverse=True)
        top = results[:3]
        _cache[cache_key] = (time.time(), top)
        return top

    except Exception as e:
        err_str = str(e)
        if "401" in err_str or "Unauthorized" in err_str or "Crumb" in err_str:
            logger.warning(f"[{sym}] Yahoo Finance auth error — crumb refreshed, will retry on next scan")
            _refresh_crumb()
            # Don't cache so next refresh re-fetches
            return []
        logger.warning(f"[{sym}] options scan failed: {e}")
        _cache[cache_key] = (time.time(), [])
        return []
