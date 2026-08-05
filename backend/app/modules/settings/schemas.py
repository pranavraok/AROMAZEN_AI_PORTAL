from datetime import datetime

from pydantic import BaseModel, Field


class ProviderStatus(BaseModel):
    key: str
    name: str
    connected: bool
    models: list[str]


class OrganizationSettingsResponse(BaseModel):
    organization_name: str
    platform_name: str
    theme: str
    default_ai_provider: str
    session_timeout_minutes: int
    timezone: str
    providers: list[ProviderStatus]
    storage_bytes: int
    knowledge_documents: int
    generated_documents: int
    max_upload_size_mb: int
    updated_at: datetime | None


class UpdateOrganizationSettingsRequest(BaseModel):
    organization_name: str = Field(min_length=2, max_length=160)
    platform_name: str = Field(min_length=2, max_length=160)
    theme: str = Field(pattern="^(dark|light|system)$")
    default_ai_provider: str = Field(pattern="^(openai|anthropic)$")
    session_timeout_minutes: int = Field(ge=30, le=1440)
    timezone: str = Field(min_length=2, max_length=80)
