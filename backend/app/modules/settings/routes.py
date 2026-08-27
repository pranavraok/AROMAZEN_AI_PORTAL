from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.currency import usd_to_inr, usd_to_inr_rate
from app.db.session import get_db_session
from app.modules.identity.authorization import get_current_user, require_permissions
from app.modules.identity.models import AuditEvent, DocumentGeneration, KnowledgeDocument, Organization, User
from app.modules.identity.service import permission_keys_for_user
from app.modules.settings.schemas import OrganizationSettingsResponse, ProviderStatus, UpdateOrganizationSettingsRequest
from app.modules.settings.service import organization_settings

router = APIRouter()


async def response_for(session: AsyncSession, user: User) -> OrganizationSettingsResponse:
    organization = await session.get(Organization, user.organization_id)
    value = await organization_settings(session, user.organization_id)
    exchange_rate = await usd_to_inr_rate()
    config = get_settings()
    storage_bytes = await session.scalar(select(func.coalesce(func.sum(KnowledgeDocument.size_bytes), 0)).where(KnowledgeDocument.organization_id == user.organization_id)) or 0
    knowledge_documents = await session.scalar(select(func.count(KnowledgeDocument.id)).where(KnowledgeDocument.organization_id == user.organization_id)) or 0
    generated_documents = await session.scalar(select(func.count(DocumentGeneration.id)).where(DocumentGeneration.organization_id == user.organization_id)) or 0
    return OrganizationSettingsResponse(
        organization_name=organization.name, platform_name=value.platform_name, theme=value.theme,
        default_ai_provider=value.default_ai_provider, session_timeout_minutes=value.session_timeout_minutes,
        timezone=value.timezone,
        daily_ai_request_limit=value.daily_ai_request_limit,
        monthly_ai_request_limit=value.monthly_ai_request_limit,
        monthly_ai_cost_limit_inr=usd_to_inr(float(value.monthly_ai_cost_limit_usd), exchange_rate),
        currency="INR", usd_to_inr_rate=exchange_rate.rate,
        exchange_rate_source=exchange_rate.source, exchange_rate_updated_at=exchange_rate.updated_at,
        providers=[
            ProviderStatus(key="auto", name="Auto", connected=bool(config.openai_api_key or config.anthropic_api_key), models=["Query-aware model selection"]),
            ProviderStatus(key="openai", name="OpenAI", connected=bool(config.openai_api_key), models=[config.openai_chat_model, config.openai_embedding_model, config.openai_transcription_model]),
            ProviderStatus(key="anthropic", name="Anthropic", connected=bool(config.anthropic_api_key), models=[config.anthropic_default_model, config.anthropic_fast_model]),
        ],
        zoho_email_connected=bool(config.zoho_smtp_username and config.zoho_smtp_password and (config.zoho_from_email or config.zoho_smtp_username)),
        storage_bytes=int(storage_bytes), knowledge_documents=int(knowledge_documents), generated_documents=int(generated_documents),
        max_upload_size_mb=config.max_upload_size_mb, max_excel_upload_size_mb=config.max_excel_upload_size_mb, updated_at=value.updated_at,
    )


@router.get("", response_model=OrganizationSettingsResponse)
async def get_organization_settings(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_db_session)) -> OrganizationSettingsResponse:
    result = await response_for(session, user)
    await session.commit()
    return result


@router.put("", response_model=OrganizationSettingsResponse)
async def update_organization_settings(payload: UpdateOrganizationSettingsRequest, user: User = Depends(require_permissions("settings.manage")), session: AsyncSession = Depends(get_db_session)) -> OrganizationSettingsResponse:
    organization = await session.get(Organization, user.organization_id)
    config = get_settings()
    configured = {
        "auto": bool(config.openai_api_key or config.anthropic_api_key),
        "openai": bool(config.openai_api_key),
        "anthropic": bool(config.anthropic_api_key),
    }
    current_value = await organization_settings(session, user.organization_id)
    permissions = set(await permission_keys_for_user(session, user.id))
    protected_changes = (
        payload.organization_name.strip() != organization.name
        or payload.platform_name.strip() != current_value.platform_name
        or payload.default_ai_provider != current_value.default_ai_provider
        or payload.session_timeout_minutes != current_value.session_timeout_minutes
    )
    if protected_changes and "platform.manage" not in permissions:
        raise HTTPException(status_code=403, detail="Only the Super Admin can change organization identity, AI provider routing, or session security.")
    duplicate = await session.scalar(select(Organization.id).where(Organization.name == payload.organization_name.strip(), Organization.id != organization.id))
    if duplicate:
        raise HTTPException(status_code=409, detail="Another organization already uses this name.")
    if not configured[payload.default_ai_provider] and payload.default_ai_provider != current_value.default_ai_provider:
        detail = "No AI provider is configured on this deployment." if payload.default_ai_provider == "auto" else f"{payload.default_ai_provider.title()} is not configured on this deployment."
        raise HTTPException(status_code=422, detail=detail)
    value = current_value
    organization.name = payload.organization_name.strip()
    value.platform_name = payload.platform_name.strip()
    value.theme = payload.theme
    value.default_ai_provider = payload.default_ai_provider
    value.session_timeout_minutes = payload.session_timeout_minutes
    value.timezone = payload.timezone.strip()
    value.daily_ai_request_limit = payload.daily_ai_request_limit
    value.monthly_ai_request_limit = payload.monthly_ai_request_limit
    exchange_rate = await usd_to_inr_rate()
    value.monthly_ai_cost_limit_usd = payload.monthly_ai_cost_limit_inr / exchange_rate.rate
    session.add(AuditEvent(organization_id=user.organization_id, actor_user_id=user.id, action="settings.organization_updated", target_type="organization", target_id=str(user.organization_id), metadata_json={"theme": value.theme, "default_ai_provider": value.default_ai_provider, "session_timeout_minutes": value.session_timeout_minutes, "timezone": value.timezone, "daily_ai_request_limit": value.daily_ai_request_limit, "monthly_ai_request_limit": value.monthly_ai_request_limit, "monthly_ai_cost_limit_inr": payload.monthly_ai_cost_limit_inr}))
    await session.commit()
    return await response_for(session, user)
