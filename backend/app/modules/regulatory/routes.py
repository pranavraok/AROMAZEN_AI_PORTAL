from __future__ import annotations

import io
import json
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.core.config import get_settings
from app.db.session import get_db_session
from app.modules.ai.providers import AIProviderRouter, ProviderError, estimate_cost
from app.modules.hr_letters.routes import _convert_docx_to_pdf
from app.modules.identity.authorization import require_department, require_permissions
from app.modules.identity.models import AIUsageEvent, AuditEvent, DocumentGeneration, KnowledgeDocument, RegulatoryIngredientMaster, RegulatoryWorkflow, User
from app.modules.identity.service import role_keys_for_user
from app.modules.knowledge.department_uploads import DepartmentUpload, replace_department_uploads
from app.modules.knowledge.extraction import ExtractionError, extract_text
from app.modules.knowledge.storage import organized_storage_name
from app.modules.regulatory.engine import COA_LABELS, DOCUMENT_TYPES, clean_issue_value, extract_coa_properties, generate_regulatory_docx, normalise, parse_regulatory_excel
from app.modules.settings.service import provider_runtime_settings

router = APIRouter(dependencies=[Depends(require_department("regulatory"))])
logger = structlog.get_logger(__name__)
ALLOWED_SOURCE_HOSTS = ("echa.europa.eu", "pubchem.ncbi.nlm.nih.gov", "ifrafragrance.org", "unece.org", "eur-lex.europa.eu")


def _official_url(value: object) -> bool:
    host = (urlparse(str(value or "")).hostname or "").lower().rstrip(".")
    return any(host == allowed or host.endswith(f".{allowed}") for allowed in ALLOWED_SOURCE_HOSTS)


class WorkflowUpdate(BaseModel):
    product_name: str = Field(max_length=300)
    product_code: str = Field(max_length=160)
    market: str = Field(pattern="^(other|eu)$")
    sds_fields: dict[str, str] = Field(default_factory=dict)
    ingredients: list[dict] = Field(default_factory=list, max_length=300)


class VoiceNotesUpdate(BaseModel):
    notes: str = Field(min_length=1, max_length=12_000)


def _template_payload(document: KnowledgeDocument, document_type: str) -> dict:
    return {"id": str(document.id), "document_type": document_type, "name": document.original_filename, "version": document.version}


async def _templates(session: AsyncSession, user: User) -> dict[str, KnowledgeDocument]:
    items = list(await session.scalars(select(KnowledgeDocument).where(
        KnowledgeDocument.organization_id == user.organization_id,
        KnowledgeDocument.source_key.like("regulatory-template:%"),
        KnowledgeDocument.status == "ready",
    )))
    return {str(item.source_key).split(":", 1)[1]: item for item in items if item.source_key}


async def _workflow(session: AsyncSession, user: User, workflow_id: str) -> RegulatoryWorkflow:
    value = await session.get(RegulatoryWorkflow, workflow_id)
    if not value or value.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Regulatory workflow not found.")
    roles = await role_keys_for_user(session, user.id)
    if value.created_by_user_id != user.id and not roles.intersection({"owner", "super_admin", "department_admin"}):
        raise HTTPException(status_code=404, detail="Regulatory workflow not found.")
    return value


def _serialize(value: RegulatoryWorkflow) -> dict:
    return {"id": str(value.id), "product_name": value.product_name, "product_code": value.product_code, "market": value.market, "status": value.status, "source_files": value.source_files_json or {}, "sds_fields": value.sds_fields_json or {}, "ingredients": value.ingredients_json or [], "generated": value.generated_json or {}, "approved_at": value.approved_at.isoformat() if value.approved_at else None}


