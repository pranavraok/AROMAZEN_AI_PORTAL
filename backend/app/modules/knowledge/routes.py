import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.modules.identity.authorization import require_permissions
from app.core.config import get_settings
from app.modules.identity.models import Department, KnowledgeCollection, KnowledgeDocument, User, collection_departments
from app.modules.identity.service import role_keys_for_user
from app.modules.knowledge.extraction import ExtractionError, extract_text

router = APIRouter()
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".pptx"}


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
    query = select(KnowledgeCollection).where(KnowledgeCollection.organization_id == user.organization_id)
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
        result.append({"id": str(collection.id), "slug": collection.slug, "name": collection.name, "description": collection.description, "is_shared": collection.is_shared, "department_names": list(departments), "document_count": document_count or 0, "updated_at": collection.updated_at.isoformat()})
    return result


@router.get("/collections/{collection_id}/documents")
async def list_documents(collection_id: str, user: User = Depends(require_permissions("knowledge.read")), session: AsyncSession = Depends(get_db_session)) -> list[dict]:
    collection = await session.get(KnowledgeCollection, collection_id)
    if not collection or collection.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Collection not found.")
    if not await can_access_collection(session, user, collection):
        raise HTTPException(status_code=403, detail="You do not have access to this collection.")
    documents = await session.scalars(select(KnowledgeDocument).where(KnowledgeDocument.collection_id == collection.id).order_by(KnowledgeDocument.created_at.desc()))
    return [{"id": str(item.id), "name": item.original_filename, "status": item.status, "version": item.version, "size_bytes": item.size_bytes, "extracted_characters": item.extracted_characters, "created_at": item.created_at.isoformat(), "processed_at": item.processed_at.isoformat() if item.processed_at else None} for item in documents]


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


@router.post("/collections/{collection_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(collection_id: str, file: UploadFile = File(...), user: User = Depends(require_permissions("knowledge.write")), session: AsyncSession = Depends(get_db_session)) -> dict:
    collection = await session.get(KnowledgeCollection, collection_id)
    if not collection or collection.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Collection not found.")
    if not await can_access_collection(session, user, collection):
        raise HTTPException(status_code=403, detail="You cannot upload to this collection.")
    original_filename = Path(file.filename or "").name
    extension = Path(original_filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=422, detail="Only PDF, DOCX, XLSX, and PPTX files are allowed.")
    settings = get_settings()
    destination_root = Path(settings.upload_storage_path)
    destination_root.mkdir(parents=True, exist_ok=True)
    stored_filename = f"{uuid.uuid4()}{extension}"
    destination = destination_root / stored_filename
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
    previous_version = await session.scalar(select(func.max(KnowledgeDocument.version)).where(KnowledgeDocument.collection_id == collection.id, KnowledgeDocument.original_filename == original_filename))
    document = KnowledgeDocument(organization_id=user.organization_id, collection_id=collection.id, uploaded_by_user_id=user.id, original_filename=original_filename, stored_filename=stored_filename, mime_type=file.content_type, size_bytes=size_bytes, version=(previous_version or 0) + 1, status="processing")
    session.add(document)
    await session.commit()
    try:
        document.extracted_text = extract_text(destination, extension)
        document.extracted_characters = len(document.extracted_text)
        document.status = "ready"
        document.processed_at = datetime.now(timezone.utc)
        await session.commit()
    except ExtractionError:
        document.status = "failed"
        await session.commit()
        raise HTTPException(status_code=422, detail="The file was saved but could not be read. Please use a valid, unprotected document.")
    return {"id": str(document.id), "name": document.original_filename, "status": document.status, "version": document.version, "size_bytes": document.size_bytes, "extracted_characters": document.extracted_characters}
