from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.identity.models import Department, KnowledgeCollection, KnowledgeDocument, collection_departments

LEGACY_TEMPLATE_COLLECTION_SLUG = "portal-templates"


async def department_knowledge_collection(
    session: AsyncSession,
    organization_id: uuid.UUID,
    department_slug: str,
) -> KnowledgeCollection | None:
    """Return the active KB collection automatically linked to a department."""
    department_slugs = [department_slug]
    if department_slug in {"hr", "human-resources"}:
        department_slugs = ["hr", "human-resources"]
    elif department_slug in {"qa", "quality-assurance"}:
        department_slugs = ["qa", "quality-assurance", "qa-qc", "qa-and-qc", "quality-assurance-quality-control"]
    return await session.scalar(
        select(KnowledgeCollection)
        .join(collection_departments, collection_departments.c.collection_id == KnowledgeCollection.id)
        .join(Department, Department.id == collection_departments.c.department_id)
        .where(
            KnowledgeCollection.organization_id == organization_id,
            KnowledgeCollection.status == "active",
            KnowledgeCollection.slug != LEGACY_TEMPLATE_COLLECTION_SLUG,
            Department.organization_id == organization_id,
            Department.slug.in_(department_slugs),
        )
        .order_by(KnowledgeCollection.created_at)
    )


async def cleanup_legacy_template_collection(session: AsyncSession, organization_id: uuid.UUID) -> None:
    """Move templates from the short-lived standalone collection back to their department KBs."""
    legacy = await session.scalar(select(KnowledgeCollection).where(
        KnowledgeCollection.organization_id == organization_id,
        KnowledgeCollection.slug == LEGACY_TEMPLATE_COLLECTION_SLUG,
    ))
    if legacy is None:
        return

    hr_collection = await department_knowledge_collection(session, organization_id, "hr")
    rnd_collection = await department_knowledge_collection(session, organization_id, "r-d")
    documents = list(await session.scalars(select(KnowledgeDocument).where(
        KnowledgeDocument.collection_id == legacy.id,
    )))
    for document in documents:
        category = document.document_category or ""
        if hr_collection and (category == "salary_slip_template" or category.startswith("hr_letter_template:")):
            document.collection_id = hr_collection.id
        elif rnd_collection and category == "document_template":
            document.collection_id = rnd_collection.id
        elif hr_collection:
            document.collection_id = hr_collection.id
        elif rnd_collection:
            document.collection_id = rnd_collection.id

    await session.flush()
    remaining = await session.scalar(select(func.count(KnowledgeDocument.id)).where(
        KnowledgeDocument.collection_id == legacy.id,
    ))
    if not remaining:
        await session.delete(legacy)
