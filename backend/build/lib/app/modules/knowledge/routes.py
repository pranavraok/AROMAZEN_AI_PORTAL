import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.modules.identity.authorization import require_permissions
from app.core.config import get_settings
from app.modules.identity.models import Department, KnowledgeCollection, KnowledgeDocument, User, collection_departments
from app.modules.identity.service import role_keys_for_user
from app.modules.knowledge.extraction import ExtractionError, extract_text
from app.modules.knowledge.storage import organized_storage_name, safe_storage_segment
from app.modules.notifications.service import create_knowledge_upload_notifications

router = APIRouter()
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".pptx"}
RULE_DOCUMENT_CATEGORIES = ["attendance_rule", "leave_rule", "hr_policy"]


class DocumentReminderUpdate(BaseModel):
    document_category: str | None = Field(default=None, max_length=80)
    expiry_date: datetime | None = None
    reminder_days_before: int = Field(default=30, ge=0, le=365)
    reminder_owner: str | None = Field(default=None, max_length=160)
    is_company_wide: bool | None = Field(default=None)


class DocumentRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=500)


def _renamed_filename(current_name: str, requested_name: str) -> str:
    name = requested_name.strip()
    if not name or name in {".", ".."} or any(char in name for char in '\\/:*?"<>|') or any(ord(char) < 32 for char in name):
        raise HTTPException(status_code=422, detail="Enter a valid file name.")

    current_extension = Path(current_name).suffix
    requested_extension = Path(name).suffix
    if requested_extension and requested_extension.lower() != current_extension.lower():
        raise HTTPException(status_code=422, detail=f"The file type must remain {current_extension or 'unchanged'}.")
    if current_extension and not requested_extension:
        name = f"{name}{current_extension}"
    if len(name) > 500:
        raise HTTPException(status_code=422, detail="The file name must be 500 characters or fewer.")
    return name


def _document_response(item: KnowledgeDocument) -> dict:
    return {
        "id": str(item.id), "name": item.original_filename, "status": item.status,
        "version": item.version, "size_bytes": item.size_bytes,
        "extracted_characters": item.extracted_characters,
        "document_category": item.document_category,
        "source_key": item.source_key,
        "external_edit_url": item.external_edit_url,
        "expiry_date": item.expiry_date.isoformat() if item.expiry_date else None,
        "reminder_days_before": item.reminder_days_before,
        "reminder_owner": item.reminder_owner,
        "is_company_wide": item.is_company_wide,
        "created_at": item.created_at.isoformat(),
        "processed_at": item.processed_at.isoformat() if item.processed_at else None,
    }


async def can_access_collection(session: AsyncSession, user: User, collection: KnowledgeCollection) -> bool:
    role_keys = await role_keys_for_user(session, user.id)
    if role_keys.intersection({"owner", "super_admin"}) or collection.is_shared:
        return True
    if not user.department_id:
        return False
    return bool(await session.scalar(select(collection_departments.c.collection_id).where(collection_departments.c.collection_id == collection.id, collection_departments.c.department_id == user.department_id)))


