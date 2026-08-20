import io
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, StreamingResponse
from pypdf import PdfReader
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.core.config import get_settings
from app.modules.cash_flow.service import ASSET_TEMPLATE, CASH_FLOW_TEMPLATE, build_report, read_assets, read_bank, read_cash_flow
from app.modules.identity.authorization import require_permissions
from app.modules.identity.models import AuditEvent, CashFlowReportSnapshot, Department, KnowledgeCollection, KnowledgeDocument, User
from app.modules.identity.service import role_keys_for_user

router = APIRouter()


async def ensure_access(user: User, session: AsyncSession) -> None:
    roles = await role_keys_for_user(session, user.id)
    if roles.intersection({"owner", "super_admin"}):
        return
    department = await session.get(Department, user.department_id) if user.department_id else None
    if "department_admin" not in roles or not department or department.slug != "accounts":
        raise HTTPException(status_code=403, detail="Cash Flow Report is restricted to Accounts Department Admin, Admin and Super Admin.")


async def checked_read(file: UploadFile, extensions: tuple[str, ...], label: str, limit: int = 20 * 1024 * 1024) -> bytes:
    if not (file.filename or "").lower().endswith(extensions):
        raise HTTPException(status_code=422, detail=f"Upload {label} in the required format.")
    content = await file.read(limit + 1)
    if not content or len(content) > limit:
        raise HTTPException(status_code=422, detail=f"{label} must be a non-empty file smaller than 20 MB.")
    return content


@router.get("/templates/cash-flow")
async def cash_flow_template(user: User = Depends(require_permissions("users.manage")), session: AsyncSession = Depends(get_db_session)):
    await ensure_access(user, session)
    return FileResponse(CASH_FLOW_TEMPLATE, filename=CASH_FLOW_TEMPLATE.name)


@router.get("/templates/fixed-assets")
async def fixed_asset_template(user: User = Depends(require_permissions("users.manage")), session: AsyncSession = Depends(get_db_session)):
    await ensure_access(user, session)
    return FileResponse(ASSET_TEMPLATE, filename=ASSET_TEMPLATE.name)