async def _extract_coa_with_ai(session: AsyncSession, user: User, text: str, current: dict[str, str]) -> dict[str, str]:
    """Fill COA properties from the uploaded document only; never use the web here."""
    missing = [key for key in ("appearance", "colour", "odour", "relative_density", "flash_point", "refractive_index", "solubility", "storage_condition") if not current.get(key)]
    if not text.strip() or not missing:
        return current
    system = """Extract product properties only from the supplied Creation COA text. Return one JSON object containing only these keys when explicitly supported: appearance, colour, odour, relative_density, flash_point, refractive_index, solubility, storage_condition. Preserve values and units. Never guess, browse, or write N/A, unknown, review required, or AI-generated labels. Use an empty string when absent."""
    answer = ""
    try:
        settings = await provider_runtime_settings(session, user.organization_id)
        async for event in AIProviderRouter(settings).stream(system, text[:30_000], text[:30_000], use_web_search=False, response_mode="standard"):
            if event.kind == "delta":
                answer += event.text
        start, end = answer.find("{"), answer.rfind("}")
        extracted = json.loads(answer[start:end + 1])
    except (ProviderError, ValueError, json.JSONDecodeError):
        return current
    merged = dict(current)
    for key in missing:
        value = clean_issue_value(extracted.get(key))
        if value:
            merged[key] = value[:1000]
    return merged


@router.get("/templates")
async def list_templates(user: User = Depends(require_permissions("knowledge.read")), session: AsyncSession = Depends(get_db_session)) -> list[dict]:
    templates = await _templates(session, user)
    return [_template_payload(document, document_type) for document_type, document in templates.items()]


@router.post("/templates/{document_type}")
async def upload_template(document_type: str, template_file: UploadFile = File(...), user: User = Depends(require_permissions("knowledge.write")), session: AsyncSession = Depends(get_db_session)) -> dict:
    if document_type not in DOCUMENT_TYPES or Path(template_file.filename or "").suffix.lower() != ".docx":
        raise HTTPException(status_code=422, detail="Choose a valid Regulatory document type and DOCX master.")
    content = await template_file.read(get_settings().max_upload_size_mb * 1024 * 1024 + 1)
    if len(content) > get_settings().max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="The template exceeds the upload limit.")
    document = (await replace_department_uploads(session, user, "regulatory", [DepartmentUpload(
        f"regulatory-template:{document_type}", content, template_file.filename or f"{document_type}.docx",
        template_file.content_type, document_category=f"regulatory_template:{document_type}",
    )]))[0]
    return _template_payload(document, document_type)


@router.get("/templates/{document_type}/content")
async def template_content(document_type: str, user: User = Depends(require_permissions("knowledge.read")), session: AsyncSession = Depends(get_db_session)) -> FileResponse:
    document = (await _templates(session, user)).get(document_type)
    if not document:
        raise HTTPException(status_code=404, detail="Template not found.")
    return FileResponse(Path(get_settings().upload_storage_path) / document.stored_filename, filename=document.original_filename)


