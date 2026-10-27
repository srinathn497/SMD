"""
Audit (and optionally repair) prediction_log rows logged before base_date existed.

For every legacy row (base_date IS NULL) it infers base_date as the latest
completed daily bar on/before logged_date whose *raw* close equals price_at_log
(±0.01%), then compares the window the row was actually graded on against the
correct one (Nth session after base_date).

    cd backend && .venv/bin/python -m scripts.audit_prediction_log            # dry run
    cd backend && .venv/bin/python -m scripts.audit_prediction_log --apply    # write

--apply:
  matched rows    → base_date set; resolved rows re-graded on the correct window;
                    rows whose correct target bar isn't final yet → back to pending
  unmatched rows  → outcome VOID (resolved, excluded from accuracy + calibration)
--apply --void-all (used 2026-10-15):
  every legacy row → outcome VOID (base_date still backfilled where matched).
  Legacy calls were scored from a stale bar by predict(), so even re-graded
  outcomes can't be trusted.
  then refreshes the meta-calibrators (rebuilt from the whole table).
  signal_performance is NOT touched — it is accumulated incrementally.
"""
import argparse
import asyncio
from collections import Counter
from datetime import datetime, timedelta, timezone

import pandas as pd
import yfinance as yf
from sqlalchemy import select

from app.database import AsyncSessionLocal, init_db
from app.models.prediction_log import PredictionLog
from app.services.prediction_log_service import (
    HORIZON_BARS, PUSH_THRESHOLD_PCT, _ET, _STOCK_BAR_FINAL_ET, completed_bars,
)

MATCH_TOL = 1e-4  # 0.01%
MAX_BASE_AGE_DAYS = 10  # a match further back than this is a coincidental price


def _grade(direction: str, base: float, target: float) -> tuple[str, float]:
    move = (target - base) / base * 100
    if abs(move) < PUSH_THRESHOLD_PCT:
        return "PUSH", move
    if (direction == "UP") == (move > 0):
        return "CORRECT", move
    return "WRONG", move


def _final_at_utc(bar_date, asset_type: str) -> datetime:
    """Earliest UTC instant the bar for bar_date is final (naive UTC, like resolved_at)."""
    if asset_type == "crypto":
        dt = datetime(bar_date.year, bar_date.month, bar_date.day, tzinfo=timezone.utc) + timedelta(days=1)
    else:
        h, m = _STOCK_BAR_FINAL_ET
        dt = datetime(bar_date.year, bar_date.month, bar_date.day, h, m, tzinfo=_ET)
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _history(sym: str, asset_type: str) -> pd.Series:
    df = yf.Ticker(sym).history(period="2y", interval="1d", auto_adjust=False)
    df = df[~df.index.duplicated(keep="last")].rename(columns=str.lower)
    df = completed_bars(df, asset_type)
    s = df["close"].astype(float)
    s.index = [ts.date() for ts in s.index]
    return s


