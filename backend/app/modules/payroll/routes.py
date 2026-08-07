import io
import re
import smtplib
import uuid
from collections import Counter
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings
from app.db.session import SessionLocal, get_db_session
from app.modules.identity.authorization import require_permissions
from app.modules.identity.models import AuditEvent, Department, KnowledgeCollection, KnowledgeDocument, PayrollBatch, PayrollRecipient, PayrollTemplate, User
from app.modules.identity.service import role_keys_for_user
from app.modules.payroll.engine import create_excel_template, generate_salary_pdf, password_for, read_salary_excel, validate_template_pdf

router = APIRouter()

DEFAULT_EMAIL_SUBJECT = "AROMAZEN Salary Slip - {month}"
DEFAULT_EMAIL_BODY = """Dear {employee_name},

Please find attached your salary slip for {month}.

The PDF password is the first four letters of your name in uppercase followed by your four-digit year of birth.

Regards,
HR Department
AROMAZEN PVT LTD"""


class EmailDraftUpdate(BaseModel):
    subject: str
    body: str


def _unit_from_template_name(filename: str) -> int | None:
    normalised = re.sub(r"[^a-z0-9]", "", filename.lower())
    match = re.search(r"unit([123])salaryslip", normalised)
    return int(match.group(1)) if match else None


async def _knowledge_unit_templates(session: AsyncSession, organization_id: uuid.UUID) -> dict[int, KnowledgeDocument]:
    documents = list(await session.scalars(
        select(KnowledgeDocument)
        .join(KnowledgeCollection, KnowledgeCollection.id == KnowledgeDocument.collection_id)
        .where(
            KnowledgeDocument.organization_id == organization_id,
            KnowledgeDocument.status == "ready",
            KnowledgeCollection.status == "active",
            KnowledgeCollection.slug == "hr",
        )
        .order_by(KnowledgeDocument.version.desc(), KnowledgeDocument.created_at.desc())
    ))
    result: dict[int, KnowledgeDocument] = {}
    for document in documents:
        unit = _unit_from_template_name(document.original_filename)
        if unit and unit not in result and Path(document.original_filename).suffix.lower() == ".pdf":
            result[unit] = document
    return result


async def _ensure_hr_access(user: User, session: AsyncSession) -> None:
    roles = await role_keys_for_user(session, user.id)
    if roles.intersection({"owner", "super_admin"}):
        return
    department = await session.get(Department, user.department_id) if user.department_id else None
    if not department or department.slug != "hr":
        raise HTTPException(status_code=403, detail="Salary slips are restricted to HR administrators.")


def _recipient_response(item: PayrollRecipient) -> dict:
    return {
        "id": str(item.id), "row_number": item.row_number, "employee_name": item.employee_name,
        "employee_code": item.employee_code, "personal_email": item.personal_email,
        "unit": item.details_json.get("unit", ""), "unit_address": item.details_json.get("unit_address", ""),
        "password_hint": password_for(item.employee_name, item.birth_year), "status": item.status,
        "attempt_count": item.attempt_count, "error_message": item.error_message,
        "sent_at": item.sent_at.isoformat() if item.sent_at else None,
        "gross": item.details_json.get("gross", "0.00"), "deductions": item.details_json.get("deduction_total", "0.00"),
        "net_wages": item.details_json.get("net_wages", "0.00"),
        "template_name": item.details_json.get("template_name", ""),
    }


async def _batch_response(session: AsyncSession, batch: PayrollBatch, include_recipients: bool = True) -> dict:
    result = {
        "id": str(batch.id), "payroll_month": batch.payroll_month, "original_filename": batch.original_filename,
        "status": batch.status, "total_count": batch.total_count, "sent_count": batch.sent_count,
        "failed_count": batch.failed_count, "pending_count": max(batch.total_count - batch.sent_count - batch.failed_count, 0),
        "created_at": batch.created_at.isoformat(), "completed_at": batch.completed_at.isoformat() if batch.completed_at else None,
        "template_name": "Selected automatically by unit",
        "email_subject": batch.email_subject or DEFAULT_EMAIL_SUBJECT,
        "email_body": batch.email_body or DEFAULT_EMAIL_BODY,
        "duplicate_email_count": batch.duplicate_email_count,
    }
    if include_recipients:
        recipients = list(await session.scalars(select(PayrollRecipient).where(PayrollRecipient.batch_id == batch.id).order_by(PayrollRecipient.row_number)))
        result["sent_count"] = sum(item.status == "sent" for item in recipients)
        result["failed_count"] = sum(item.status == "failed" for item in recipients)
        result["pending_count"] = sum(item.status in {"pending", "sending"} for item in recipients)
        result["recipients"] = [_recipient_response(item) for item in recipients]
    return result


