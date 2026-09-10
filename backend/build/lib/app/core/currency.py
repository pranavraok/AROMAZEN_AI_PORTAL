import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
import structlog

from app.core.config import get_settings

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class ExchangeRate:
    rate: float
    source: str
    updated_at: datetime
    is_fallback: bool = False


_cached_rate: ExchangeRate | None = None
_cache_expires_at: datetime | None = None
_lock = asyncio.Lock()


async def usd_to_inr_rate() -> ExchangeRate:
    """Return a cached latest-available USD to INR reference rate."""
    global _cached_rate, _cache_expires_at
    now = datetime.now(timezone.utc)
    if _cached_rate and _cache_expires_at and now < _cache_expires_at:
        return _cached_rate

    async with _lock:
        now = datetime.now(timezone.utc)
        if _cached_rate and _cache_expires_at and now < _cache_expires_at:
            return _cached_rate

        timeout = httpx.Timeout(5.0, connect=3.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                response = await client.get("https://api.frankfurter.dev/v2/rate/USD/INR")
                response.raise_for_status()
                payload = response.json()
                rate = float(payload["rate"])
                if rate <= 0:
                    raise ValueError("Exchange rate must be positive.")
                rate_date = payload.get("date")
                updated_at = datetime.fromisoformat(f"{rate_date}T00:00:00+00:00") if rate_date else now
                _cached_rate = ExchangeRate(rate=rate, source="Frankfurter", updated_at=updated_at)
            except (httpx.HTTPError, KeyError, TypeError, ValueError) as primary_error:
                logger.warning("currency.primary_rate_failed", error=str(primary_error))
                try:
                    response = await client.get("https://open.er-api.com/v6/latest/USD")
                    response.raise_for_status()
                    payload = response.json()
                    rate = float(payload["rates"]["INR"])
                    if rate <= 0:
                        raise ValueError("Exchange rate must be positive.")
                    timestamp = payload.get("time_last_update_unix")
                    updated_at = datetime.fromtimestamp(timestamp, timezone.utc) if timestamp else now
                    _cached_rate = ExchangeRate(rate=rate, source="ExchangeRate-API", updated_at=updated_at)
                except (httpx.HTTPError, KeyError, TypeError, ValueError) as backup_error:
                    fallback = get_settings().usd_to_inr_fallback_rate
                    logger.error("currency.all_rates_failed", error=str(backup_error), fallback_rate=fallback)
                    _cached_rate = ExchangeRate(rate=fallback, source="Configured fallback", updated_at=now, is_fallback=True)

        _cache_expires_at = now + timedelta(seconds=get_settings().currency_rate_cache_seconds)
        return _cached_rate


def usd_to_inr(amount: float, exchange_rate: ExchangeRate) -> float:
    return round(float(amount) * exchange_rate.rate, 4)
