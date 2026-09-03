from __future__ import annotations

import shutil
import uuid
from hashlib import sha256
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.identity.models import KnowledgeDocument, Organization, User
from app.modules.knowledge.extraction import extract_text
from app.modules.knowledge.storage import organized_storage_name
from app.modules.knowledge.templates import cleanup_legacy_template_collection, department_knowledge_collection

ASSET_ROOT = Path(__file__).resolve().parents[2] / "assets" / "hr_letters"
TEMPLATE_KEYS = {
    "offer-template.pdf": "offer",
    "appointment-template.docx": "appointment",
    "spot-appreciation-template.docx": "spot_appreciation",
    "special-increment-template.docx": "special_increment",
}
LEGACY_STARTER_HASHES = {
    "appointment-template.docx": "30BEE1D4A95ABBAF5DD1475D5C785927152072F245EC5289FE8370E76BB19DCA",
    "spot-appreciation-template.docx": "4D923592B496E843A3E1A375F308FDD7098B1BCD25F0AAF102BE8E787EE93E4C",
    "special-increment-template.docx": "F0D5ABB3B89D2496D799736040677FA2B3DFD2C9998DD64E024EA0F8895163CF",
}


async def seed_hr_letter_templates(session: AsyncSession) -> None:
    organizations = list(await session.scalars(select(Organization)))
    storage = Path(get_settings().upload_storage_path)
    storage.mkdir(parents=True, exist_ok=True)
    for organization in organizations:
        owner = await session.scalar(select(User).where(User.organization_id == organization.id).order_by(User.created_at))
        await cleanup_legacy_template_collection(session, organization.id)
        collection = await department_knowledge_collection(session, organization.id, "hr")
        if collection is None:
            continue
        for asset in ASSET_ROOT.iterdir():
            display_name = asset.name.replace("-template", " Template").replace("-", " ").title().replace(".Docx", ".docx").replace(".Pdf", ".pdf")
            category = f"hr_letter_template:{TEMPLATE_KEYS[asset.name]}"
            exists = await session.scalar(
                select(KnowledgeDocument)
                .where(
                    KnowledgeDocument.organization_id == organization.id,
                    KnowledgeDocument.document_category == category,
                )
                .order_by(KnowledgeDocument.version.desc(), KnowledgeDocument.created_at.desc())
            )
            if exists:
                exists.collection_id = collection.id
                existing_path = storage / exists.stored_filename
                legacy_hash = LEGACY_STARTER_HASHES.get(asset.name)
                if (
                    legacy_hash
                    and exists.version == 1
                    and existing_path.is_file()
                    and sha256(existing_path.read_bytes()).hexdigest().upper() == legacy_hash
                ):
                    shutil.copy2(asset, existing_path)
                    extension = asset.suffix.lower()
                    extracted = extract_text(existing_path, extension)
                    exists.size_bytes = existing_path.stat().st_size
                    exists.extracted_text = extracted
                    exists.extracted_characters = len(extracted)
                    exists.processed_at = datetime.now(timezone.utc)
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