@router.post("/workflows")
async def create_workflow(regulatory_excel: UploadFile = File(...), creation_coa: UploadFile = File(...), user: User = Depends(require_permissions("ai.workspace.use", "knowledge.read")), session: AsyncSession = Depends(get_db_session)) -> dict:
    logger.info("regulatory_workflow_intake_started", user_id=str(user.id))
    excel_content = await regulatory_excel.read(get_settings().max_excel_upload_size_mb * 1024 * 1024 + 1)
    coa_content = await creation_coa.read(get_settings().max_upload_size_mb * 1024 * 1024 + 1)
    if Path(regulatory_excel.filename or "").suffix.lower() not in {".xlsx", ".xlsm"}:
        raise HTTPException(status_code=422, detail="The Regulatory formula must be an XLSX file.")
    if len(excel_content) > get_settings().max_excel_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="The Regulatory Excel exceeds the upload limit.")
    try:
        product, code, ingredients = parse_regulatory_excel(excel_content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    suffix = Path(creation_coa.filename or "").suffix.lower()
    if suffix not in {".pdf", ".docx", ".xlsx"}:
        raise HTTPException(status_code=422, detail="The Creation COA must be PDF, DOCX, or XLSX.")
    if len(coa_content) > get_settings().max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="The Creation COA exceeds the upload limit.")
    storage = Path(get_settings().upload_storage_path); storage.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="regulatory-coa-") as directory:
        coa_path = Path(directory) / f"coa{suffix}"; coa_path.write_bytes(coa_content)
        try:
            coa_text = extract_text(coa_path, suffix)
        except ExtractionError:
            coa_text = ""
    masters = {item.normalized_name: item for item in list(await session.scalars(select(RegulatoryIngredientMaster).where(RegulatoryIngredientMaster.organization_id == user.organization_id)))}
    for item in ingredients:
        saved = masters.get(normalise(item["name"]))
        if saved:
            item.update(saved.data_json or {}); item["sources"] = saved.sources_json or []; item["provenance"] = "approved_master"
    sds_fields = await _extract_coa_with_ai(session, user, coa_text, extract_coa_properties(coa_text))
    workflow = RegulatoryWorkflow(organization_id=user.organization_id, created_by_user_id=user.id, product_name=product, product_code=code, source_files_json={"regulatory_excel": regulatory_excel.filename or "Regulatory.xlsx", "creation_coa": creation_coa.filename or f"Creation-COA{suffix}"}, sds_fields_json=sds_fields, ingredients_json=ingredients)
    session.add(workflow); await session.flush()
    await replace_department_uploads(session, user, "regulatory", [
        DepartmentUpload(f"regulatory-workflow:{workflow.id}:excel", excel_content, regulatory_excel.filename or "Regulatory.xlsx", regulatory_excel.content_type),
        DepartmentUpload(f"regulatory-workflow:{workflow.id}:coa", coa_content, creation_coa.filename or f"Creation-COA{suffix}", creation_coa.content_type),
    ])
    logger.info("regulatory_workflow_intake_completed", workflow_id=str(workflow.id), ingredient_count=len(ingredients))
    return _serialize(workflow)


@router.patch("/workflows/{workflow_id}")
async def update_workflow(workflow_id: str, payload: WorkflowUpdate, user: User = Depends(require_permissions("ai.workspace.use")), session: AsyncSession = Depends(get_db_session)) -> dict:
    workflow = await _workflow(session, user, workflow_id)
    if workflow.status == "approved":
        raise HTTPException(status_code=409, detail="Approved SDS snapshots cannot be changed. Create a new workflow version.")
    workflow.product_name = payload.product_name.strip(); workflow.product_code = payload.product_code.strip(); workflow.market = payload.market
    workflow.sds_fields_json = {str(k): str(v)[:1000] for k, v in payload.sds_fields.items()}
    workflow.ingredients_json = [{str(k): v for k, v in item.items()} for item in payload.ingredients[:300]]
    await session.commit(); return _serialize(workflow)


