"""
Meta-Calibration Service
=========================
A second-stage, pooled (global, not per-symbol) calibrator that learns what
the model's *displayed* confidence has actually meant historically.

Each per-symbol LightGBM/XGBoost classifier already goes through its own
isotonic calibration (ml_predictor.py) plus a sentiment nudge. None of that
is informed by the model's own track record of right/wrong calls across the
whole symbol universe. This service closes that loop:

  1. Pull every resolved, non-PUSH prediction_log row, grouped by horizon.
  2. Fit IsotonicRegression mapping displayed confidence -> empirical P(correct).
  3. Persist to models_store/_meta_calibrator_{horizon}.pkl.
  4. ml_predictor.predict() asks get_meta_confidence() for a corrected number,
     shown *alongside* (not replacing) the raw confidence.

Why global, not per-symbol: per-symbol/horizon sample counts are in the
9-20 row range today — far too thin to fit a per-symbol curve without
overfitting noise. Pooling across the whole universe is the only
statistically sound option until much more history accumulates.

Refresh trigger: called once per resolve_predictions() batch (see
prediction_log_service.py), the same way signal_performance_service already
piggybacks on that pipeline. Fitting an isotonic regression on a couple
thousand points is milliseconds — nothing like the cost of a model retrain —
so refitting synchronously on every resolve batch is cheap and always fresh.
"""
import logging

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.prediction_log import PredictionLog
from app.services.ml_predictor import MODELS_DIR

logger = logging.getLogger("meta_calibration")

# Minimum resolved (non-PUSH) rows for a horizon before its meta-calibrator activates.
# Coarser/less noisy than per-signal learning (signal_performance_service's
# MIN_SAMPLES=10) since this sits downstream of a model that's already calibrated
# once — a higher bar avoids reacting to short-run noise.
MIN_SAMPLES = 200

LOGGED_HORIZONS = ("1d", "1w")

# In-memory cache: {horizon: (IsotonicRegression, sample_count)}
_CALIBRATOR_CACHE: dict[str, tuple[object, int]] = {}


def _calibrator_path(horizon: str) -> "object":
    return MODELS_DIR / f"_meta_calibrator_{horizon}.pkl"


def get_meta_confidence(horizon: str, confidence_pct: float) -> float | None:
    """
    Synchronous lookup used inside ml_predictor.predict().
    Returns the trust-adjusted confidence (0-100), or None if this horizon
    doesn't have an active meta-calibrator yet (not enough resolved history).
    """
    entry = _CALIBRATOR_CACHE.get(horizon)
    if entry is None:
        return None
    calibrator, _n = entry
    try:
        adjusted = float(calibrator.predict([confidence_pct / 100.0])[0]) * 100.0
        return round(min(99.0, max(1.0, adjusted)), 1)
    except Exception as e:
        logger.debug(f"[meta_calibration] get_meta_confidence failed for {horizon}: {e}")
        return None


async def refresh_meta_calibrators() -> dict[str, int]:
    """
    Refit the per-horizon meta-calibrator from the full resolved prediction_log
    history. Safe to call often — cheap (isotonic regression on a few thousand
    points), always idempotent, loads results into the in-memory cache and
    persists to disk for restart-durability.
    Returns {horizon: sample_count} for logging/diagnostics.
    """
    import joblib
    from sklearn.isotonic import IsotonicRegression

    sample_counts: dict[str, int] = {}

    async with AsyncSessionLocal() as session:
        for horizon in LOGGED_HORIZONS:
            rows = (
                await session.execute(
                    select(PredictionLog.confidence_pct, PredictionLog.outcome).where(
                        PredictionLog.horizon == horizon,
                        PredictionLog.resolved == True,
                        PredictionLog.outcome.in_(("CORRECT", "WRONG")),
                    )
                )
            ).all()

            sample_counts[horizon] = len(rows)

            if len(rows) < MIN_SAMPLES:
                # Drop any earlier fit too — its history may since have been voided.
                _CALIBRATOR_CACHE.pop(horizon, None)
                _calibrator_path(horizon).unlink(missing_ok=True)
                logger.info(
                    f"[meta_calibration] {horizon}: {len(rows)}/{MIN_SAMPLES} resolved rows — "
                    f"not enough history yet, meta-calibrator inactive"
                )
                continue

            x = [conf / 100.0 for conf, _ in rows]
            y = [1.0 if outcome == "CORRECT" else 0.0 for _, outcome in rows]

            try:
                calibrator = IsotonicRegression(out_of_bounds="clip").fit(x, y)
                joblib.dump(calibrator, _calibrator_path(horizon))
                _CALIBRATOR_CACHE[horizon] = (calibrator, len(rows))
                logger.info(
                    f"[meta_calibration] {horizon}: refit on {len(rows)} resolved rows — active"
                )
            except Exception as e:
                logger.warning(f"[meta_calibration] {horizon}: refit failed: {e}")

    return sample_counts


def load_meta_calibrators_from_disk() -> None:
    """Load any previously-fit calibrators into the in-memory cache on startup."""
    import joblib

    for horizon in LOGGED_HORIZONS:
        path = _calibrator_path(horizon)
        if path.exists():
            try:
                calibrator = joblib.load(path)
                _CALIBRATOR_CACHE[horizon] = (calibrator, -1)
                logger.info(f"[meta_calibration] Loaded cached {horizon} meta-calibrator from disk")
            except Exception as e:
                logger.warning(f"[meta_calibration] Failed to load {horizon} calibrator: {e}")
