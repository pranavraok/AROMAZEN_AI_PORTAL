from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session

router = APIRouter()


@router.get("", summary="Verify API availability")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready", summary="Verify infrastructure dependencies")
async def readiness_check(db: AsyncSession = Depends(get_db_session)) -> dict[str, str]:
    await db.execute(text("SELECT 1"))
    return {"status": "ready", "database": "ok"}
