from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.modules.identity.models import OrganizationSetting


async def organization_settings(session: AsyncSession, organization_id) -> OrganizationSetting:
    value = await session.get(OrganizationSetting, organization_id)
    if value is None:
        defaults = get_settings()
        value = OrganizationSetting(
            organization_id=organization_id,
            platform_name="AROMAZEN AI",
            theme="dark",
            default_ai_provider=defaults.ai_default_provider if defaults.ai_default_provider in {"auto", "openai", "anthropic"} else "anthropic",
            session_timeout_minutes=480,
            timezone="Asia/Calcutta",
            daily_ai_request_limit=100,
            monthly_ai_request_limit=2000,
            monthly_ai_cost_limit_usd=250,
        )
        session.add(value)
        await session.flush()
    return value


async def provider_runtime_settings(session: AsyncSession, organization_id) -> Settings:
    value = await organization_settings(session, organization_id)
    return get_settings().model_copy(update={"ai_default_provider": value.default_ai_provider})
