from __future__ import annotations

import io
import json
import mimetypes
import re
import shutil
import subprocess
import uuid
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db_session
from app.modules.identity.authorization import require_department, require_permissions
from app.modules.identity.models import AuditEvent, DocumentGeneration, KnowledgeDocument, User
from app.modules.knowledge.department_uploads import DepartmentUpload, replace_department_master_templates
from app.modules.knowledge.storage import organized_storage_name
from app.modules.merchandising.engine import (
    DOCUMENT_TYPES,
    FIELD_DEFINITIONS,
    extract_fields,
    generate_document,
    missing_required,
)


router = APIRouter(dependencies=[Depends(require_department("merchandising"))])
EXCEL_TYPES = {"packing_list", "hazardous_request", "imo_declaration"}
MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class GenerateRequest(BaseModel):
    fields: dict[str, str] = Field(default_factory=dict)


def _template_payload(document: KnowledgeDocument, document_type: str) -> dict:
    return {
        "id": str(document.id),
        "document_type": document_type,
        "title": DOCUMENT_TYPES[document_type],
        "name": document.original_filename,
        "version": document.version,
    }


async def _templates(session: AsyncSession, user: User) -> dict[str, KnowledgeDocument]:
    documents = list(await session.scalars(select(KnowledgeDocument).where(
        KnowledgeDocument.organization_id == user.organization_id,
        KnowledgeDocument.source_key.like("merchandising-template:%"),
        KnowledgeDocument.status == "ready",
    )))
    return {
        str(document.source_key).split(":", 1)[1]: document
        for document in documents
        if document.source_key and str(document.source_key).split(":", 1)[1] in DOCUMENT_TYPES
    }


def _safe_stem(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "-", value).strip("-")[:80] or "export"


def _converted_xlsx(content: bytes, filename: str) -> tuple[bytes, str]:
    if Path(filename).suffix.lower() != ".xls":
        return content, filename
    executable = shutil.which("soffice") or shutil.which("libreoffice")
    if not executable:
        raise HTTPException(status_code=422, detail="Legacy XLS masters must be saved as XLSX before upload on this server.")
    with TemporaryDirectory(prefix="merchandising-xls-") as directory:
        source = Path(directory) / Path(filename).name
        source.write_bytes(content)
        result = subprocess.run(
            [executable, "--headless", "--convert-to", "xlsx", "--outdir", directory, str(source)],
            capture_output=True,
            check=False,
            timeout=90,
        )
        converted = Path(directory) / f"{source.stem}.xlsx"
        if result.returncode != 0 or not converted.is_file():
            raise HTTPException(status_code=422, detail="The legacy XLS master could not be converted. Save it as XLSX and try again.")
        return converted.read_bytes(), converted.name


async def _read_upload(file: UploadFile, limit_mb: int) -> bytes:
    content = await file.read(limit_mb * 1024 * 1024 + 1)
    if len(content) > limit_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="The uploaded file exceeds the permitted size.")
    if not content:
        raise HTTPException(status_code=422, detail="The uploaded file is empty.")
    return content


def _output_filename(document_type: str, fields: dict[str, str]) -> str:
    stem = _safe_stem(fields.get("product_name", "export"))
    labels = {
        "packing_list": "Packing-List",
        "hazardous_request": "Hazardous-Cargo-Request",
        "imo_declaration": "IMO-Dangerous-Goods-Declaration",
        "multimodal_form": "Multimodal-Dangerous-Goods-Form",
    }
    extension = ".docx" if document_type == "multimodal_form" else ".xlsx"
    return f"{stem}-{labels[document_type]}{extension}"


def _clean_fields(fields: dict[str, str]) -> dict[str, str]:
    allowed = {item["key"] for item in FIELD_DEFINITIONS}
    return {str(key): str(value).strip()[:5000] for key, value in fields.items() if key in allowed}


@router.get("/schema")
async def schema(user: User = Depends(require_permissions("knowledge.read"))) -> dict:
    return {"fields": FIELD_DEFINITIONS, "document_types": [{"key": key, "title": title} for key, title in DOCUMENT_TYPES.items()]}