@router.post("/workflows/{workflow_id}/enrich")
async def enrich_workflow(workflow_id: str, user: User = Depends(require_permissions("ai.workspace.use")), session: AsyncSession = Depends(get_db_session)) -> dict:
    workflow = await _workflow(session, user, workflow_id)
    if workflow.status == "approved":
        raise HTTPException(status_code=409, detail="This SDS is already approved.")
    ingredients = workflow.ingredients_json or []
    unresolved = [item for item in ingredients if not item.get("cas") or not item.get("classification")]
    if not unresolved:
        return _serialize(workflow)
    logger.info("regulatory_research_started", workflow_id=workflow_id, ingredient_count=len(unresolved))
    system = """You research fragrance chemical regulatory data. Return JSON only: {\"ingredients\":[...]}. Use ONLY official pages on echa.europa.eu, pubchem.ncbi.nlm.nih.gov, ifrafragrance.org, unece.org, or eur-lex.europa.eu. Never infer a value without an official source. Each item must preserve input_name and may contain canonical_name, aliases, cas, ec, classification, hazard_statements, precautionary_statements, signal_word, pictograms, toxicology, ecology, transport, allergen_identity, svhc_identity, and source_urls. Use empty strings/arrays when unsupported. Do not write N/A or review messages."""
    prompt = json.dumps({"ingredients": [{"input_name": item.get("name"), "concentration": item.get("concentration")} for item in unresolved[:60]]}, ensure_ascii=False)
    answer = ""; provider = model = ""; input_tokens = output_tokens = 0; started = time.perf_counter()
    try:
        settings = await provider_runtime_settings(session, user.organization_id)
        async for event in AIProviderRouter(settings).stream(system, prompt, prompt, use_web_search=True, response_mode="deep"):
            if event.kind == "meta": provider, model = event.provider, event.model
            elif event.kind == "delta": answer += event.text
            elif event.kind == "usage": input_tokens, output_tokens = event.input_tokens, event.output_tokens
        start, end = answer.find("{"), answer.rfind("}"); parsed = json.loads(answer[start:end + 1])
    except (ProviderError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=503, detail="Official-source ingredient research is temporarily unavailable. Existing fields remain editable.") from exc
    researched = {normalise(item.get("input_name")): item for item in parsed.get("ingredients", []) if isinstance(item, dict)}
    for current in ingredients:
        suggestion = researched.get(normalise(current.get("name")))
        if not suggestion:
            continue
        raw_urls = suggestion.get("source_urls") or []
        row_urls = [str(url) for url in raw_urls if _official_url(url)] if isinstance(raw_urls, list) else []
        if not row_urls:
            continue
        for key in ("canonical_name", "aliases", "cas", "ec", "classification", "hazard_statements", "precautionary_statements", "signal_word", "pictograms", "toxicology", "ecology", "transport", "allergen_identity", "svhc_identity"):
            if not suggestion.get(key) or current.get(key):
                continue
            if key == "aliases":
                value = suggestion[key] if isinstance(suggestion[key], list) else re.split(r"[,;]", str(suggestion[key]))
                current[key] = [clean_issue_value(alias)[:300] for alias in value if clean_issue_value(alias)]
            else:
                current[key] = clean_issue_value(suggestion[key])[:2000]
        current["sources"] = row_urls; current["provenance"] = "ai_suggested"
    workflow.ingredients_json = ingredients
    session.add(AIUsageEvent(organization_id=user.organization_id, user_id=user.id, department_id=user.department_id, operation="regulatory_web_research", provider=provider, model=model, input_tokens=input_tokens, output_tokens=output_tokens, cost_usd=estimate_cost(provider, model, input_tokens, output_tokens), latency_ms=int((time.perf_counter() - started) * 1000), status="completed"))
    await session.commit(); logger.info("regulatory_research_completed", workflow_id=workflow_id); return _serialize(workflow)


