from contextlib import asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from app.api.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import SessionLocal
from app.modules.identity.service import bootstrap_owner
from app.modules.hr_letters.seed import seed_hr_letter_templates

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    redis = Redis.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
    await redis.ping()
    app.state.redis = redis
    async with SessionLocal() as session:
        await bootstrap_owner(session)
        await seed_hr_letter_templates(session)
    yield
    await redis.aclose()


production = settings.app_env.lower() == "production"
app = FastAPI(
    title=settings.app_name,
    debug=settings.debug,
    lifespan=lifespan,
    docs_url=None if production else "/docs",
    redoc_url=None if production else "/redoc",
    openapi_url=None if production else "/openapi.json",
)
app.include_router(api_router, prefix=settings.api_v1_prefix)
