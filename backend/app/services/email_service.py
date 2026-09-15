import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import settings

logger = logging.getLogger("email_service")


def _send_sync(subject: str, html: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_USER
    msg["To"] = settings.ALERT_EMAIL_TO
    msg.attach(MIMEText(html, "html"))
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as s:
        s.starttls()
        s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        s.sendmail(settings.SMTP_USER, settings.ALERT_EMAIL_TO, msg.as_string())


async def send_alert_email(
    symbol: str,
    condition: str,
    threshold: float,
    price: float,
    message: str,
) -> None:
    if not settings.SMTP_ENABLED:
        return
    subject = f"[SMD Alert] {symbol} — {condition}"
    html = f"""
<html>
<body style="font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px">
  <h2 style="color:#22c55e;margin-bottom:4px">Alert Triggered</h2>
  <p style="color:#94a3b8;margin-top:0">{message}</p>
  <table style="border-collapse:collapse;margin-top:16px">
    <tr>
      <td style="padding:8px 16px 8px 0;color:#64748b">Symbol</td>
      <td style="padding:8px 0;font-weight:bold">{symbol}</td>
    </tr>
    <tr>
      <td style="padding:8px 16px 8px 0;color:#64748b">Condition</td>
      <td style="padding:8px 0">{condition}</td>
    </tr>
    <tr>
      <td style="padding:8px 16px 8px 0;color:#64748b">Threshold</td>
      <td style="padding:8px 0">{threshold}</td>
    </tr>
    <tr>
      <td style="padding:8px 16px 8px 0;color:#64748b">Triggered at</td>
      <td style="padding:8px 0;color:#22c55e;font-weight:bold">${price:.4f}</td>
    </tr>
  </table>
  <p style="color:#334155;font-size:11px;margin-top:32px">Share Market Dashboard</p>
</body>
</html>"""
    try:
        await asyncio.to_thread(_send_sync, subject, html)
        logger.info("Alert email sent: %s %s", symbol, condition)
    except Exception as exc:
        logger.warning("Alert email failed for %s: %s", symbol, exc)
