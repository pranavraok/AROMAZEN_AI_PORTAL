from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.identity.models import AuditEvent, KnowledgeChunk, KnowledgeDocument, User
from app.modules.knowledge.extraction import ExtractionError, extract_text
from app.modules.knowledge.storage import organized_storage_name, safe_storage_segment
from app.modules.knowledge.templates import department_knowledge_collection


@dataclass(frozen=True, slots=True)
class DepartmentUpload:
    source_key: str
    content: bytes
    original_filename: str
    mime_type: str | None = None
    document_category: str = "department_upload"


async def replace_department_uploads(
    session: AsyncSession,
    user: User,
    department_slug: str,
    uploads: list[DepartmentUpload],
) -> list[KnowledgeDocument]:
    """Atomically keep the latest copy of each departmental upload in its KB collection."""
    if not uploads:
        await session.commit()
        return []
    collection = await department_knowledge_collection(session, user.organization_id, department_slug)
    if collection is None:
        raise RuntimeError(f"The {department_slug} Knowledge Base collection is unavailable.")

    storage_root = Path(get_settings().upload_storage_path)
    new_paths: list[Path] = []
    replaced_paths: list[Path] = []
    documents: list[KnowledgeDocument] = []
    now = datetime.now(timezone.utc)
    try:
        for upload in uploads:
            source_key = upload.source_key.strip().lower()[:160]
            if not source_key or not upload.content:
                raise ValueError("Departmental uploads require a source key and non-empty content.")
            original_filename = Path(upload.original_filename or "upload.bin").name[:500]
            extension = Path(original_filename).suffix.lower()
            document = await session.scalar(select(KnowledgeDocument).where(
                KnowledgeDocument.organization_id == user.organization_id,
                KnowledgeDocument.collection_id == collection.id,
                KnowledgeDocument.source_key == source_key,
            ))
            if document is None and not source_key.startswith("document-generator-template:"):
                legacy_query = select(KnowledgeDocument).where(
                    KnowledgeDocument.organization_id == user.organization_id,
                    KnowledgeDocument.collection_id == collection.id,
                    KnowledgeDocument.source_key.is_(None),
                    KnowledgeDocument.document_category == upload.document_category,
                )
                if not upload.document_category.startswith("hr_letter_template:"):
                    legacy_query = legacy_query.where(KnowledgeDocument.original_filename == original_filename)
                legacy_documents = list(await session.scalars(legacy_query.order_by(KnowledgeDocument.version.desc(), KnowledgeDocument.created_at.desc())))
                if legacy_documents:
                    document = legacy_documents[0]
                    for duplicate in legacy_documents[1:]:
                        if duplicate.stored_filename and duplicate.stored_filename != "pending":
                            replaced_paths.append(storage_root / duplicate.stored_filename)
                        await session.delete(duplicate)
            if document is None:
                document = KnowledgeDocument(
                    organization_id=user.organization_id,
                    collection_id=collection.id,
                    uploaded_by_user_id=user.id,
                    original_filename=original_filename,
                    stored_filename="pending",
                    mime_type=None,
                    size_bytes=0,
                    version=0,
                    status="processing",
                    document_category=upload.document_category,
                    source_key=source_key,
                )
                session.add(document)
                await session.flush()
            elif document.stored_filename and document.stored_filename != "pending":
                replaced_paths.append(storage_root / document.stored_filename)

            version = document.version + 1
            stored_filename = organized_storage_name(
                "knowledge",
                user.organization_id,
                original_filename,
                category=f"{collection.slug}/department-uploads/{safe_storage_segment(source_key, 'upload')}",
                identifier=document.id,
                version=version,
            )
            destination = storage_root / stored_filename
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(upload.content)
            new_paths.append(destination)
            try:
                extraction_extension = ".xlsx" if extension == ".xlsm" else extension
                extracted = extract_text(destination, extraction_extension)
            except ExtractionError:
                extracted = ""

            await session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.document_id == document.id))
            document.uploaded_by_user_id = user.id
            document.original_filename = original_filename
            document.stored_filename = stored_filename
            document.mime_type = upload.mime_type or mimetypes.guess_type(original_filename)[0] or "application/octet-stream"
            document.size_bytes = len(upload.content)
            document.version = version
            document.status = "ready"
            document.extracted_text = extracted
            document.extracted_characters = len(extracted)
            document.processed_at = now
            document.document_category = upload.document_category
            document.source_key = source_key
            document.created_at = now
            documents.append(document)
            session.add(AuditEvent(
                organization_id=user.organization_id,
                actor_user_id=user.id,
                action="knowledge.department_upload_replaced" if version > 1 else "knowledge.department_upload_created",
                target_type="knowledge_document",
                target_id=str(document.id),
                metadata_json={
                    "department_slug": department_slug,
                    "collection_id": str(collection.id),
                    "source_key": source_key,
                    "filename": original_filename,
                    "version": version,
                },
            ))
        collection.updated_at = now
        await session.commit()
    except Exception:
        await session.rollback()
        for path in new_paths:
            path.unlink(missing_ok=True)
        raise

    current_paths = {path.resolve() for path in new_paths}
    for path in replaced_paths:
        if path.resolve() not in current_paths:
            path.unlink(missing_ok=True)
    return documents