@router.post("/generate")
async def generate(
    report_month: str = Form(...), pdf_password: str = Form(...), include_previous_comparison: bool = Form(False),
    bob_statement: UploadFile = File(...), axis_statement: UploadFile = File(...), indusind_statement: UploadFile = File(...),
    cash_flow_excel: UploadFile = File(...), fixed_assets_excel: UploadFile | None = File(None),
    user: User = Depends(require_permissions("users.manage")), session: AsyncSession = Depends(get_db_session),
):
    await ensure_access(user, session)
    if len(pdf_password) < 8: raise HTTPException(status_code=422, detail="Use a PDF password of at least 8 characters.")
    accounts_collection = await session.scalar(
        select(KnowledgeCollection).where(
            KnowledgeCollection.organization_id == user.organization_id,
            KnowledgeCollection.slug == "accounts",
            KnowledgeCollection.status == "active",
        )
    )
    if accounts_collection is None:
        raise HTTPException(status_code=500, detail="The Accounts Knowledge Base is unavailable. Ask an administrator to restore the Accounts collection before generating the report.")
    try:
        bob, axis, indus = [await checked_read(file, (".pdf",), label) for file, label in ((bob_statement,"BOB statement PDF"),(axis_statement,"Axis statement PDF"),(indusind_statement,"IndusInd statement PDF"))]
        cash = await checked_read(cash_flow_excel, (".xlsx", ".xlsm"), "monthly cash-flow Excel")
        assets_content = await checked_read(fixed_assets_excel, (".xlsx", ".xlsm"), "fixed-assets Excel") if fixed_assets_excel else None
        receipts, payments = await run_in_threadpool(read_cash_flow, cash)
        banks = await run_in_threadpool(lambda: [read_bank("Bank of Baroda", bob), read_bank("Axis Bank", axis), read_bank("IndusInd Bank", indus)])
        assets = await run_in_threadpool(read_assets, assets_content)
        previous_snapshot = None
        if include_previous_comparison:
            previous_snapshot = await session.scalar(
                select(CashFlowReportSnapshot)
                .where(
                    CashFlowReportSnapshot.organization_id == user.organization_id,
                    CashFlowReportSnapshot.report_month < report_month,
                )
                .order_by(CashFlowReportSnapshot.report_month.desc())
                .limit(1)
            )
            if previous_snapshot is None:
                raise HTTPException(
                    status_code=422,
                    detail="No earlier stored cash-flow report is available. Generate and download the previous month's report first, then try again.",
                )
        previous = None if previous_snapshot is None else {
            "report_month": previous_snapshot.report_month,
            "receipts": previous_snapshot.receipts_json,
            "payments": previous_snapshot.payments_json,
            "banks": previous_snapshot.banks_json,
            "total_receipts": float(previous_snapshot.total_receipts),
            "total_payments": float(previous_snapshot.total_payments),
            "net_movement": float(previous_snapshot.net_movement),
        }
        output = await run_in_threadpool(build_report, report_month, receipts, payments, banks, assets, pdf_password, previous)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        protected_reader = PdfReader(io.BytesIO(output))
        if not protected_reader.is_encrypted or protected_reader.decrypt(pdf_password).name == "NOT_DECRYPTED":
            raise ValueError("The generated report did not pass password-protection verification.")
    except Exception as exc:
        raise HTTPException(status_code=500, detail="The report could not be safely password-protected, so it was not stored or downloaded.") from exc

    total_receipts = sum(value for _, value in receipts)
    total_payments = sum(value for _, value in payments)
    snapshot = await session.scalar(
        select(CashFlowReportSnapshot).where(
            CashFlowReportSnapshot.organization_id == user.organization_id,
            CashFlowReportSnapshot.report_month == report_month,
        )
    )
    if snapshot is None:
        snapshot = CashFlowReportSnapshot(organization_id=user.organization_id, report_month=report_month)
        session.add(snapshot)
    snapshot.created_by_user_id = user.id
    snapshot.receipts_json = [[label, value] for label, value in receipts]
    snapshot.payments_json = [[label, value] for label, value in payments]
    snapshot.banks_json = [{"name": bank.name, "opening": bank.opening, "closing": bank.closing, "balance_type": bank.balance_type} for bank in banks]
    snapshot.total_receipts = total_receipts
    snapshot.total_payments = total_payments
    snapshot.net_movement = total_receipts - total_payments
    snapshot.assets_included = bool(assets)
    filename = f"AROMAZEN_Cash_Flow_{report_month}.pdf"
    previous_version = await session.scalar(
        select(func.max(KnowledgeDocument.version)).where(
            KnowledgeDocument.collection_id == accounts_collection.id,
            KnowledgeDocument.original_filename == filename,
        )
    )
    settings = get_settings()
    storage_root = Path(settings.upload_storage_path)
    stored_filename = f"{uuid.uuid4()}.pdf"
    destination = storage_root / stored_filename
    try:
        await run_in_threadpool(storage_root.mkdir, parents=True, exist_ok=True)
        await run_in_threadpool(destination.write_bytes, output)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="The protected report could not be saved to the Accounts Knowledge Base, so the download was stopped.") from exc

    knowledge_document = KnowledgeDocument(
        organization_id=user.organization_id,
        collection_id=accounts_collection.id,
        uploaded_by_user_id=user.id,
        original_filename=filename,
        stored_filename=stored_filename,
        mime_type="application/pdf",
        size_bytes=len(output),
        version=(previous_version or 0) + 1,
        status="ready",
        extracted_text=None,
        extracted_characters=0,
        processed_at=datetime.now(timezone.utc),
        document_category="cash_flow_report",
    )
    try:
        session.add(knowledge_document)
        accounts_collection.updated_at = datetime.now(timezone.utc)
        await session.flush()
        session.add(AuditEvent(organization_id=user.organization_id, actor_user_id=user.id, action="cash_flow.report_generated", target_type="cash_flow_report", target_id=report_month, metadata_json={"fixed_assets_included": bool(assets), "page_source_files": 5 if assets_content else 4, "previous_comparison_included": include_previous_comparison, "previous_report_month": previous_snapshot.report_month if previous_snapshot else None, "knowledge_collection_id": str(accounts_collection.id), "knowledge_document_id": str(knowledge_document.id), "password_protected": True}))
        await session.commit()
    except Exception:
        await session.rollback()
        await run_in_threadpool(destination.unlink, missing_ok=True)
        raise
    return StreamingResponse(io.BytesIO(output), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"})