@router.get("/collections")
async def list_collections(user: User = Depends(require_permissions("knowledge.read")), session: AsyncSession = Depends(get_db_session)) -> list[dict]:
    role_keys = await role_keys_for_user(session, user.id)
    query = select(KnowledgeCollection).where(KnowledgeCollection.organization_id == user.organization_id, KnowledgeCollection.status == "active")
    if not role_keys.intersection({"owner", "super_admin"}):
        if user.department_id:
            query = query.outerjoin(collection_departments, KnowledgeCollection.id == collection_departments.c.collection_id).where(or_(KnowledgeCollection.is_shared.is_(True), collection_departments.c.department_id == user.department_id))
        else:
            query = query.where(KnowledgeCollection.is_shared.is_(True))
    collections = await session.scalars(query.order_by(KnowledgeCollection.name))
    result = []
    for collection in collections.unique():
        departments = await session.scalars(select(Department.name).join(collection_departments, Department.id == collection_departments.c.department_id).where(collection_departments.c.collection_id == collection.id))
        document_count = await session.scalar(select(func.count(KnowledgeDocument.id)).where(KnowledgeDocument.collection_id == collection.id))
        # Per-category document counts for this collection.
        cat_rows = (await session.execute(
            select(KnowledgeDocument.document_category, func.count(KnowledgeDocument.id))
            .where(KnowledgeDocument.collection_id == collection.id)
            .group_by(KnowledgeDocument.document_category)
        )).all()
        category_counts = {row[0] or 'general': row[1] for row in cat_rows}
        result.append({"id": str(collection.id), "slug": collection.slug, "name": collection.name, "description": collection.description, "is_shared": collection.is_shared, "department_names": list(departments), "document_count": document_count or 0, "category_counts": category_counts, "updated_at": collection.updated_at.isoformat()})
    return result


@router.get("/collections/{collection_id}/documents")
async def list_documents(collection_id: str, user: User = Depends(require_permissions("knowledge.read")), session: AsyncSession = Depends(get_db_session)) -> list[dict]:
    collection = await session.get(KnowledgeCollection, collection_id)
    if not collection or collection.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Collection not found.")
    if not await can_access_collection(session, user, collection):
        raise HTTPException(status_code=403, detail="You do not have access to this collection.")
    documents = await session.scalars(select(KnowledgeDocument).where(KnowledgeDocument.collection_id == collection.id).order_by(KnowledgeDocument.created_at.desc()))
    return [_document_response(item) for item in documents]


