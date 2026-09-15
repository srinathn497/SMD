"""
Signal Backtest Service
=======================
Runs a historical walk-forward backtest using up to 6 months of yfinance
daily data to compute per-symbol signal accuracy.

Signals evaluated (pure price/volume or stable fundamentals — no look-ahead):
  Technical, Breakout, Mean Reversion, Fundamentals,
  FCF Yield, Debt/Equity, P/E Valuation

Signals NOT evaluated (data unavailable historically):
  Daily ML, 15m ML, News Sentiment, Options signals,
  Volume (not directional), Intraday signals

Results stored in signal_performance_stock (keyed by symbol+signal_name).
After completion, signal_performance_service weight cache is refreshed so
conviction.py picks up per-stock weights immediately.

Schedule: on startup if not run in last 7 days; weekly Sunday 03:00.
"""
import asyncio
import logging
from collections import defaultdict
from datetime import datetime

import pandas as pd

from app.database import AsyncSessionLocal
from app.models.signal_performance_stock import SignalPerformanceStock

logger = logging.getLogger("signal_backtest")

LOOKBACK      = 30       # minimum bars needed for indicator warmup
HISTORY_PERIOD = "6mo"  # yfinance period string
PUSH_THRESHOLD = 0.001  # skip days with < 0.1% move (noise)
MIN_SAMPLES    = 10      # minimum evaluations before applying custom weight

_backtest_running = False


def is_backtest_running() -> bool:
    return _backtest_running


def _compute_weight(win: int, loss: int) -> float:
    total = win + loss
    if total < MIN_SAMPLES:
        return 1.0
    return max(0.5, min(2.0, win / total * 100.0 / 50.0))


def _signals_on_window(
    window: pd.DataFrame,
    fund: dict,
    asset_type: str,
) -> dict[str, str]:
    """
    Compute backtestable signals on one historical OHLCV window.
    Returns {signal_name: "UP" | "DOWN"} for every signal that fired.
    """
    import pandas_ta as ta

    results: dict[str, str] = {}
    close = window["close"]
    high  = window["high"]
    low   = window["low"]
    vol   = window["volume"]
    curr  = float(close.iloc[-1])
    n     = len(window)

    # ── Technical aggregate ──────────────────────────────────────────────────
    buy_ct = sell_ct = 0
    try:
        rsi = ta.rsi(close, length=14)
        if rsi is not None and not rsi.empty:
            r = float(rsi.iloc[-1])
            if not pd.isna(r):
                if r < 40:   buy_ct  += 1
                elif r > 60: sell_ct += 1
    except Exception:
        pass
    try:
        macd = ta.macd(close)
        if macd is not None:
            col = next((c for c in macd.columns if c.startswith("MACDh")), None)
            if col:
                h = float(macd[col].iloc[-1])
                if not pd.isna(h):
                    if h > 0:   buy_ct  += 1
                    elif h < 0: sell_ct += 1
    except Exception:
        pass
    try:
        bb = ta.bbands(close, length=20)
        if bb is not None:
            uc = next((c for c in bb.columns if c.startswith("BBU")), None)
            lc = next((c for c in bb.columns if c.startswith("BBL")), None)
            if uc and lc:
                bbu, bbl = float(bb[uc].iloc[-1]), float(bb[lc].iloc[-1])
                if not (pd.isna(bbu) or pd.isna(bbl)):
                    if curr <= bbl:   buy_ct  += 1
                    elif curr >= bbu: sell_ct += 1
    except Exception:
        pass
    try:
        e20 = ta.ema(close, length=20)
        e50 = ta.ema(close, length=50)
        if e20 is not None and e50 is not None:
            v20, v50 = float(e20.iloc[-1]), float(e50.iloc[-1])
            if not (pd.isna(v20) or pd.isna(v50)):
                if v20 > v50:   buy_ct  += 1
                elif v20 < v50: sell_ct += 1
    except Exception:
        pass
    if buy_ct > sell_ct:   results["Technical"] = "UP"
    elif sell_ct > buy_ct: results["Technical"] = "DOWN"

    # ── Breakout + Momentum ───────────────────────────────────────────────────
    if n >= 21:
        try:
            ph   = float(high.iloc[-21:-1].max())
            pl   = float(low.iloc[-21:-1].min())
            vavg = float(vol.iloc[-21:-1].mean())
            ma20 = float(close.iloc[-20:].mean())
            cv   = float(vol.iloc[-1])
            if curr > ph and cv >= 1.2 * vavg and curr > ma20:
                results["Breakout"] = "UP"
            elif curr < pl and cv >= 1.2 * vavg and curr < ma20:
                results["Breakout"] = "DOWN"
        except Exception:
            pass

    # ── Mean Reversion ────────────────────────────────────────────────────────
    if n >= 20:
        try:
            mean20 = float(close.iloc[-20:].mean())
            std20  = float(close.iloc[-20:].std())
            if std20 > 0:
                z = (curr - mean20) / std20
                if z <= -2.0:  results["Mean Reversion"] = "UP"
                elif z >= 2.0: results["Mean Reversion"] = "DOWN"
        except Exception:
            pass

    # ── Fundamental signals (stocks only, current snapshot) ──────────────────
    if asset_type == "stock" and fund:
        hs = fund.get("health_score", 3)
        if hs >= 5:   results["Fundamentals"] = "UP"
        elif hs <= 2: results["Fundamentals"] = "DOWN"

        fcf = fund.get("fcf_yield_pct")
        if fcf is not None:
            if fcf > 3.0:   results["FCF Yield"] = "UP"
            elif fcf < 0.0: results["FCF Yield"] = "DOWN"

        de = fund.get("debt_to_equity")
        if de is not None:
            if de < 0.5:   results["Debt/Equity"] = "UP"
            elif de > 2.0: results["Debt/Equity"] = "DOWN"

        pe = fund.get("pe_ratio")
        if pe is not None and pe > 0:
            if pe < 15:   results["P/E Valuation"] = "UP"
            elif pe > 40: results["P/E Valuation"] = "DOWN"

    return results


