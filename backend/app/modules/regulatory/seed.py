from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.identity.models import KnowledgeDocument, Organization, User
from app.modules.knowledge.department_uploads import DepartmentUpload, replace_department_master_templates
from app.modules.knowledge.templates import department_knowledge_collection

ASSET_DIR = Path(__file__).resolve().parents[2] / "templates" / "regulatory"
TEMPLATES = {
    "sds": ("sds.docx", "Safety Data Sheet.docx"),
    "ifra_certificate": ("ifra-certificate.docx", "IFRA Certificate.docx"),
    "ifra_amendment": ("ifra-amendment.docx", "IFRA Amendment.docx"),
    "allergen_report": ("allergen-report.docx", "Allergen Report.docx"),
    "reach_declaration": ("reach-declaration.docx", "REACH Declaration.docx"),
}


async def seed_regulatory_templates(session: AsyncSession) -> None:
    for organization in list(await session.scalars(select(Organization))):
        collection = await department_knowledge_collection(session, organization.id, "regulatory")
        owner = await session.scalar(select(User).where(User.organization_id == organization.id).order_by(User.created_at))
        if collection is None or owner is None:
            continue
        for document_type, (asset_name, display_name) in TEMPLATES.items():
            path = ASSET_DIR / asset_name
            if not path.is_file():
                continue
            source_key = f"regulatory-template:{document_type}"
            existing = await session.scalar(select(KnowledgeDocument).where(
                KnowledgeDocument.organization_id == organization.id,
                KnowledgeDocument.collection_id == collection.id,
                KnowledgeDocument.source_key == source_key,
            ))
            if existing:
                continue
            await replace_department_master_templates(session, owner, "regulatory", [DepartmentUpload(
                source_key, path.read_bytes(), display_name,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                document_category=f"regulatory_template:{document_type}",
            )])
