from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.document_generator.routes import QA_COA_CANVA_URL, QA_COA_MASTER_SOURCE
from app.modules.identity.models import KnowledgeDocument, Organization, User
from app.modules.knowledge.department_uploads import DepartmentUpload, replace_department_uploads
from app.modules.knowledge.templates import department_knowledge_collection


ASSET_PATH = Path(__file__).resolve().parents[2] / "assets" / "qa" / "coa-master.docx"


async def seed_qa_coa_template(session: AsyncSession) -> None:
    if not ASSET_PATH.is_file():
        return
    for organization in list(await session.scalars(select(Organization))):
        collection = await department_knowledge_collection(session, organization.id, "quality-assurance")
        if collection is None:
            continue
        existing = await session.scalar(select(KnowledgeDocument).where(
            KnowledgeDocument.organization_id == organization.id,
            KnowledgeDocument.collection_id == collection.id,
            KnowledgeDocument.source_key == QA_COA_MASTER_SOURCE,
        ))
        if existing:
            if existing.external_edit_url != QA_COA_CANVA_URL:
                existing.external_edit_url = QA_COA_CANVA_URL
                await session.commit()
            continue
        owner = await session.scalar(select(User).where(User.organization_id == organization.id).order_by(User.created_at))
        if owner is None:
            continue
        document = (await replace_department_uploads(session, owner, "quality-assurance", [DepartmentUpload(
            QA_COA_MASTER_SOURCE,
            ASSET_PATH.read_bytes(),
            "AROMAZEN COA Master.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            document_category="document_template",
        )]))[0]
        document.external_edit_url = QA_COA_CANVA_URL
        await session.commit()
