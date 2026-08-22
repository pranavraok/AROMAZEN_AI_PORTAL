from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.identity.models import KnowledgeCollection, collection_departments

TEMPLATE_COLLECTION_SLUG = "portal-templates"
TEMPLATE_COLLECTION_NAME = "Portal Templates"
TEMPLATE_COLLECTION_DESCRIPTION = "System-managed source of truth for templates uploaded through the portal."


async def ensure_template_collection(
    session: AsyncSession,
    organization_id: uuid.UUID,
    *,
    created_by_user_id: uuid.UUID | None = None,
    department_id: uuid.UUID | None = None,
) -> KnowledgeCollection:
    """Return the organization's single predefined template collection, creating it if needed."""
    collection = await session.scalar(
        select(KnowledgeCollection).where(
            KnowledgeCollection.organization_id == organization_id,
            KnowledgeCollection.slug == TEMPLATE_COLLECTION_SLUG,
        )
    )
    if collection is None:
        collection = KnowledgeCollection(
            organization_id=organization_id,
            name=TEMPLATE_COLLECTION_NAME,
            slug=TEMPLATE_COLLECTION_SLUG,
            description=TEMPLATE_COLLECTION_DESCRIPTION,
            is_shared=False,
            status="active",
            created_by_user_id=created_by_user_id,
        )
        session.add(collection)
        await session.flush()
    else:
        collection.name = TEMPLATE_COLLECTION_NAME
        collection.description = TEMPLATE_COLLECTION_DESCRIPTION
        collection.is_shared = False
        collection.status = "active"
        collection.archived_at = None

    if department_id is not None:
        linked = await session.scalar(
            select(collection_departments.c.collection_id).where(
                collection_departments.c.collection_id == collection.id,
                collection_departments.c.department_id == department_id,
            )
        )
        if linked is None:
            await session.execute(
                collection_departments.insert().values(collection_id=collection.id, department_id=department_id)
            )
    return collection
