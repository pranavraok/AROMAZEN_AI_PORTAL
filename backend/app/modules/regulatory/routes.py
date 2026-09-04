from __future__ import annotations

import asyncio
import io
import json
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
import structlog
import httpx

from app.core.config import get_settings
from app.db.session import get_db_session
from app.modules.ai.providers import AIProviderRouter, AnthropicProvider, OpenAIProvider, ProviderError, estimate_cost
from app.modules.hr_letters.routes import _convert_docx_to_pdf
from app.modules.identity.authorization import require_department, require_permissions
from app.modules.identity.models import AIUsageEvent, AuditEvent, DocumentGeneration, KnowledgeDocument, RegulatoryIngredientMaster, RegulatoryWorkflow, User
from app.modules.identity.service import role_keys_for_user
from app.modules.knowledge.department_uploads import DepartmentUpload, replace_department_uploads
from app.modules.knowledge.extraction import ExtractionError, extract_text
from app.modules.knowledge.storage import organized_storage_name
from app.modules.regulatory.engine import COA_LABELS, DOCUMENT_TYPES, clean_issue_value, extract_coa_properties, generate_regulatory_docx, normalise, parse_regulatory_excel
from app.modules.regulatory.research import (
    EC_PATTERN,
    EU_COSMETICS_REGULATION,
    IFRA_LIBRARY_PAGE,
    PUBCHEM_THROTTLE,
    echa_svhc_status,
    epa_comptox_identity,
    ifra_snapshot_match,
    load_echa_candidate_snapshot,
    load_ifra_snapshot,
    load_nite_ghs_snapshot,
    nite_ghs_match,
    pubchem_regulatory_record,
    template_reference_match,
    valid_cas,
)
from app.modules.settings.service import provider_runtime_settings

router = APIRouter(dependencies=[Depends(require_department("regulatory"))])
logger = structlog.get_logger(__name__)
RESEARCH_FIELDS = ("canonical_name", "aliases", "cas", "ec", "classification", "hazard_statements", "precautionary_statements", "signal_word", "pictograms", "toxicology", "ecology", "transport", "allergen_identity", "svhc_identity", "ifra_limits")


class WorkflowUpdate(BaseModel):
    product_name: str = Field(max_length=300)
    product_code: str = Field(max_length=160)
    market: str = Field(pattern="^(other|eu)$")
    sds_fields: dict[str, str] = Field(default_factory=dict)
    ingredients: list[dict] = Field(default_factory=list, max_length=300)


class VoiceNotesUpdate(BaseModel):
    notes: str = Field(min_length=1, max_length=12_000)


class OfficialEnrichmentRequest(BaseModel):
    force: bool = False


class AIIdentityFallbackRequest(BaseModel):
    ingredient_index: int = Field(ge=0, le=299)


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


def _public_master_data(master: RegulatoryIngredientMaster) -> tuple[dict, str]:
    stored = master.data_json or {}
    public = {key: value for key, value in stored.items() if not str(key).startswith("_")}
    provenance = "approved_master" if master.approved_by_user_id else str(stored.get("_research_method") or "official_database")
    return public, provenance


def _merge_research_result(
    current: dict,
    suggestion: dict,
    urls: list[str],
    checks: dict,
    versions: dict,
    provenance: str,
) -> int:
    changed = 0
    for key in RESEARCH_FIELDS:
        if not suggestion.get(key) or current.get(key):
            continue
        if key == "aliases":
            value = suggestion[key] if isinstance(suggestion[key], list) else re.split(r"[,;]", str(suggestion[key]))
            aliases = [clean_issue_value(alias)[:300] for alias in value if clean_issue_value(alias)]
            if aliases:
                current[key] = aliases
                changed += 1
        else:
            raw_value = suggestion[key]
            if isinstance(raw_value, list):
                raw_value = "; ".join(str(part) for part in raw_value if clean_issue_value(part))
            value = clean_issue_value(raw_value)[:2000]
            if value:
                current[key] = value
                changed += 1
    current["sources"] = list(dict.fromkeys([*(current.get("sources") or []), *urls]))
    current["source_checks"] = {**(current.get("source_checks") or {}), **checks}
    current["source_versions"] = {**(current.get("source_versions") or {}), **versions}
    if current.get("provenance") not in {"approved_master", "employee_approved"}:
        current["provenance"] = provenance
    return changed