async def _fetch_fund(symbol: str) -> dict:
    try:
        from app.services.fundamental_service import get_fundamentals
        fd = await asyncio.wait_for(
            asyncio.to_thread(get_fundamentals, symbol), timeout=15
        )
        if fd is None:
            return {}
        return {
            "health_score":   getattr(fd, "health_score",   3),
            "fcf_yield_pct":  getattr(fd, "fcf_yield_pct",  None),
            "debt_to_equity": getattr(fd, "debt_to_equity", None),
            "pe_ratio":       getattr(fd, "pe_ratio",       None),
        }
    except Exception as exc:
        logger.debug(f"[backtest] fund fetch {symbol}: {exc}")
        return {}


async def _backtest_one(symbol: str, asset_type: str, sem: asyncio.Semaphore) -> int:
    async with sem:
        try:
            from app.services.market_data import market_data_service
            df = await asyncio.wait_for(
                market_data_service.get_ohlcv_df(symbol, asset_type, "1d", period=HISTORY_PERIOD),
                timeout=30,
            )
            if df is None or len(df) < LOOKBACK + 2:
                return 0

            if df.index.duplicated().any():
                df = df[~df.index.duplicated(keep="last")]
            df = df.sort_index()

            fund = await _fetch_fund(symbol) if asset_type == "stock" else {}

            tally: dict[str, list] = defaultdict(lambda: [0, 0])  # [wins, losses]

            for i in range(LOOKBACK, len(df) - 1):
                curr_c = float(df.iloc[i]["close"])
                next_c = float(df.iloc[i + 1]["close"])
                if curr_c <= 0:
                    continue
                fwd = (next_c - curr_c) / curr_c
                if abs(fwd) < PUSH_THRESHOLD:
                    continue
                actual = "UP" if fwd > 0 else "DOWN"

                fired = _signals_on_window(df.iloc[: i + 1], fund, asset_type)
                for name, opinion in fired.items():
                    if opinion == actual:
                        tally[name][0] += 1
                    else:
                        tally[name][1] += 1

            if not tally:
                return 0

            now = datetime.utcnow()
            async with AsyncSessionLocal() as session:
                for name, (wins, losses) in tally.items():
                    total    = wins + losses
                    accuracy = round(wins / total * 100.0, 1) if total else 50.0
                    row = SignalPerformanceStock(
                        symbol        = symbol.upper(),
                        signal_name   = name,
                        win_count     = wins,
                        loss_count    = losses,
                        accuracy_pct  = accuracy,
                        weight        = round(_compute_weight(wins, losses), 3),
                        backtested_at = now,
                    )
                    await session.merge(row)
                await session.commit()

            total_evals = sum(v[0] + v[1] for v in tally.values())
            logger.info(
                f"[backtest] {symbol}: {total_evals} evals, "
                f"{len(tally)} signals — "
                f"top: {max(tally, key=lambda k: tally[k][0]/(tally[k][0]+tally[k][1]) if sum(tally[k])>=MIN_SAMPLES else 0)}"
            )
            return total_evals

        except asyncio.TimeoutError:
            logger.warning(f"[backtest] {symbol} timed out")
            return 0
        except Exception as exc:
            logger.warning(f"[backtest] {symbol} failed: {exc}")
            return 0


async def run_signal_backtest(extra: list[tuple[str, str]] | None = None) -> int:
    """
    Run per-stock historical backtest for the full default universe + extras.
    Returns total signal evaluations completed.
    """
    global _backtest_running
    if _backtest_running:
        logger.info("[backtest] Already running — skipped")
        return 0

    _backtest_running = True
    try:
        from app.services.scanner import DEFAULT_STOCKS, DEFAULT_CRYPTO

        universe: list[tuple[str, str]] = (
            [(s, "stock")  for s, _ in DEFAULT_STOCKS] +
            [(s, "crypto") for s, _ in DEFAULT_CRYPTO]
        )
        if extra:
            for item in extra:
                if item not in universe:
                    universe.append(item)

        logger.info(f"[backtest] Starting for {len(universe)} symbols")
        sem   = asyncio.Semaphore(3)
        tasks = [_backtest_one(s, a, sem) for s, a in universe]
        raw   = await asyncio.gather(*tasks, return_exceptions=True)
        total = sum(r for r in raw if isinstance(r, int))
        logger.info(f"[backtest] Done — {total} total evaluations across {len(universe)} symbols")

        from app.services.signal_performance_service import refresh_weights
        await refresh_weights()
        return total
    finally:
        _backtest_running = False


async def should_run_backtest() -> bool:
    """True if no backtest has run in the last 7 days."""
    try:
        from sqlalchemy import select, func
        async with AsyncSessionLocal() as session:
            latest = (
                await session.execute(select(func.max(SignalPerformanceStock.backtested_at)))
            ).scalar()
        if latest is None:
            return True
        return (datetime.utcnow() - latest).total_seconds() / 86400 > 7
    except Exception:
        return True
