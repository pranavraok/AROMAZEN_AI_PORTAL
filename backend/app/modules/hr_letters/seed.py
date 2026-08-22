from __future__ import annotations

import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.identity.models import Department, KnowledgeDocument, Organization, User
from app.modules.knowledge.extraction import extract_text
from app.modules.knowledge.storage import organized_storage_name
from app.modules.knowledge.templates import ensure_template_collection

ASSET_ROOT = Path(__file__).resolve().parents[2] / "assets" / "hr_letters"
TEMPLATE_KEYS = {
    "offer-template.pdf": "offer",
    "appointment-template.docx": "appointment",
    "spot-appreciation-template.docx": "spot_appreciation",
    "special-increment-template.docx": "special_increment",
}


async def seed_hr_letter_templates(session: AsyncSession) -> None:
    organizations = list(await session.scalars(select(Organization)))
    storage = Path(get_settings().upload_storage_path)
    storage.mkdir(parents=True, exist_ok=True)
    for organization in organizations:
        owner = await session.scalar(select(User).where(User.organization_id == organization.id).order_by(User.created_at))
        template_departments = list(await session.scalars(select(Department).where(
            Department.organization_id == organization.id,
            Department.slug.in_(["hr", "r-d"]),
        )))
        collection = await ensure_template_collection(
            session,
            organization.id,
            created_by_user_id=owner.id if owner else None,
            department_id=template_departments[0].id if template_departments else None,
        )
        for department in template_departments[1:]:
            await ensure_template_collection(session, organization.id, department_id=department.id)
        for asset in ASSET_ROOT.iterdir():
            display_name = asset.name.replace("-template", " Template").replace("-", " ").title().replace(".Docx", ".docx").replace(".Pdf", ".pdf")
            category = f"hr_letter_template:{TEMPLATE_KEYS[asset.name]}"
            exists = await session.scalar(select(KnowledgeDocument).where(KnowledgeDocument.organization_id == organization.id, KnowledgeDocument.document_category == category))
            if exists:
                exists.collection_id = collection.id
                continue
            document_id = uuid.uuid4()
            stored_name = organized_storage_name(
                "templates",
                organization.id,
                display_name,
                category=f"hr-letters/{TEMPLATE_KEYS[asset.name]}",
                identifier=document_id,
                version=1,
            )
            destination = storage / stored_name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(asset, destination)
            extension = asset.suffix.lower()
            extracted = extract_text(destination, extension)
            session.add(KnowledgeDocument(id=document_id, organization_id=organization.id, collection_id=collection.id, uploaded_by_user_id=owner.id if owner else None, original_filename=display_name, stored_filename=stored_name, mime_type="application/pdf" if extension == ".pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size_bytes=destination.stat().st_size, version=1, status="ready", extracted_text=extracted, extracted_characters=len(extracted), processed_at=datetime.now(timezone.utc), document_category=category))
    await session.commit()