@router.post("/workflows/{workflow_id}/apply-voice-notes")
async def apply_voice_notes(workflow_id: str, payload: VoiceNotesUpdate, user: User = Depends(require_permissions("ai.workspace.use")), session: AsyncSession = Depends(get_db_session)) -> dict:
    workflow = await _workflow(session, user, workflow_id)
    if workflow.status == "approved":
        raise HTTPException(status_code=409, detail="This SDS is already approved.")
    current = _serialize(workflow)
    system = """Map employee voice notes into the existing Regulatory SDS draft. Return JSON only with optional keys product_name, product_code, market (eu or other), sds_fields, and ingredients. Never invent information. Include only values explicitly stated or corrected in the notes. For ingredients return {match_name, updates}; updates may contain name, concentration, cas, ec, classification, hazard_statements, precautionary_statements, signal_word, pictograms, toxicology, ecology, transport, allergen_identity, svhc_identity, or aliases. Do not include review messages, confidence, provenance, sources, or N/A placeholders."""
    prompt = json.dumps({"current_draft": current, "employee_notes": payload.notes}, ensure_ascii=False)
    answer = ""
    try:
        settings = await provider_runtime_settings(session, user.organization_id)
        async for event in AIProviderRouter(settings).stream(system, prompt, payload.notes, use_web_search=False, response_mode="standard"):
            if event.kind == "delta":
                answer += event.text
        start, end = answer.find("{"), answer.rfind("}")
        changes = json.loads(answer[start:end + 1])
    except (ProviderError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=503, detail="Voice-note mapping is temporarily unavailable. The transcript remains available for manual entry.") from exc
    if clean_issue_value(changes.get("product_name")):
        workflow.product_name = clean_issue_value(changes["product_name"])[:300]
    if clean_issue_value(changes.get("product_code")):
        workflow.product_code = clean_issue_value(changes["product_code"])[:160]
    if changes.get("market") in {"eu", "other"}:
        workflow.market = changes["market"]
    allowed_sds = {key for key, _aliases in COA_LABELS.items()} | {"signal_word", "hazard_statements", "precautionary_statements", "other_hazards"}
    sds_fields = dict(workflow.sds_fields_json or {})
    for key, value in (changes.get("sds_fields") or {}).items():
        cleaned = clean_issue_value(value)
        if key in allowed_sds and cleaned:
            sds_fields[key] = cleaned[:1000]
    workflow.sds_fields_json = sds_fields
    allowed_ingredient = {"name", "concentration", "cas", "ec", "classification", "hazard_statements", "precautionary_statements", "signal_word", "pictograms", "toxicology", "ecology", "transport", "allergen_identity", "svhc_identity", "aliases"}
    ingredients = list(workflow.ingredients_json or [])
    indexed = {normalise(item.get("name")): item for item in ingredients}
    for change in changes.get("ingredients") or []:
        if not isinstance(change, dict):
            continue
        item = indexed.get(normalise(change.get("match_name")))
        if item is None:
            continue
        for key, value in (change.get("updates") or {}).items():
            if key not in allowed_ingredient:
                continue
            if key == "aliases" and isinstance(value, list):
                item[key] = [clean_issue_value(alias)[:300] for alias in value if clean_issue_value(alias)]
            elif clean_issue_value(value):
                item[key] = clean_issue_value(value)[:2000]
        item["provenance"] = "employee_approved"
    workflow.ingredients_json = ingredients
    await session.commit()
    return _serialize(workflow)


@router.post("/workflows/{workflow_id}/approve")
async def approve_workflow(workflow_id: str, payload: WorkflowUpdate, user: User = Depends(require_permissions("ai.workspace.use")), session: AsyncSession = Depends(get_db_session)) -> dict:
    workflow = await _workflow(session, user, workflow_id)
    if workflow.status == "approved":
        raise HTTPException(status_code=409, detail="This SDS is already approved.")
    if not payload.product_name.strip() or not payload.product_code.strip():
        raise HTTPException(status_code=422, detail="Product name and product code are required before approval.")
    if not any(str(item.get("name") or "").strip() for item in payload.ingredients):
        raise HTTPException(status_code=422, detail="At least one named ingredient is required before approval.")
    workflow.product_name = payload.product_name.strip(); workflow.product_code = payload.product_code.strip(); workflow.market = payload.market
    workflow.sds_fields_json = payload.sds_fields; workflow.ingredients_json = payload.ingredients; workflow.status = "approved"; workflow.approved_by_user_id = user.id; workflow.approved_at = datetime.now(timezone.utc)
    for item in payload.ingredients:
        key = normalise(item.get("name"))
        if not key: continue
        master = await session.scalar(select(RegulatoryIngredientMaster).where(RegulatoryIngredientMaster.organization_id == user.organization_id, RegulatoryIngredientMaster.normalized_name == key))
        if master is None:
            master = RegulatoryIngredientMaster(organization_id=user.organization_id, normalized_name=key, display_name=str(item.get("name") or "")[:300]); session.add(master)
        master.data_json = {k: v for k, v in item.items() if k not in {"sources", "provenance", "concentration"}}; master.sources_json = item.get("sources") or []; master.approved_by_user_id = user.id
    session.add(AuditEvent(organization_id=user.organization_id, actor_user_id=user.id, action="regulatory.sds_approved", target_type="regulatory_workflow", target_id=str(workflow.id), metadata_json={"product_code": workflow.product_code, "ingredient_count": len(payload.ingredients)}))
    await session.commit(); return _serialize(workflow)


