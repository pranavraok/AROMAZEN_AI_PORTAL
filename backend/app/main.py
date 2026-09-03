from contextlib import asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis
import structlog

from app.api.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import SessionLocal
from app.modules.identity.service import bootstrap_owner
from app.modules.hr_letters.seed import seed_hr_letter_templates
from app.modules.document_generator.seed import seed_qa_coa_template
from app.modules.assets.service import seed_asset_register

settings = get_settings()
logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    redis = Redis.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
    await redis.ping()
    app.state.redis = redis
    async with SessionLocal() as session:
        await bootstrap_owner(session)
        await seed_hr_letter_templates(session)
        try:
            await seed_qa_coa_template(session)
        except Exception as error:
            # The bundled QA master is convenience data, not a prerequisite for
            # serving requests. A storage or legacy-data problem must not make
            # the entire production API fail its health check.
            await session.rollback()
            logger.exception("qa_coa_template_seed_failed", error=str(error))
        await seed_asset_register(session)
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
