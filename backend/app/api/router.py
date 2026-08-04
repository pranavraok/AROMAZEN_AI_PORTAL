from fastapi import APIRouter

from app.api.v1.health import router as health_router
from app.modules.identity.routes import router as identity_router
from app.modules.identity.admin_routes import router as admin_router

api_router = APIRouter()
api_router.include_router(health_router, prefix="/health", tags=["health"])
api_router.include_router(identity_router, prefix="/auth", tags=["authentication"])
api_router.include_router(admin_router, prefix="/admin", tags=["administration"])