@router.post("/workflows/{workflow_id}/generate/{document_type}")
async def generate_document(workflow_id: str, document_type: str, user: User = Depends(require_permissions("ai.workspace.use", "knowledge.read")), session: AsyncSession = Depends(get_db_session)) -> dict:
    workflow = await _workflow(session, user, workflow_id)
    if workflow.status != "approved": raise HTTPException(status_code=409, detail="Approve the SDS before generating documents.")
    if document_type not in DOCUMENT_TYPES: raise HTTPException(status_code=422, detail="Unknown Regulatory document type.")
    if document_type == "reach_declaration" and workflow.market != "eu": raise HTTPException(status_code=422, detail="REACH Declaration is available only for Europe / EU.")
    template = (await _templates(session, user)).get(document_type)
    if not template: raise HTTPException(status_code=404, detail="The master template is unavailable.")
    storage = Path(get_settings().upload_storage_path); generation_id = uuid.uuid4()
    label = document_type.replace("_", "-").upper(); filename = f"{re.sub(r'[^A-Za-z0-9_-]+', '-', workflow.product_name).strip('-')}-{label}.docx"
    stored = organized_storage_name("generated-documents", user.organization_id, filename, category="regulatory", identifier=generation_id)
    output = storage / stored; output.parent.mkdir(parents=True, exist_ok=True)
    generate_regulatory_docx(storage / template.stored_filename, output, document_type, workflow.product_name, workflow.product_code, workflow.sds_fields_json or {}, workflow.ingredients_json or [])
    generation = DocumentGeneration(id=generation_id, organization_id=user.organization_id, user_id=user.id, department_id=user.department_id, template_document_id=template.id, document_type=document_type, input_mode="approved_sds", output_stored_filename=stored, output_original_filename=filename, warnings_json=[], status="approved")
    session.add(generation); generated = dict(workflow.generated_json or {}); generated[document_type] = str(generation_id); workflow.generated_json = generated
    await session.commit(); logger.info("regulatory_document_generated", workflow_id=workflow_id, document_type=document_type, generation_id=str(generation_id)); return {"id": str(generation_id), "filename": filename, "document_type": document_type}


@router.get("/generations/{generation_id}/download")
async def download_generation(generation_id: str, user: User = Depends(require_permissions("ai.workspace.use")), session: AsyncSession = Depends(get_db_session)) -> FileResponse:
    generation = await session.get(DocumentGeneration, generation_id)
    if not generation or generation.organization_id != user.organization_id: raise HTTPException(status_code=404, detail="Generated document not found.")
    return FileResponse(Path(get_settings().upload_storage_path) / generation.output_stored_filename, filename=generation.output_original_filename)


async def _generation_pdf(generation_id: str, user: User, session: AsyncSession, disposition: str) -> StreamingResponse:
    generation = await session.get(DocumentGeneration, generation_id)
    if not generation or generation.organization_id != user.organization_id: raise HTTPException(status_code=404, detail="Generated document not found.")
    path = Path(get_settings().upload_storage_path) / generation.output_stored_filename
    try:
        with TemporaryDirectory(prefix="regulatory-preview-") as directory:
            pdf = _convert_docx_to_pdf(path, Path(directory)); content = pdf.read_bytes()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="PDF preview conversion is unavailable.") from exc
    return StreamingResponse(io.BytesIO(content), media_type="application/pdf", headers={"Content-Disposition": f'{disposition}; filename="{Path(generation.output_original_filename).stem}.pdf"'})


@router.get("/generations/{generation_id}/preview")
async def preview_generation(generation_id: str, user: User = Depends(require_permissions("ai.workspace.use")), session: AsyncSession = Depends(get_db_session)) -> StreamingResponse:
    return await _generation_pdf(generation_id, user, session, "inline")


@router.get("/generations/{generation_id}/pdf")
async def download_generation_pdf(generation_id: str, user: User = Depends(require_permissions("ai.workspace.use")), session: AsyncSession = Depends(get_db_session)) -> StreamingResponse:
    return await _generation_pdf(generation_id, user, session, "attachment")