@router.get("/templates")
async def list_templates(user: User = Depends(require_permissions("knowledge.read")), session: AsyncSession = Depends(get_db_session)) -> list[dict]:
    templates = await _templates(session, user)
    return [_template_payload(templates[key], key) for key in DOCUMENT_TYPES if key in templates]


@router.post("/templates/{document_type}")
async def replace_template(
    document_type: str,
    template_file: UploadFile = File(...),
    user: User = Depends(require_permissions("knowledge.write")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    if document_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=404, detail="Merchandising master type not found.")
    filename = Path(template_file.filename or "template").name
    suffix = Path(filename).suffix.lower()
    expected = {".xlsx", ".xlsm", ".xls"} if document_type in EXCEL_TYPES else {".docx"}
    if suffix not in expected:
        raise HTTPException(status_code=422, detail="Choose the matching Excel or Word master for this document.")
    content = await _read_upload(template_file, get_settings().max_excel_upload_size_mb if document_type in EXCEL_TYPES else get_settings().max_upload_size_mb)
    if document_type in EXCEL_TYPES:
        content, filename = _converted_xlsx(content, filename)
    try:
        detected, _ = extract_fields(content, filename)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if detected != document_type:
        raise HTTPException(status_code=422, detail=f"This file looks like {DOCUMENT_TYPES.get(detected, detected)}, not {DOCUMENT_TYPES[document_type]}.")
    document = (await replace_department_master_templates(session, user, "merchandising", [DepartmentUpload(
        source_key=f"merchandising-template:{document_type}",
        content=content,
        original_filename=filename,
        mime_type=MIME_XLSX if document_type in EXCEL_TYPES else MIME_DOCX,
        document_category=f"merchandising_template:{document_type}",
    )]))[0]
    return _template_payload(document, document_type)


@router.get("/templates/{document_type}/content")
async def template_content(
    document_type: str,
    user: User = Depends(require_permissions("knowledge.read")),
    session: AsyncSession = Depends(get_db_session),
) -> FileResponse:
    document = (await _templates(session, user)).get(document_type)
    if not document:
        raise HTTPException(status_code=404, detail="Merchandising master not found.")
    return FileResponse(Path(get_settings().upload_storage_path) / document.stored_filename, filename=document.original_filename, media_type=document.mime_type)


@router.post("/extract")
async def extract_source(
    source_file: UploadFile = File(...),
    user: User = Depends(require_permissions("ai.workspace.use", "knowledge.read")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    filename = Path(source_file.filename or "source").name
    suffix = Path(filename).suffix.lower()
    if suffix not in {".xls", ".xlsx", ".xlsm", ".docx"}:
        raise HTTPException(status_code=422, detail="Choose one of the approved Merchandising Excel or Word documents.")
    content = await _read_upload(source_file, get_settings().max_excel_upload_size_mb if suffix in {".xls", ".xlsx", ".xlsm"} else get_settings().max_upload_size_mb)
    try:
        detected_type, source_fields = extract_fields(content, filename)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    defaults: dict[str, str] = {}
    templates = await _templates(session, user)
    storage = Path(get_settings().upload_storage_path)
    for document_type in DOCUMENT_TYPES:
        template = templates.get(document_type)
        if template is None:
            continue
        try:
            _, values = extract_fields((storage / template.stored_filename).read_bytes(), template.original_filename)
        except (OSError, ValueError):
            continue
        for key, value in values.items():
            if value:
                defaults.setdefault(key, value)
    fields = {**defaults, **source_fields}
    return {
        "source_name": filename,
        "detected_type": detected_type,
        "fields": fields,
        "missing_required": missing_required(fields),
        "warnings": ["Values not present in the uploaded file were prefilled from the current approved masters. Review them before generating the export pack."],
    }


async def _create_generation(
    session: AsyncSession,
    user: User,
    document_type: str,
    fields: dict[str, str],
    template: KnowledgeDocument,
) -> DocumentGeneration:
    storage = Path(get_settings().upload_storage_path)
    storage.mkdir(parents=True, exist_ok=True)
    generation_id = uuid.uuid4()
    filename = _output_filename(document_type, fields)
    stored = organized_storage_name("generated-documents", user.organization_id, filename, category="merchandising", identifier=generation_id)
    output = storage / stored
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        generate_document(storage / template.stored_filename, output, document_type, fields)
    except (OSError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=f"The {DOCUMENT_TYPES[document_type]} could not be generated from its current master.") from exc
    generation = DocumentGeneration(
        id=generation_id,
        organization_id=user.organization_id,
        user_id=user.id,
        department_id=user.department_id,
        template_document_id=template.id,
        document_type=f"merch_{document_type}"[:20],
        input_mode="upload",
        output_stored_filename=stored,
        output_original_filename=filename,
        warnings_json=[],
        status="ready",
    )
    session.add(generation)
    session.add(AuditEvent(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="merchandising.document_generated",
        target_type="document_generation",
        target_id=str(generation_id),
        metadata_json={"document_type": document_type, "filename": filename, "template_version": template.version},
    ))
    await session.commit()
    return generation


@router.post("/generate/{document_type}")
async def generate(
    document_type: str,
    payload: GenerateRequest,
    user: User = Depends(require_permissions("ai.workspace.use", "knowledge.read")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    if document_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=404, detail="Merchandising document type not found.")
    fields = _clean_fields(payload.fields)
    missing = missing_required(fields)
    if missing:
        raise HTTPException(status_code=422, detail=f"Complete the required fields: {', '.join(missing)}.")
    template = (await _templates(session, user)).get(document_type)
    if not template:
        raise HTTPException(status_code=409, detail=f"Upload the {DOCUMENT_TYPES[document_type]} master first.")
    generation = await _create_generation(session, user, document_type, fields, template)
    return {"id": str(generation.id), "document_type": document_type, "filename": generation.output_original_filename}


async def _generation(session: AsyncSession, user: User, generation_id: str) -> DocumentGeneration:
    generation = await session.get(DocumentGeneration, generation_id)
    if not generation or generation.organization_id != user.organization_id or not generation.document_type.startswith("merch_"):
        raise HTTPException(status_code=404, detail="Generated Merchandising document not found.")
    return generation


@router.get("/generations/{generation_id}/content")
async def generation_content(
    generation_id: str,
    user: User = Depends(require_permissions("knowledge.read")),
    session: AsyncSession = Depends(get_db_session),
) -> FileResponse:
    generation = await _generation(session, user, generation_id)
    path = Path(get_settings().upload_storage_path) / generation.output_stored_filename
    return FileResponse(path, filename=generation.output_original_filename, media_type=mimetypes.guess_type(generation.output_original_filename)[0])


@router.post("/pack")
async def generate_pack(
    fields_json: str = Form(...),
    user: User = Depends(require_permissions("ai.workspace.use", "knowledge.read")),
    session: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    try:
        raw_fields = json.loads(fields_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="The shipment details are not valid.") from exc
    fields = _clean_fields(raw_fields if isinstance(raw_fields, dict) else {})
    missing = missing_required(fields)
    if missing:
        raise HTTPException(status_code=422, detail=f"Complete the required fields: {', '.join(missing)}.")
    templates = await _templates(session, user)
    absent = [DOCUMENT_TYPES[key] for key in DOCUMENT_TYPES if key not in templates]
    if absent:
        raise HTTPException(status_code=409, detail=f"Upload the missing masters first: {', '.join(absent)}.")
    archive = io.BytesIO()
    with TemporaryDirectory(prefix="merchandising-pack-") as directory, zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for document_type, template in templates.items():
            filename = _output_filename(document_type, fields)
            output = Path(directory) / filename
            generate_document(Path(get_settings().upload_storage_path) / template.stored_filename, output, document_type, fields)
            bundle.write(output, filename)
    archive.seek(0)
    filename = f"{_safe_stem(fields.get('product_name', 'export'))}-Export-Pack.zip"
    session.add(AuditEvent(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="merchandising.export_pack_downloaded",
        target_type="merchandising_export_pack",
        target_id=fields.get("invoice_reference") or fields.get("product_name") or "export",
        metadata_json={"filename": filename, "document_count": len(templates)},
    ))
    await session.commit()
    return StreamingResponse(archive, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{filename}"'})
