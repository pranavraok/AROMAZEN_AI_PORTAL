from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db_session
from app.modules.identity.authorization import require_permissions
from app.modules.identity.models import AuditEvent, DocumentGeneration, KnowledgeDocument, Organization, User
from app.modules.settings.schemas import OrganizationSettingsResponse, ProviderStatus, UpdateOrganizationSettingsRequest
from app.modules.settings.service import organization_settings

router = APIRouter()


async def response_for(session: AsyncSession, user: User) -> OrganizationSettingsResponse:
    organization = await session.get(Organization, user.organization_id)
    value = await organization_settings(session, user.organization_id)
    config = get_settings()
    storage_bytes = await session.scalar(select(func.coalesce(func.sum(KnowledgeDocument.size_bytes), 0)).where(KnowledgeDocument.organization_id == user.organization_id)) or 0
    knowledge_documents = await session.scalar(select(func.count(KnowledgeDocument.id)).where(KnowledgeDocument.organization_id == user.organization_id)) or 0
    generated_documents = await session.scalar(select(func.count(DocumentGeneration.id)).where(DocumentGeneration.organization_id == user.organization_id)) or 0
    return OrganizationSettingsResponse(
        organization_name=organization.name, platform_name=value.platform_name, theme=value.theme,
        default_ai_provider=value.default_ai_provider, session_timeout_minutes=value.session_timeout_minutes,
        timezone=value.timezone,
        providers=[
            ProviderStatus(key="openai", name="OpenAI", connected=bool(config.openai_api_key), models=[config.openai_chat_model, config.openai_embedding_model, config.openai_transcription_model]),
            ProviderStatus(key="anthropic", name="Anthropic", connected=bool(config.anthropic_api_key), models=[config.anthropic_default_model, config.anthropic_fast_model]),
        ],
        storage_bytes=int(storage_bytes), knowledge_documents=int(knowledge_documents), generated_documents=int(generated_documents),
        max_upload_size_mb=config.max_upload_size_mb, updated_at=value.updated_at,
    )


@router.get("", response_model=OrganizationSettingsResponse)
async def get_organization_settings(user: User = Depends(require_permissions("settings.manage")), session: AsyncSession = Depends(get_db_session)) -> OrganizationSettingsResponse:
    result = await response_for(session, user)
    await session.commit()
    return result


@router.put("", response_model=OrganizationSettingsResponse)
async def update_organization_settings(payload: UpdateOrganizationSettingsRequest, user: User = Depends(require_permissions("settings.manage")), session: AsyncSession = Depends(get_db_session)) -> OrganizationSettingsResponse:
    organization = await session.get(Organization, user.organization_id)
    duplicate = await session.scalar(select(Organization.id).where(Organization.name == payload.organization_name.strip(), Organization.id != organization.id))
    if duplicate:
        raise HTTPException(status_code=409, detail="Another organization already uses this name.")
    config = get_settings()
    configured = {"openai": bool(config.openai_api_key), "anthropic": bool(config.anthropic_api_key)}
    if not configured[payload.default_ai_provider]:
        raise HTTPException(status_code=422, detail=f"{payload.default_ai_provider.title()} is not configured on this deployment.")
    value = await organization_settings(session, user.organization_id)
    organization.name = payload.organization_name.strip()
    value.platform_name = payload.platform_name.strip()
    value.theme = payload.theme
    value.default_ai_provider = payload.default_ai_provider
    value.session_timeout_minutes = payload.session_timeout_minutes
    value.timezone = payload.timezone.strip()
    session.add(AuditEvent(organization_id=user.organization_id, actor_user_id=user.id, action="settings.organization_updated", target_type="organization", target_id=str(user.organization_id), metadata_json={"theme": value.theme, "default_ai_provider": value.default_ai_provider, "session_timeout_minutes": value.session_timeout_minutes, "timezone": value.timezone}))
    await session.commit()
    return await response_for(session, user)
