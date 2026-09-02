from datetime import datetime

from pydantic import BaseModel, Field


class ProviderStatus(BaseModel):
    key: str
    name: str
    connected: bool
    models: list[str]


class EmailMailboxStatus(BaseModel):
    key: str
    department_slug: str
    department_name: str
    email: str


class OrganizationSettingsResponse(BaseModel):
    organization_name: str
    platform_name: str
    theme: str
    default_ai_provider: str
    session_timeout_minutes: int
    timezone: str
    daily_ai_request_limit: int
    monthly_ai_request_limit: int
    monthly_ai_cost_limit_inr: float
    currency: str
    usd_to_inr_rate: float
    exchange_rate_source: str
    exchange_rate_updated_at: datetime
    providers: list[ProviderStatus]
    zoho_email_connected: bool
    email_mailboxes: list[EmailMailboxStatus]
    storage_bytes: int
    knowledge_documents: int
    generated_documents: int
    max_upload_size_mb: int
    max_excel_upload_size_mb: int
    updated_at: datetime | None


class UpdateOrganizationSettingsRequest(BaseModel):
    organization_name: str = Field(min_length=2, max_length=160)
    platform_name: str = Field(min_length=2, max_length=160)
    theme: str = Field(pattern="^(dark|light|system)$")
    default_ai_provider: str = Field(pattern="^(auto|openai|anthropic)$")
    session_timeout_minutes: int = Field(ge=30, le=1440)
    timezone: str = Field(min_length=2, max_length=80)
    daily_ai_request_limit: int = Field(ge=1, le=100000)
    monthly_ai_request_limit: int = Field(ge=1, le=1000000)
    monthly_ai_cost_limit_inr: float = Field(ge=1, le=100000000)
