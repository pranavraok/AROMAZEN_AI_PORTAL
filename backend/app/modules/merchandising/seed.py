from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.identity.models import KnowledgeDocument, Organization, User
from app.modules.knowledge.department_uploads import DepartmentUpload, replace_department_master_templates
from app.modules.knowledge.templates import department_knowledge_collection


ASSET_DIR = Path(__file__).resolve().parents[2] / "assets" / "merchandising"
TEMPLATES = {
    "packing_list": ("packing-list.xlsx", "Packing List.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "hazardous_request": ("hazardous-cargo-request.xlsx", "Hazardous Cargo Request.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "imo_declaration": ("imo-dangerous-goods-declaration.xlsx", "IMO Dangerous Goods Declaration.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "multimodal_form": ("multimodal-dangerous-goods-form.docx", "Multimodal Dangerous Goods Form.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
}


async def seed_merchandising_templates(session: AsyncSession) -> None:
    for organization in list(await session.scalars(select(Organization))):
        collection = await department_knowledge_collection(session, organization.id, "merchandising")
        owner = await session.scalar(select(User).where(User.organization_id == organization.id).order_by(User.created_at))
        if collection is None or owner is None:
            continue
        for document_type, (asset_name, display_name, mime_type) in TEMPLATES.items():
            path = ASSET_DIR / asset_name
            if not path.is_file():
                continue
            source_key = f"merchandising-template:{document_type}"
            existing = await session.scalar(select(KnowledgeDocument).where(
                KnowledgeDocument.organization_id == organization.id,
                KnowledgeDocument.collection_id == collection.id,
                KnowledgeDocument.source_key == source_key,
            ))
            if existing:
                continue
            await replace_department_master_templates(session, owner, "merchandising", [DepartmentUpload(
                source_key=source_key,
                content=path.read_bytes(),
                original_filename=display_name,
                mime_type=mime_type,
                document_category=f"merchandising_template:{document_type}",
            )])