def _cache_research_result(
    session: AsyncSession,
    masters: dict[str, RegulatoryIngredientMaster],
    user: User,
    item: dict,
    method: str,
) -> None:
    key = normalise(item.get("name"))
    if not key:
        return
    master = masters.get(key)
    if master is not None and master.approved_by_user_id:
        return
    if master is None:
        master = RegulatoryIngredientMaster(
            organization_id=user.organization_id,
            normalized_name=key,
            display_name=str(item.get("name") or "")[:300],
        )
        session.add(master)
        masters[key] = master
    master.data_json = {
        **{key: value for key, value in item.items() if key not in {"sources", "provenance", "concentration"}},
        "_research_method": method,
    }
    master.sources_json = item.get("sources") or []


def _active_reference_templates(templates: dict[str, KnowledgeDocument]) -> tuple[dict[str, Path], dict[str, int]]:
    storage = Path(get_settings().upload_storage_path)
    paths = {
        key: storage / document.stored_filename
        for key, document in templates.items()
        if key in {"allergen_report", "ifra_amendment"}
    }
    versions = {key: int(document.version) for key, document in templates.items() if key in paths}
    return paths, versions


def _template_checks(item: dict, paths: dict[str, Path], versions: dict[str, int]) -> tuple[dict, list[str], dict, dict]:
    checked_at = datetime.now(timezone.utc).isoformat()
    suggestion: dict = {}
    urls: list[str] = []
    checks: dict = {}
    source_versions: dict = {}
    allergen_path = paths.get("allergen_report")
    if allergen_path:
        match = template_reference_match(allergen_path, "allergen", item)
        checks["allergen"] = {
            "status": "listed" if match else "not_listed",
            "source": f"Approved Allergen template v{versions['allergen_report']}",
            "checked_at": checked_at,
        }
        source_versions["allergen_template"] = versions["allergen_report"]
        urls.append(EU_COSMETICS_REGULATION)
        if match:
            suggestion["allergen_identity"] = match["name"]
    ifra_path = paths.get("ifra_amendment")
    if ifra_path:
        match = template_reference_match(ifra_path, "ifra", item)
        checks["ifra_template"] = {
            "status": "listed" if match else "not_listed",
            "source": f"Approved IFRA Amendment template v{versions['ifra_amendment']}",
            "checked_at": checked_at,
            "details": "; ".join([*(match.get("standards") or []), str(match.get("publication_year") or "")]).strip("; ") if match else "",
        }
        source_versions["ifra_template"] = versions["ifra_amendment"]
        urls.append(IFRA_LIBRARY_PAGE)
    return suggestion, urls, checks, source_versions


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
            saved_data, provenance = _public_master_data(saved)
            item.update(saved_data); item["sources"] = saved.sources_json or []; item["provenance"] = provenance
    # Creation COA intake is deterministic and free. Missing values stay editable
    # instead of silently triggering a paid model request.
    sds_fields = extract_coa_properties(coa_text)
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
async def enrich_workflow(
    workflow_id: str,
    payload: OfficialEnrichmentRequest | None = None,
    user: User = Depends(require_permissions("ai.workspace.use")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """Populate only from direct official databases and approved templates."""
    workflow = await _workflow(session, user, workflow_id)
    if workflow.status == "approved":
        raise HTTPException(status_code=409, detail="This SDS is already approved.")
    force = bool(payload and payload.force)
    ingredients = workflow.ingredients_json or []
    cached = 0
    to_lookup: list[dict] = []
    for item in ingredients:
        provenance = str(item.get("provenance") or "excel")
        if provenance in {"approved_master", "employee_approved"}:
            cached += 1
        elif not force and provenance in {"official_database", "ai_suggested"}:
            cached += 1
        else:
            to_lookup.append(item)

    templates = await _templates(session, user)
    template_paths, template_versions = _active_reference_templates(templates)
    semaphore = asyncio.Semaphore(4)
    app_settings = get_settings()
    reference_dir = Path(app_settings.upload_storage_path) / "regulatory-reference-data"
    logger.info("regulatory_official_lookup_started", workflow_id=workflow_id, ingredient_count=len(to_lookup), force=force)

    async def research_one(
        item: dict,
        client: httpx.AsyncClient,
        echa_snapshot: dict | None,
        nite_snapshot: dict | None,
        ifra_snapshot: dict | None,
    ) -> dict:
        suggestion: dict = {}
        urls: list[str] = []
        checks: dict = {}
        versions: dict = {}
        errors: list[str] = []
        async with semaphore:
            lookup_value = next((value for value in re.findall(r"\d{2,7}-\d{2}-\d", str(item.get("cas") or "")) if valid_cas(value)), str(item.get("name") or ""))
            try:
                values, value_urls, value_checks, value_versions = await pubchem_regulatory_record(client, lookup_value, PUBCHEM_THROTTLE)
                suggestion.update(values); urls.extend(value_urls); checks.update(value_checks); versions.update(value_versions)
            except (httpx.HTTPError, ValueError, TypeError) as exc:
                errors.append(f"pubchem/{type(exc).__name__}")
                logger.warning("regulatory_pubchem_lookup_failed", workflow_id=workflow_id, ingredient=str(item.get("name") or ""), error=str(exc))

            candidate = {**item, **suggestion}
            if app_settings.epa_comptox_api_key and not candidate.get("cas"):
                try:
                    values, value_urls, value_checks, value_versions = await epa_comptox_identity(
                        client,
                        name=str(candidate.get("canonical_name") or candidate.get("name") or ""),
                        cas=str(candidate.get("cas") or ""),
                        api_key=app_settings.epa_comptox_api_key,
                    )
                    suggestion.update(values); urls.extend(value_urls); checks.update(value_checks); versions.update(value_versions)
                    candidate.update(values)
                except (httpx.HTTPError, ValueError, TypeError) as exc:
                    errors.append(f"epa_comptox/{type(exc).__name__}")
                    logger.warning("regulatory_epa_lookup_failed", workflow_id=workflow_id, ingredient=str(item.get("name") or ""), error=str(exc))

            values, value_urls, value_checks, value_versions = nite_ghs_match(nite_snapshot, candidate)
            if not candidate.get("classification"):
                suggestion.update(values); urls.extend(value_urls); checks.update(value_checks); versions.update(value_versions)
                candidate.update(values)
            else:
                urls.extend(value_urls); checks.update(value_checks); versions.update(value_versions)

            if echa_snapshot:
                values, value_urls, value_checks, value_versions = await echa_svhc_status(
                    client,
                    name=str(candidate.get("canonical_name") or candidate.get("name") or ""),
                    cas=str(candidate.get("cas") or ""),
                    ec=str(candidate.get("ec") or ""),
                    snapshot=echa_snapshot,
                )
                suggestion.update(values); urls.extend(value_urls); checks.update(value_checks); versions.update(value_versions)
                candidate.update(values)
            else:
                checks["svhc"] = {"status": "unavailable", "source": "ECHA Candidate List", "checked_at": datetime.now(timezone.utc).isoformat()}

            values, value_urls, value_checks, value_versions = ifra_snapshot_match(ifra_snapshot, candidate)
            suggestion.update(values); urls.extend(value_urls); checks.update(value_checks); versions.update(value_versions)
            candidate.update(values)
            values, value_urls, value_checks, value_versions = _template_checks(candidate, template_paths, template_versions)
            suggestion.update(values); urls.extend(value_urls); checks.update(value_checks); versions.update(value_versions)
        return {"item": item, "suggestion": suggestion, "urls": list(dict.fromkeys(urls)), "checks": checks, "versions": versions, "errors": errors}

    reference_failures = 0
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True) as client:
        snapshots: dict[str, dict | None] = {"echa": None, "nite": None, "ifra": None}
        for key, loader in (
            ("echa", load_echa_candidate_snapshot),
            ("nite", load_nite_ghs_snapshot),
            ("ifra", load_ifra_snapshot),
        ):
            try:
                snapshots[key] = await loader(client, reference_dir)
            except (httpx.HTTPError, OSError, ValueError, TypeError) as exc:
                reference_failures += 1
                logger.warning("regulatory_reference_snapshot_failed", source=key, workflow_id=workflow_id, error=str(exc))
        research_results = await asyncio.gather(*(
            research_one(item, client, snapshots["echa"], snapshots["nite"], snapshots["ifra"])
            for item in to_lookup[:60]
        ))

    masters = {item.normalized_name: item for item in list(await session.scalars(select(RegulatoryIngredientMaster).where(RegulatoryIngredientMaster.organization_id == user.organization_id)))}
    populated = 0
    failed = reference_failures
    for researched in research_results:
        current = researched["item"]
        changed = _merge_research_result(
            current,
            researched.get("suggestion") or {},
            researched.get("urls") or [],
            researched.get("checks") or {},
            researched.get("versions") or {},
            "official_database",
        )
        if changed:
            populated += 1
        if researched.get("errors"):
            failed += 1
        _cache_research_result(session, masters, user, current, "official_database")
    workflow.ingredients_json = ingredients
    flag_modified(workflow, "ingredients_json")
    await session.commit()
    unresolved = sum(1 for item in ingredients if not item.get("cas") and not item.get("ec"))
    logger.info("regulatory_official_lookup_completed", workflow_id=workflow_id, populated=populated, unresolved=unresolved, failed=failed, cached=cached, ai_requests=0)
    result = _serialize(workflow)
    result["research_summary"] = {"mode": "official", "attempted": len(research_results), "populated": populated, "unresolved": unresolved, "failed": failed, "cached": cached, "ai_requests": 0}
    return result


@router.post("/workflows/{workflow_id}/ai-identity-fallback")
async def ai_identity_fallback(
    workflow_id: str,
    payload: AIIdentityFallbackRequest,
    user: User = Depends(require_permissions("ai.workspace.use")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """Run at most one paid AI request for one unresolved trade name."""
    workflow = await _workflow(session, user, workflow_id)
    if workflow.status == "approved":
        raise HTTPException(status_code=409, detail="This SDS is already approved.")
    ingredients = workflow.ingredients_json or []
    if payload.ingredient_index >= len(ingredients):
        raise HTTPException(status_code=422, detail="Choose a valid unresolved ingredient.")
    item = ingredients[payload.ingredient_index]
    if item.get("cas") or item.get("ec"):
        raise HTTPException(status_code=409, detail="This ingredient already has an official identity and does not need AI fallback.")

    settings = await provider_runtime_settings(session, user.organization_id)
    if settings.anthropic_api_key:
        ai_provider = AnthropicProvider(settings, settings.anthropic_default_model)
    elif settings.openai_api_key:
        ai_provider = OpenAIProvider(settings)
    else:
        raise HTTPException(status_code=503, detail="No optional AI provider is configured.")
    system = """Resolve exactly one fragrance trade name to a chemical identity. Return one compact JSON object with canonical_name, aliases, cas, ec, and source_urls. Search only official ECHA, PubChem, IFRA, UNECE, or EUR-Lex pages. Never infer a CAS or EC number. If an official source does not establish the identity, return empty values. Do not return regulatory classifications or narrative."""
    prompt = json.dumps({"input_name": item.get("name")}, ensure_ascii=False)
    answer = ""; provider = model = ""; input_tokens = output_tokens = 0
    started = time.perf_counter()
    try:
        async for event in ai_provider.stream(system, prompt, use_web_search=True, response_mode="quick"):
            if event.kind == "meta": provider, model = event.provider, event.model
            elif event.kind == "delta": answer += event.text
            elif event.kind == "usage": input_tokens, output_tokens = event.input_tokens, event.output_tokens
        start, end = answer.find("{"), answer.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("AI identity lookup returned no JSON object.")
        parsed = json.loads(answer[start:end + 1])
        if not isinstance(parsed, dict):
            raise ValueError("AI identity lookup returned an invalid result.")
    except (ProviderError, ValueError, json.JSONDecodeError, TypeError) as exc:
        logger.warning("regulatory_ai_identity_failed", workflow_id=workflow_id, ingredient=str(item.get("name") or ""), error=str(exc))
        raise HTTPException(status_code=503, detail="The optional AI identity lookup could not complete. No ingredient values were changed.") from exc

    # AI output is only a search candidate. Never save its identifiers directly;
    # the values displayed to the employee must be returned by an official API.
    ai_candidate: dict = {}
    canonical = clean_issue_value(parsed.get("canonical_name"))
    if canonical:
        ai_candidate["canonical_name"] = canonical[:300]
    aliases = parsed.get("aliases") or []
    if isinstance(aliases, list):
        ai_candidate["aliases"] = [clean_issue_value(value)[:300] for value in aliases if clean_issue_value(value)]
    cas = clean_issue_value(parsed.get("cas"))
    ec = clean_issue_value(parsed.get("ec"))
    if valid_cas(cas):
        ai_candidate["cas"] = cas
    if EC_PATTERN.fullmatch(ec) and not valid_cas(ec):
        ai_candidate["ec"] = ec

    verified_suggestion: dict = {}
    urls: list[str] = []
    checks = {"ai_identity": {"status": "not_found", "source": provider, "checked_at": datetime.now(timezone.utc).isoformat()}}
    versions: dict = {}
    verification_failed = False
    if ai_candidate.get("cas") or ai_candidate.get("ec") or ai_candidate.get("canonical_name"):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True) as client:
                lookup_value = str(ai_candidate.get("cas") or ai_candidate.get("canonical_name") or item.get("name") or "")
                official, official_urls, official_checks, official_versions = await pubchem_regulatory_record(client, lookup_value, PUBCHEM_THROTTLE)
                if official.get("cas") or official.get("ec"):
                    verified_suggestion.update(official)
                    urls.extend(official_urls); checks.update(official_checks); versions.update(official_versions)
                    checks["ai_identity"]["status"] = "verified"
                    candidate = {**item, **verified_suggestion}
                    svhc, svhc_urls, svhc_checks, svhc_versions = await echa_svhc_status(client, name=str(candidate.get("canonical_name") or candidate.get("name") or ""), cas=str(candidate.get("cas") or ""), ec=str(candidate.get("ec") or ""))
                    verified_suggestion.update(svhc); urls.extend(svhc_urls); checks.update(svhc_checks); versions.update(svhc_versions)
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            verification_failed = True
            logger.warning("regulatory_ai_identity_verification_failed", workflow_id=workflow_id, ingredient=str(item.get("name") or ""), error=str(exc))
    if verified_suggestion:
        template_paths, template_versions = _active_reference_templates(await _templates(session, user))
        candidate = {**item, **verified_suggestion}
        values, value_urls, value_checks, value_versions = _template_checks(candidate, template_paths, template_versions)
        verified_suggestion.update(values); urls.extend(value_urls); checks.update(value_checks); versions.update(value_versions)

    changed = _merge_research_result(item, verified_suggestion, list(dict.fromkeys(urls)), checks, versions, "official_database")
    masters = {master.normalized_name: master for master in list(await session.scalars(select(RegulatoryIngredientMaster).where(RegulatoryIngredientMaster.organization_id == user.organization_id)))}
    if changed:
        _cache_research_result(session, masters, user, item, "official_database")
    workflow.ingredients_json = ingredients
    flag_modified(workflow, "ingredients_json")
    session.add(AIUsageEvent(organization_id=user.organization_id, user_id=user.id, department_id=user.department_id, operation="regulatory_ai_identity_fallback", provider=provider, model=model, input_tokens=input_tokens, output_tokens=output_tokens, cost_usd=estimate_cost(provider, model, input_tokens, output_tokens), latency_ms=int((time.perf_counter() - started) * 1000), status="completed"))
    await session.commit()
    unresolved = sum(1 for ingredient in ingredients if not ingredient.get("cas") and not ingredient.get("ec"))
    logger.info("regulatory_ai_identity_completed", workflow_id=workflow_id, ingredient=str(item.get("name") or ""), changed=changed, provider=provider, input_tokens=input_tokens, output_tokens=output_tokens)
    result = _serialize(workflow)
    result["research_summary"] = {"mode": "ai", "attempted": 1, "populated": 1 if changed else 0, "unresolved": unresolved, "failed": 1 if verification_failed else 0, "cached": 0, "ai_requests": 1}
    return result


@router.post("/workflows/{workflow_id}/apply-voice-notes")
async def apply_voice_notes(workflow_id: str, payload: VoiceNotesUpdate, user: User = Depends(require_permissions("ai.workspace.use")), session: AsyncSession = Depends(get_db_session)) -> dict:
    workflow = await _workflow(session, user, workflow_id)
    if workflow.status == "approved":
        raise HTTPException(status_code=409, detail="This SDS is already approved.")
    current = _serialize(workflow)
    system = """Map employee voice notes into the existing Regulatory SDS draft. Return JSON only with optional keys product_name, product_code, market (eu or other), sds_fields, and ingredients. Never invent information. Include only values explicitly stated or corrected in the notes. For ingredients return {match_name, updates}; updates may contain name, concentration, cas, ec, classification, hazard_statements, precautionary_statements, signal_word, pictograms, toxicology, ecology, transport, allergen_identity, svhc_identity, ifra_limits, or aliases. Do not include review messages, confidence, provenance, sources, or N/A placeholders."""
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
    allowed_ingredient = {"name", "concentration", "cas", "ec", "classification", "hazard_statements", "precautionary_statements", "signal_word", "pictograms", "toxicology", "ecology", "transport", "allergen_identity", "svhc_identity", "ifra_limits", "aliases"}
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
    flag_modified(workflow, "ingredients_json")
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
        master.data_json = {
            **{k: v for k, v in item.items() if k not in {"sources", "provenance", "concentration"}},
            "_research_method": "employee_approved",
        }
        master.sources_json = item.get("sources") or []; master.approved_by_user_id = user.id
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
