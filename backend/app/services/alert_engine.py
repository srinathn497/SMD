import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models.alert import Alert
from app.services.email_service import send_alert_email
from app.services.market_data import market_data_service
from app.services.ml_predictor import ml_predictor
from app.services.news_service import get_news
from app.services.technical import technical_analysis

logger = logging.getLogger("alert_engine")

# Will be set by ws.py connection manager to broadcast
_broadcast_callback = None


def set_broadcast_callback(fn):
    global _broadcast_callback
    _broadcast_callback = fn


async def check_all_alerts():
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Alert).where(Alert.is_active == True, Alert.is_triggered == False)
        )
        alerts: list[Alert] = result.scalars().all()

    triggered = []
    for alert in alerts:
        try:
            fired, price = await _evaluate_alert(alert)
            if fired:
                msg = alert.message or f"{alert.symbol} {alert.condition} @ {price}"
                triggered.append((alert, price))
                await _mark_triggered(alert.id, price)
                if _broadcast_callback:
                    await _broadcast_callback({
                        "type": "alert_triggered",
                        "alert_id": alert.id,
                        "symbol": alert.symbol,
                        "condition": alert.condition,
                        "threshold": alert.threshold,
                        "price": price,
                        "message": msg,
                        "time": datetime.now(timezone.utc).isoformat(),
                    })
                await send_alert_email(
                    symbol=alert.symbol,
                    condition=alert.condition,
                    threshold=alert.threshold,
                    price=price,
                    message=msg,
                )
        except Exception as e:
            logger.warning(f"Alert check failed for alert {alert.id} ({alert.symbol}): {e}")

    return triggered


async def _evaluate_alert(alert: Alert) -> tuple[bool, float]:
    quote = await market_data_service.get_quote(alert.symbol, alert.asset_type)
    price = quote.price

    condition = alert.condition
    threshold = alert.threshold

    if condition == "PRICE_ABOVE":
        return price >= threshold, price

    elif condition == "PRICE_BELOW":
        return price <= threshold, price

    elif condition == "PRICE_TARGET":
        # Generic price target — fires when price reaches the threshold from either direction
        return price >= threshold, price

    elif condition in ("RSI_OVERBOUGHT", "RSI_OVERSOLD"):
        df = await market_data_service.get_ohlcv_df(alert.symbol, alert.asset_type, "1d")
        result = technical_analysis.compute_all(df, alert.symbol, alert.asset_type)
        rsi_ind = next((i for i in result.indicators if "RSI" in i.name), None)
        if rsi_ind is None:
            return False, price
        if condition == "RSI_OVERBOUGHT":
            return rsi_ind.value >= 70, price
        else:
            return rsi_ind.value <= 30, price

    elif condition == "SIGNAL_CHANGE":
        df = await market_data_service.get_ohlcv_df(alert.symbol, alert.asset_type, "1d")
        result = technical_analysis.compute_all(df, alert.symbol, alert.asset_type)
        return result.aggregate_signal != "HOLD", price

    elif condition in ("SIGNAL_BUY", "SIGNAL_SELL"):
        df = await market_data_service.get_ohlcv_df(alert.symbol, alert.asset_type, "1d")
        result = technical_analysis.compute_all(df, alert.symbol, alert.asset_type)
        expected = "BUY" if condition == "SIGNAL_BUY" else "SELL"
        return result.aggregate_signal == expected, price

    elif condition in ("ML_PREDICT_UP", "ML_PREDICT_DOWN"):
        df = await market_data_service.get_ohlcv_df(alert.symbol, alert.asset_type, "1d")
        try:
            prediction = await asyncio.to_thread(ml_predictor.predict, alert.symbol, df)
            min_confidence = threshold if threshold else 70.0
            expected_dir = "UP" if condition == "ML_PREDICT_UP" else "DOWN"
            fired = (prediction.direction == expected_dir and
                     prediction.confidence_pct >= min_confidence)
            return fired, price
        except Exception as e:
            logger.debug(f"ML predict failed for {alert.symbol}: {e}")
            return False, price

    elif condition == "SENTIMENT_NEGATIVE":
        try:
            summary = await get_news(alert.symbol, alert.asset_type)
            cutoff = threshold if threshold else -0.2
            return summary.score <= cutoff, price
        except Exception as e:
            logger.debug(f"Sentiment check failed for {alert.symbol}: {e}")
            return False, price

    return False, price


async def _mark_triggered(alert_id: int, price: float):
    async with AsyncSessionLocal() as session:
        await session.execute(
            update(Alert)
            .where(Alert.id == alert_id)
            .values(is_triggered=True, triggered_at=datetime.now(timezone.utc), triggered_price=price)
        )
        await session.commit()
