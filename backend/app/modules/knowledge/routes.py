from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.modules.identity.authorization import require_permissions
from app.modules.identity.models import Department, KnowledgeCollection, User, collection_departments
from app.modules.identity.service import role_keys_for_user

router = APIRouter()


@router.get("/collections")
async def list_collections(user: User = Depends(require_permissions("knowledge.read")), session: AsyncSession = Depends(get_db_session)) -> list[dict]:
    role_keys = await role_keys_for_user(session, user.id)
    query = select(KnowledgeCollection).where(KnowledgeCollection.organization_id == user.organization_id)
    if not role_keys.intersection({"owner", "super_admin"}):
        if user.department_id:
            query = query.outerjoin(collection_departments, KnowledgeCollection.id == collection_departments.c.collection_id).where(or_(KnowledgeCollection.is_shared.is_(True), collection_departments.c.department_id == user.department_id))
        else:
            query = query.where(KnowledgeCollection.is_shared.is_(True))
    collections = await session.scalars(query.order_by(KnowledgeCollection.name))
    result = []
    for collection in collections.unique():
        departments = await session.scalars(select(Department.name).join(collection_departments, Department.id == collection_departments.c.department_id).where(collection_departments.c.collection_id == collection.id))
        result.append({"id": str(collection.id), "slug": collection.slug, "name": collection.name, "description": collection.description, "is_shared": collection.is_shared, "department_names": list(departments), "document_count": 0, "updated_at": collection.updated_at.isoformat()})
    return result
