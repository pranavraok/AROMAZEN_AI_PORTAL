from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.identity.models import KnowledgeCollection, KnowledgeDocument, Organization, User
from app.modules.knowledge.extraction import extract_text

ASSET_ROOT = Path(__file__).resolve().parents[2] / "assets" / "hr_letters"


async def seed_hr_letter_templates(session: AsyncSession) -> None:
    organizations = list(await session.scalars(select(Organization)))
    storage = Path(get_settings().upload_storage_path)
    storage.mkdir(parents=True, exist_ok=True)
    for organization in organizations:
        collection = await session.scalar(select(KnowledgeCollection).where(KnowledgeCollection.organization_id == organization.id, KnowledgeCollection.slug == "hr"))
        if not collection:
            continue
        owner = await session.scalar(select(User).where(User.organization_id == organization.id).order_by(User.created_at))
        for asset in ASSET_ROOT.iterdir():
            display_name = asset.name.replace("-template", " Template").replace("-", " ").title().replace(".Docx", ".docx").replace(".Pdf", ".pdf")
            exists = await session.scalar(select(KnowledgeDocument.id).where(KnowledgeDocument.collection_id == collection.id, KnowledgeDocument.original_filename == display_name))
            if exists:
                continue
            stored_name = f"hr-template-{organization.id}-{asset.name}"
            destination = storage / stored_name
            shutil.copy2(asset, destination)
            extension = asset.suffix.lower()
            extracted = extract_text(destination, extension)
            session.add(KnowledgeDocument(organization_id=organization.id, collection_id=collection.id, uploaded_by_user_id=owner.id if owner else None, original_filename=display_name, stored_filename=stored_name, mime_type="application/pdf" if extension == ".pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size_bytes=destination.stat().st_size, version=1, status="ready", extracted_text=extracted, extracted_characters=len(extracted), processed_at=datetime.now(timezone.utc)))
    await session.commit()
