from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
    app_name: str = "AROMAZEN AI API"
    app_env: str = "development"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"
    database_url: str | None = None
    database_host: str = "postgres"
    database_port: int = 5432
    database_name: str = "aromazen_ai"
    database_user: str = "aromazen"
    database_password: str | None = None
    redis_url: str
    log_level: str = "INFO"
    jwt_secret_key: str
    jwt_access_token_minutes: int = 15
    jwt_refresh_token_days: int = 30
    cookie_secure: bool = False
    bootstrap_owner_email: str | None = None
    bootstrap_owner_password: str | None = None
    bootstrap_owner_name: str = "AROMAZEN Super Admin"
    upload_storage_path: str = "/data/uploads"
    max_upload_size_mb: int = 50
    max_excel_upload_size_mb: int = 25
    openai_api_key: str | None = None
    openai_chat_model: str = "gpt-5.5"
    openai_embedding_model: str = "text-embedding-3-small"
    openai_transcription_model: str = "gpt-4o-mini-transcribe"
    openai_image_model: str = "gpt-image-2"
    anthropic_api_key: str | None = None
    anthropic_default_model: str = "claude-sonnet-4-6"
    anthropic_fast_model: str = "claude-haiku-4-5"
    ai_default_provider: str = "anthropic"
    ai_request_timeout_seconds: float = 120.0
    ai_connect_timeout_seconds: float = 10.0
    ai_max_output_tokens: int = 1400
    ai_rate_limit_per_minute: int = 10
    ai_retrieval_limit: int = 6
    ai_chunk_size: int = 1200
    ai_chunk_overlap: int = 200
    ai_max_chat_attachments: int = 8
    zoho_smtp_host: str = "smtp.zoho.in"
    zoho_smtp_port: int = 587
    zoho_smtp_security: str = "starttls"
    zoho_smtp_username: str | None = None
    zoho_smtp_password: str | None = None
    zoho_from_email: str | None = None
    zoho_from_name: str = "AROMAZEN INDIA"
    usd_to_inr_fallback_rate: float = 95.0
    currency_rate_cache_seconds: int = 3600
    usd_to_inr_fallback_rate: float = 87.0
    currency_rate_cache_seconds: int = 3600

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        if not self.database_password:
            raise ValueError("DATABASE_PASSWORD must be configured when DATABASE_URL is not set.")
        return URL.create("postgresql+asyncpg", username=self.database_user, password=self.database_password, host=self.database_host, port=self.database_port, database=self.database_name).render_as_string(hide_password=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