@router.patch("/collections/{collection_id}/documents/{document_id}/name")
async def rename_document(
    collection_id: str,
    document_id: str,
    payload: DocumentRenameRequest,
    user: User = Depends(require_permissions("knowledge.write")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    collection = await session.get(KnowledgeCollection, collection_id)
    document = await session.get(KnowledgeDocument, document_id)
    if not collection or not document or document.collection_id != collection.id or collection.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Document not found.")
    if not await can_access_collection(session, user, collection):
        raise HTTPException(status_code=403, detail="You cannot rename this document.")

    document.original_filename = _renamed_filename(document.original_filename, payload.name)
    collection.updated_at = datetime.now(timezone.utc)
    await session.commit()
    return _document_response(document)


@router.patch("/collections/{collection_id}/documents/{document_id}/reminder")
async def update_document_reminder(
    collection_id: str,
    document_id: str,
    payload: DocumentReminderUpdate,
    user: User = Depends(require_permissions("knowledge.write")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    collection = await session.get(KnowledgeCollection, collection_id)
    document = await session.get(KnowledgeDocument, document_id)
    if not collection or not document or document.collection_id != collection.id or collection.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Document not found.")
    if not await can_access_collection(session, user, collection):
        raise HTTPException(status_code=403, detail="You cannot update this document.")
    document.document_category = payload.document_category.strip() if payload.document_category else None
    document.expiry_date = payload.expiry_date
    document.reminder_days_before = payload.reminder_days_before
    document.reminder_owner = payload.reminder_owner.strip() if payload.reminder_owner else None
    if payload.is_company_wide is not None:
        document.is_company_wide = payload.is_company_wide
    await session.commit()
    return _document_response(document)


@router.get("/collections/{collection_id}/documents/{document_id}/content")
async def view_document(collection_id: str, document_id: str, user: User = Depends(require_permissions("knowledge.read")), session: AsyncSession = Depends(get_db_session)) -> FileResponse:
    collection = await session.get(KnowledgeCollection, collection_id)
    document = await session.get(KnowledgeDocument, document_id)
    if not collection or not document or document.collection_id != collection.id or collection.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Document not found.")
    if not await can_access_collection(session, user, collection):
        raise HTTPException(status_code=403, detail="You do not have access to this document.")
    path = Path(get_settings().upload_storage_path) / document.stored_filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="The stored file is unavailable.")
    return FileResponse(path, media_type=document.mime_type or "application/octet-stream", filename=document.original_filename, content_disposition_type="inline")


@router.post("/collections/{collection_id}/documents/{document_id}/process")
async def process_existing_document(collection_id: str, document_id: str, user: User = Depends(require_permissions("knowledge.write")), session: AsyncSession = Depends(get_db_session)) -> dict:
    collection = await session.get(KnowledgeCollection, collection_id)
    document = await session.get(KnowledgeDocument, document_id)
    if not collection or not document or document.collection_id != collection.id or collection.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Document not found.")
    if not await can_access_collection(session, user, collection):
        raise HTTPException(status_code=403, detail="You cannot process documents in this collection.")
    document.status = "processing"
    await session.commit()
    try:
        document.extracted_text = extract_text(Path(get_settings().upload_storage_path) / document.stored_filename, Path(document.original_filename).suffix.lower())
        document.extracted_characters = len(document.extracted_text)
        document.status = "ready"
        document.processed_at = datetime.now(timezone.utc)
        await session.commit()
    except ExtractionError:
        document.status = "failed"
        await session.commit()
        raise HTTPException(status_code=422, detail="The file could not be read. Please upload a valid, unprotected document.")
    return {"id": str(document.id), "status": document.status, "extracted_characters": document.extracted_characters}


@router.get("/rules-and-reminders")
async def rules_and_reminders(user: User = Depends(require_permissions("knowledge.read")), session: AsyncSession = Depends(get_db_session)) -> list[dict]:
    """Return rule/HR documents visible to the current user.

    A document is visible when:
    1. Its collection is accessible to the user (shared or department-matched), AND
    2. Its document_category is in the rules set (attendance_rule, leave_rule, hr_policy), AND
    3. Either it is NOT company-wide, or it IS company-wide (company-wide overrides department restrictions).
    """
    role_keys = await role_keys_for_user(session, user.id)
    is_admin = bool(role_keys.intersection({"owner", "super_admin", "department_admin"}))

    # Base query: documents with rule categories in active collections for this org.
    base_filters = [
        KnowledgeDocument.organization_id == user.organization_id,
        KnowledgeDocument.status == "ready",
        KnowledgeDocument.document_category.in_(RULE_DOCUMENT_CATEGORIES),
        KnowledgeCollection.status == "active",
    ]

    if is_admin:
        # Admins see all rule documents in the org.
        query = (
            select(KnowledgeDocument, KnowledgeCollection.name.label("collection_name"))
            .join(KnowledgeCollection, KnowledgeDocument.collection_id == KnowledgeCollection.id)
            .where(*base_filters)
        )
    elif user.department_id:
        # Non-admin: see company-wide docs, shared collection docs, or docs in own department's collection.
        dept_collection_ids = select(collection_departments.c.collection_id).where(
            collection_departments.c.department_id == user.department_id
        )
        access_filter = or_(
            KnowledgeDocument.is_company_wide.is_(True),
            KnowledgeCollection.is_shared.is_(True),
            KnowledgeCollection.id.in_(dept_collection_ids),
        )
        query = (
            select(KnowledgeDocument, KnowledgeCollection.name.label("collection_name"))
            .join(KnowledgeCollection, KnowledgeDocument.collection_id == KnowledgeCollection.id)
            .where(*base_filters, access_filter)
        )
    else:
        # No department: only company-wide or shared collection docs.
        query = (
            select(KnowledgeDocument, KnowledgeCollection.name.label("collection_name"))
            .join(KnowledgeCollection, KnowledgeDocument.collection_id == KnowledgeCollection.id)
            .where(*base_filters, or_(KnowledgeDocument.is_company_wide.is_(True), KnowledgeCollection.is_shared.is_(True)))
        )

    rows = (await session.execute(query.order_by(KnowledgeDocument.created_at.desc()))).all()
    return [_document_response(doc) | {"collection_id": str(doc.collection_id), "collection_name": col_name} for doc, col_name in rows]


@router.post("/collections/{collection_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(
    collection_id: str,
    file: UploadFile = File(...),
    document_category: str = Form(""),
    expiry_date: str = Form(""),
    reminder_days_before: int = Form(30),
    reminder_owner: str = Form(""),
    is_company_wide: bool = Form(False),
    user: User = Depends(require_permissions("knowledge.write")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    collection = await session.get(KnowledgeCollection, collection_id)
    if not collection or collection.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Collection not found.")
    if not await can_access_collection(session, user, collection):
        raise HTTPException(status_code=403, detail="You cannot upload to this collection.")
    original_filename = Path(file.filename or "").name
    extension = Path(original_filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=422, detail="Only PDF, DOCX, XLSX, and PPTX files are allowed.")
    normalized_category = document_category.strip() or "general"
    if normalized_category == "document_template":
        if extension != ".docx":
            raise HTTPException(status_code=422, detail="Document templates must be uploaded as DOCX files.")
    settings = get_settings()
    destination_root = Path(settings.upload_storage_path)
    destination_root.mkdir(parents=True, exist_ok=True)
    previous_documents = list(await session.scalars(select(KnowledgeDocument).where(
        KnowledgeDocument.organization_id == user.organization_id,
        KnowledgeDocument.collection_id == collection.id,
        KnowledgeDocument.document_category == normalized_category,
        KnowledgeDocument.original_filename == original_filename,
    )))
    previous_version = await session.scalar(select(func.max(KnowledgeDocument.version)).where(KnowledgeDocument.collection_id == collection.id, KnowledgeDocument.original_filename == original_filename))
    document_id = uuid.uuid4()
    stored_filename = organized_storage_name(
        "templates" if normalized_category == "document_template" else "knowledge",
        user.organization_id,
        original_filename,
        category=(
            "document-generator"
            if normalized_category == "document_template"
            else f"{collection.slug}/{safe_storage_segment(normalized_category, 'general')}"
        ),
        identifier=document_id,
        version=(previous_version or 0) + 1,
    )
    destination = destination_root / stored_filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    size_bytes = 0
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size_bytes += len(chunk)
                if size_bytes > settings.max_upload_size_mb * 1024 * 1024:
                    raise HTTPException(status_code=413, detail=f"File exceeds the {settings.max_upload_size_mb} MB limit.")
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    try:
        parsed_expiry = datetime.fromisoformat(expiry_date).replace(tzinfo=timezone.utc) if expiry_date else None
    except ValueError as error:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="Expiry date must use YYYY-MM-DD.") from error
    if reminder_days_before < 0 or reminder_days_before > 365:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="Reminder notice must be between 0 and 365 days.")
    document = KnowledgeDocument(
        id=document_id,
        organization_id=user.organization_id, collection_id=collection.id,
        uploaded_by_user_id=user.id, original_filename=original_filename,
        stored_filename=stored_filename, mime_type=file.content_type,
        size_bytes=size_bytes, version=(previous_version or 0) + 1, status="processing",
        document_category=normalized_category, expiry_date=parsed_expiry,
        reminder_days_before=reminder_days_before, reminder_owner=reminder_owner.strip() or None,
        is_company_wide=is_company_wide,
    )
    session.add(document)
    await session.commit()
    try:
        document.extracted_text = extract_text(destination, extension)
        document.extracted_characters = len(document.extracted_text)
        document.status = "ready"
        document.processed_at = datetime.now(timezone.utc)
        for previous in previous_documents:
            await session.delete(previous)
        await create_knowledge_upload_notifications(
            session,
            document=document,
            collection=collection,
            actor=user,
        )
        await session.commit()
        for previous in previous_documents:
            (destination_root / previous.stored_filename).unlink(missing_ok=True)
    except ExtractionError:
        document.status = "failed"
        await session.commit()
        raise HTTPException(status_code=422, detail="The file was saved but could not be read. Please use a valid, unprotected document.")
    return _document_response(document)