def _template_response(template: PayrollTemplate) -> dict:
    return {"id": str(template.id), "name": template.name, "original_filename": template.original_filename, "is_active": template.is_active, "created_at": template.created_at.isoformat(), "unit_number": _unit_from_template_name(template.original_filename), "source": "legacy"}


def _knowledge_template_response(unit: int, document: KnowledgeDocument) -> dict:
    return {"id": str(document.id), "name": f"Unit {unit}", "original_filename": document.original_filename, "is_active": True, "created_at": document.created_at.isoformat(), "unit_number": unit, "source": "HR Policies"}


@router.get("/templates")
async def list_templates(
    user: User = Depends(require_permissions("users.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    await _ensure_hr_access(user, session)
    templates = await _knowledge_unit_templates(session, user.organization_id)
    return [_knowledge_template_response(unit, document) for unit, document in sorted(templates.items())]


@router.post("/templates")
async def upload_template(
    template_name: str = Form(...),
    template_file: UploadFile = File(...),
    user: User = Depends(require_permissions("users.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _ensure_hr_access(user, session)
    name = template_name.strip()
    if not name or len(name) > 160:
        raise HTTPException(status_code=422, detail="Template name is required and must be under 160 characters.")
    if Path(template_file.filename or "").suffix.lower() != ".pdf":
        raise HTTPException(status_code=422, detail="Export the Canva template as an A4 portrait PDF before uploading.")
    content = await template_file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="The salary-slip template must be smaller than 10 MB.")
    try:
        validate_template_pdf(content)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    template_id = uuid.uuid4()
    stored_name = f"payroll-templates/{user.organization_id}/{template_id}.pdf"
    path = Path(get_settings().upload_storage_path) / stored_name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    await session.execute(update(PayrollTemplate).where(PayrollTemplate.organization_id == user.organization_id, PayrollTemplate.is_active.is_(True)).values(is_active=False))
    template = PayrollTemplate(id=template_id, organization_id=user.organization_id, created_by_user_id=user.id, name=name, original_filename=template_file.filename or "salary-slip-template.pdf", stored_filename=stored_name, is_active=True)
    session.add(template)
    session.add(AuditEvent(organization_id=user.organization_id, actor_user_id=user.id, action="payroll.template_uploaded", target_type="payroll_template", target_id=str(template_id), metadata_json={"name": name, "filename": template.original_filename}))
    await session.commit()
    await session.refresh(template)
    return _template_response(template)


@router.post("/templates/{template_id}/activate")
async def activate_template(
    template_id: uuid.UUID,
    user: User = Depends(require_permissions("users.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _ensure_hr_access(user, session)
    template = await session.get(PayrollTemplate, template_id)
    if not template or template.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Salary-slip template not found.")
    await session.execute(update(PayrollTemplate).where(PayrollTemplate.organization_id == user.organization_id).values(is_active=False))
    template.is_active = True
    session.add(AuditEvent(organization_id=user.organization_id, actor_user_id=user.id, action="payroll.template_activated", target_type="payroll_template", target_id=str(template_id), metadata_json={"name": template.name}))
    await session.commit()
    await session.refresh(template)
    return _template_response(template)


@router.get("/templates/{template_id}/content")
async def template_content(
    template_id: uuid.UUID,
    user: User = Depends(require_permissions("users.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> FileResponse:
    await _ensure_hr_access(user, session)
    document = await session.get(KnowledgeDocument, template_id)
    if document and document.organization_id == user.organization_id and _unit_from_template_name(document.original_filename):
        stored_filename, original_filename = document.stored_filename, document.original_filename
    else:
        template = await session.get(PayrollTemplate, template_id)
        if not template or template.organization_id != user.organization_id:
            raise HTTPException(status_code=404, detail="Salary-slip template not found.")
        stored_filename, original_filename = template.stored_filename, template.original_filename
    path = (Path(get_settings().upload_storage_path) / stored_filename).resolve()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Salary-slip template file is unavailable.")
    return FileResponse(path, media_type="application/pdf", filename=original_filename, content_disposition_type="inline")


@router.get("/template")
async def salary_excel_template(
    user: User = Depends(require_permissions("users.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    await _ensure_hr_access(user, session)
    return StreamingResponse(io.BytesIO(create_excel_template()), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=AROMAZEN_Salary_Upload_Template.xlsx"})


@router.post("/batches")
async def create_batch(
    payroll_month: str = Form(...),
    excel_file: UploadFile = File(...),
    user: User = Depends(require_permissions("users.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _ensure_hr_access(user, session)
    if not re.fullmatch(r"\d{4}-(?:0[1-9]|1[0-2])", payroll_month):
        raise HTTPException(status_code=422, detail="Payroll month must use YYYY-MM format.")
    if Path(excel_file.filename or "").suffix.lower() != ".xlsx":
        raise HTTPException(status_code=422, detail="Upload the completed .xlsx salary template.")
    content = await excel_file.read()
    if len(content) > get_settings().max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="The salary workbook is too large.")
    try:
        employee_rows = read_salary_excel(content)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    unit_templates = await _knowledge_unit_templates(session, user.organization_id)
    used_units = sorted({int(item["details"]["unit"]) for item in employee_rows})
    missing_units = [unit for unit in used_units if unit not in unit_templates]
    if missing_units:
        names = ", ".join(f"UNIT-{unit}_SalarySlip.pdf" for unit in missing_units)
        raise HTTPException(status_code=422, detail=f"Upload the missing template(s) to HR Policies: {names}.")
    duplicate_email_count = sum(count - 1 for count in Counter(item["personal_email"] for item in employee_rows).values() if count > 1)
    batch_id = uuid.uuid4()
    folder = Path(get_settings().upload_storage_path) / "payroll" / str(user.organization_id) / str(batch_id)
    folder.mkdir(parents=True, exist_ok=True)
    workbook_name = f"payroll/{user.organization_id}/{batch_id}/source.xlsx"
    (Path(get_settings().upload_storage_path) / workbook_name).write_bytes(content)
    batch = PayrollBatch(id=batch_id, organization_id=user.organization_id, created_by_user_id=user.id, template_id=None, payroll_month=payroll_month, original_filename=excel_file.filename or "salary.xlsx", stored_filename=workbook_name, email_subject=DEFAULT_EMAIL_SUBJECT, email_body=DEFAULT_EMAIL_BODY, duplicate_email_count=duplicate_email_count, total_count=len(employee_rows), status="draft")
    session.add(batch)
    for item in employee_rows:
        recipient_id = uuid.uuid4()
        pdf_name = f"payroll/{user.organization_id}/{batch_id}/{recipient_id}.pdf"
        original_name = f"Salary_Slip_{payroll_month}_{re.sub(r'[^A-Za-z0-9_-]', '_', item['employee_code'])}.pdf"
        unit = int(item["details"]["unit"])
        template = unit_templates[unit]
        item["details"]["template_name"] = template.original_filename
        template_path = Path(get_settings().upload_storage_path) / template.stored_filename
        generate_salary_pdf(item["details"], payroll_month, Path(get_settings().upload_storage_path) / pdf_name, password_for(item["employee_name"], item["birth_year"]), template_path)
        session.add(PayrollRecipient(id=recipient_id, batch_id=batch_id, organization_id=user.organization_id, row_number=item["row_number"], employee_name=item["employee_name"], employee_code=item["employee_code"], personal_email=item["personal_email"], birth_year=item["birth_year"], details_json=item["details"], pdf_stored_filename=pdf_name, pdf_original_filename=original_name, status="pending"))
    session.add(AuditEvent(organization_id=user.organization_id, actor_user_id=user.id, action="payroll.batch_created", target_type="payroll_batch", target_id=str(batch_id), metadata_json={"payroll_month": payroll_month, "employee_count": len(employee_rows), "units": used_units, "duplicate_emails": duplicate_email_count}))
    await session.commit()
    await session.refresh(batch)
    return await _batch_response(session, batch)


@router.get("/batches")
async def list_batches(
    user: User = Depends(require_permissions("users.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    await _ensure_hr_access(user, session)
    batches = await session.scalars(select(PayrollBatch).where(PayrollBatch.organization_id == user.organization_id).order_by(PayrollBatch.created_at.desc()).limit(24))
    return [await _batch_response(session, batch, False) for batch in batches]


@router.get("/batches/{batch_id}")
async def get_batch(
    batch_id: uuid.UUID,
    user: User = Depends(require_permissions("users.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _ensure_hr_access(user, session)
    batch = await session.get(PayrollBatch, batch_id)
    if not batch or batch.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Payroll batch not found.")
    return await _batch_response(session, batch)


@router.patch("/batches/{batch_id}/email")
async def update_batch_email(
    batch_id: uuid.UUID,
    payload: EmailDraftUpdate,
    user: User = Depends(require_permissions("users.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _ensure_hr_access(user, session)
    batch = await session.get(PayrollBatch, batch_id)
    if not batch or batch.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Payroll batch not found.")
    if batch.status == "sending":
        raise HTTPException(status_code=409, detail="The email cannot be changed while delivery is running.")
    subject, body = payload.subject.strip(), payload.body.strip()
    if not subject or len(subject) > 240:
        raise HTTPException(status_code=422, detail="Email subject is required and must be under 240 characters.")
    if not body or len(body) > 8000:
        raise HTTPException(status_code=422, detail="Email body is required and must be under 8,000 characters.")
    batch.email_subject = subject
    batch.email_body = body
    session.add(AuditEvent(organization_id=user.organization_id, actor_user_id=user.id, action="payroll.email_updated", target_type="payroll_batch", target_id=str(batch_id), metadata_json={}))
    await session.commit()
    await session.refresh(batch)
    return await _batch_response(session, batch)


@router.get("/batches/{batch_id}/recipients/{recipient_id}/pdf")
async def download_salary_pdf(
    batch_id: uuid.UUID,
    recipient_id: uuid.UUID,
    user: User = Depends(require_permissions("users.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> FileResponse:
    await _ensure_hr_access(user, session)
    item = await session.get(PayrollRecipient, recipient_id)
    if not item or item.batch_id != batch_id or item.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Salary slip not found.")
    path = (Path(get_settings().upload_storage_path) / item.pdf_stored_filename).resolve()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Generated salary slip is unavailable.")
    return FileResponse(path, media_type="application/pdf", filename=item.pdf_original_filename)


def _render_email(value: str, item: PayrollRecipient, month_label: str) -> str:
    return value.replace("{employee_name}", item.employee_name).replace("{month}", month_label)


def _send_message(item: PayrollRecipient, batch: PayrollBatch) -> None:
    settings = get_settings()
    username = settings.zoho_smtp_username
    password = settings.zoho_smtp_password
    from_email = settings.zoho_from_email or username
    if not username or not password or not from_email:
        raise RuntimeError("Zoho Mail is not configured.")
    month_label = datetime.strptime(batch.payroll_month, "%Y-%m").strftime("%B %Y")
    message = EmailMessage()
    message["From"] = formataddr((settings.zoho_from_name, from_email))
    message["To"] = item.personal_email
    message["Subject"] = _render_email(batch.email_subject or DEFAULT_EMAIL_SUBJECT, item, month_label)
    message.set_content(_render_email(batch.email_body or DEFAULT_EMAIL_BODY, item, month_label))
    path = Path(settings.upload_storage_path) / item.pdf_stored_filename
    message.add_attachment(path.read_bytes(), maintype="application", subtype="pdf", filename=item.pdf_original_filename)
    security = settings.zoho_smtp_security.strip().lower()
    if security not in {"ssl", "starttls"}:
        raise RuntimeError("Unsupported Zoho SMTP security mode.")
    smtp_client = smtplib.SMTP_SSL if security == "ssl" else smtplib.SMTP
    with smtp_client(settings.zoho_smtp_host, settings.zoho_smtp_port, timeout=45) as smtp:
        smtp.ehlo()
        if security == "starttls":
            smtp.starttls()
            smtp.ehlo()
        smtp.login(username, password)
        smtp.send_message(message, from_addr=from_email, to_addrs=[item.personal_email])


async def _deliver_batch(batch_id: uuid.UUID, recipient_ids: list[uuid.UUID]) -> None:
    for recipient_id in recipient_ids:
        async with SessionLocal() as session:
            batch = await session.get(PayrollBatch, batch_id)
            item = await session.get(PayrollRecipient, recipient_id)
            if not batch or not item or item.batch_id != batch_id:
                continue
            item.status = "sending"
            item.attempt_count += 1
            item.error_message = None
            await session.commit()
            try:
                await run_in_threadpool(_send_message, item, batch)
                item.status = "sent"
                item.sent_at = datetime.now(timezone.utc)
            except Exception as error:
                item.status = "failed"
                item.error_message = f"{type(error).__name__}: {str(error)[:850]}"
            await session.commit()
    async with SessionLocal() as session:
        batch = await session.get(PayrollBatch, batch_id)
        if not batch:
            return
        sent = await session.scalar(select(func.count()).select_from(PayrollRecipient).where(PayrollRecipient.batch_id == batch_id, PayrollRecipient.status == "sent")) or 0
        failed = await session.scalar(select(func.count()).select_from(PayrollRecipient).where(PayrollRecipient.batch_id == batch_id, PayrollRecipient.status == "failed")) or 0
        batch.sent_count = sent
        batch.failed_count = failed
        batch.status = "completed" if sent == batch.total_count else "failed" if failed == batch.total_count else "partial"
        batch.completed_at = datetime.now(timezone.utc)
        await session.commit()


async def _queue_delivery(batch_id: uuid.UUID, retry_failed: bool, background_tasks: BackgroundTasks, user: User, session: AsyncSession) -> dict:
    batch = await session.get(PayrollBatch, batch_id)
    if not batch or batch.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Payroll batch not found.")
    settings = get_settings()
    if not settings.zoho_smtp_username or not settings.zoho_smtp_password or not (settings.zoho_from_email or settings.zoho_smtp_username):
        raise HTTPException(status_code=503, detail="The HR Zoho Mail account is not configured on the server.")
    if batch.status == "sending":
        raise HTTPException(status_code=409, detail="This payroll batch is already being sent.")
    target_status = "failed" if retry_failed else "pending"
    recipients = list(await session.scalars(select(PayrollRecipient).where(PayrollRecipient.batch_id == batch_id, PayrollRecipient.status == target_status).order_by(PayrollRecipient.row_number)))
    if not recipients:
        raise HTTPException(status_code=409, detail="There are no failed deliveries to retry." if retry_failed else "There are no pending salary slips to send.")
    batch.status = "sending"
    batch.sending_started_at = datetime.now(timezone.utc)
    batch.completed_at = None
    if retry_failed:
        for recipient in recipients:
            recipient.status = "pending"
            recipient.error_message = None
    session.add(AuditEvent(organization_id=user.organization_id, actor_user_id=user.id, action="payroll.failed_retried" if retry_failed else "payroll.batch_send_started", target_type="payroll_batch", target_id=str(batch_id), metadata_json={"recipient_count": len(recipients)}))
    await session.commit()
    background_tasks.add_task(_deliver_batch, batch_id, [item.id for item in recipients])
    return await _batch_response(session, batch)


@router.post("/batches/{batch_id}/send")
async def send_batch(batch_id: uuid.UUID, background_tasks: BackgroundTasks, user: User = Depends(require_permissions("users.manage")), session: AsyncSession = Depends(get_db_session)) -> dict:
    await _ensure_hr_access(user, session)
    return await _queue_delivery(batch_id, False, background_tasks, user, session)


@router.post("/batches/{batch_id}/retry-failed")
async def retry_failed(batch_id: uuid.UUID, background_tasks: BackgroundTasks, user: User = Depends(require_permissions("users.manage")), session: AsyncSession = Depends(get_db_session)) -> dict:
    await _ensure_hr_access(user, session)
    return await _queue_delivery(batch_id, True, background_tasks, user, session)