async def main(apply: bool, void_all: bool = False) -> None:
    await init_db()  # ensures base_date column exists
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(
            select(PredictionLog).where(PredictionLog.base_date.is_(None))
        )).scalars().all()

    by_sym: dict[tuple[str, str], list[PredictionLog]] = {}
    for r in rows:
        by_sym.setdefault((r.symbol, r.asset_type), []).append(r)

    stats: dict[str, Counter] = {"1d": Counter(), "1w": Counter()}
    flips: dict[str, Counter] = {"1d": Counter(), "1w": Counter()}
    acc = {h: {"before": Counter(), "after": Counter(), "clean": Counter()} for h in stats}
    updates: list[tuple[int, dict]] = []
    examples: list[str] = []

    for (sym, atype), sym_rows in sorted(by_sym.items()):
        try:
            closes = await asyncio.to_thread(_history, sym, atype)
        except Exception as e:
            print(f"  ! {sym}: history fetch failed ({e}) — {len(sym_rows)} rows skipped")
            continue
        dates = list(closes.index)

        for r in sym_rows:
            hz, st = r.horizon, stats[r.horizon]
            st["total"] += 1
            if r.outcome in ("CORRECT", "WRONG"):
                acc[hz]["before"][r.outcome] += 1

            cands = [d for d in dates
                     if r.logged_date - timedelta(days=MAX_BASE_AGE_DAYS) <= d <= r.logged_date
                     and abs(closes[d] - r.price_at_log) <= MATCH_TOL * r.price_at_log]
            if not cands:
                st["unmatched (live/adjusted base) → VOID"] += 1
                updates.append((r.id, {"resolved": True, "outcome": "VOID",
                                       "actual_move_pct": None, "price_at_resolve": None,
                                       "resolved_at": datetime.now(timezone.utc).replace(tzinfo=None)}))
                continue
            base = max(cands)
            n = HORIZON_BARS[hz]
            after = [d for d in dates if d > base]
            correct_target = after[n - 1] if len(after) >= n else None

            # Window the legacy resolver used (or would use)
            if hz == "1d":
                old = [d for d in dates if d >= r.logged_date]
                old_target = old[0] if old else None
            else:
                old = [d for d in dates if d > r.logged_date]
                old_target = old[n - 1] if len(old) >= n else None

            clean = old_target is not None and old_target == correct_target
            if old_target is not None and correct_target is not None:
                if old_target == base:
                    st["zero-session window (after-close log)"] += 1
                elif old_target == correct_target:
                    st["window correct"] += 1
                else:
                    span = sum(1 for d in dates if base < d <= old_target)
                    st[f"window {span} sessions (expected {n})"] += 1
            if r.resolved and r.resolved_at and r.price_at_resolve is not None and old_target is not None:
                if r.resolved_at < _final_at_utc(old_target, atype):
                    st["graded on an in-progress bar"] += 1

            upd: dict = {"base_date": base}
            if correct_target is None:
                if r.resolved:
                    st["re-opened (target not final yet)"] += 1
                    upd.update(resolved=False, outcome=None, actual_move_pct=None,
                               price_at_resolve=None, resolved_at=None)
            elif r.resolved:
                outcome, move = _grade(r.direction, r.price_at_log, float(closes[correct_target]))
                if outcome != r.outcome:
                    flips[hz][f"{r.outcome}→{outcome}"] += 1
                    if len(examples) < 8:
                        examples.append(
                            f"    {sym:8s} {hz} {r.logged_date} {r.direction:4s} base {base} "
                            f"{r.price_at_log:.2f} → {correct_target} {closes[correct_target]:.2f} "
                            f"({move:+.2f}%)  {r.outcome} → {outcome}"
                        )
                upd.update(outcome=outcome, actual_move_pct=round(move, 4),
                           price_at_resolve=round(float(closes[correct_target]), 6))
                if outcome in ("CORRECT", "WRONG"):
                    acc[hz]["after"][outcome] += 1
                    if clean:
                        acc[hz]["clean"][outcome] += 1
            updates.append((r.id, upd))

    def pct(c: Counter) -> str:
        n = c["CORRECT"] + c["WRONG"]
        return f"{c['CORRECT'] / n * 100:.1f}% ({c['CORRECT']}/{n})" if n else "n/a"

    print(f"\n=== prediction_log audit — {len(rows)} legacy rows, {len(by_sym)} symbols ===")
    for hz in ("1d", "1w"):
        print(f"\n[{hz}]")
        for k, v in sorted(stats[hz].items(), key=lambda kv: -kv[1]):
            print(f"  {k:45s} {v}")
        print(f"  outcome changes: {dict(flips[hz]) or 'none'}")
        print(f"  accuracy before: {pct(acc[hz]['before'])}   after: {pct(acc[hz]['after'])}"
              f"   clean-window rows only: {pct(acc[hz]['clean'])}")
    if examples:
        print("\n  sample changes:")
        print("\n".join(examples))

    if not apply:
        print("\nDry run — nothing written. Re-run with --apply to write.")
        return

    if void_all:
        # Keep the inferred base_date for reference; every legacy row leaves the stats.
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        updates = [
            (row_id, {k: v for k, v in upd.items() if k == "base_date"}
                     | {"resolved": True, "outcome": "VOID", "resolved_at": now})
            for row_id, upd in updates
        ]

    async with AsyncSessionLocal() as session:
        for row_id, upd in updates:
            row = await session.get(PredictionLog, row_id)
            for k, v in upd.items():
                setattr(row, k, v)
        await session.commit()
    from app.services.meta_calibration_service import refresh_meta_calibrators
    await refresh_meta_calibrators()
    print(f"\nApplied {len(updates)} row updates; meta-calibrators refreshed.")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true")
    p.add_argument("--void-all", action="store_true",
                   help="with --apply: VOID every legacy row instead of re-grading")
    a = p.parse_args()
    asyncio.run(main(a.apply, a.void_all))
