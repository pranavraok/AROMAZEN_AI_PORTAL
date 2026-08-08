from __future__ import annotations

import copy
import io
from html import escape
import re
import smtplib
import subprocess
import tempfile
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path

from docx import Document
from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfgen import canvas
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.identity.authorization import require_department, require_permissions
from app.db.session import get_db_session
from app.modules.identity.models import AIUsageEvent, AuditEvent, Department, User
from app.modules.identity.service import role_keys_for_user

router = APIRouter(dependencies=[Depends(require_department("hr"))])
ASSET_ROOT = Path(__file__).resolve().parents[2] / "assets" / "hr_letters"
TEMPLATE_FILES = {
    "offer": "offer-template.pdf",
    "appointment": "appointment-template.docx",
    "spot_appreciation": "spot-appreciation-template.docx",
    "special_increment": "special-increment-template.docx",
}


class LetterRequest(BaseModel):
    template_key: str
    fields: dict[str, str] = Field(default_factory=dict)


class SendLetterRequest(LetterRequest):
    recipient_email: EmailStr
    subject: str = Field(min_length=1, max_length=250)
    message: str = Field(min_length=1, max_length=6000)


class InterviewChecklistRequest(BaseModel):
    fields: dict[str, str] = Field(default_factory=dict)
    rows: list[dict[str, str]] = Field(default_factory=list)


def _paragraphs(document: Document):
    yield from document.paragraphs

    def table_paragraphs(table):
        for row in table.rows:
            for cell in row.cells:
                yield from cell.paragraphs
                for nested in cell.tables:
                    yield from table_paragraphs(nested)

    for table in document.tables:
        yield from table_paragraphs(table)
    for section in document.sections:
        yield from section.header.paragraphs
        yield from section.footer.paragraphs


def _replace_token(paragraph, token: str, value: str) -> None:
    while token in "".join(run.text for run in paragraph.runs):
        combined = "".join(run.text for run in paragraph.runs)
        start = combined.index(token)
        end = start + len(token)
        offsets: list[tuple[int, int]] = []
        cursor = 0
        for run in paragraph.runs:
            offsets.append((cursor, cursor + len(run.text)))
            cursor += len(run.text)
        start_run = next(i for i, (_, right) in enumerate(offsets) if right > start)
        end_run = next(i for i, (_, right) in enumerate(offsets) if right >= end)
        start_left, _ = offsets[start_run]
        end_left, _ = offsets[end_run]
        prefix = paragraph.runs[start_run].text[: start - start_left]
        suffix = paragraph.runs[end_run].text[end - end_left :]
        paragraph.runs[start_run].text = prefix + value + suffix
        for index in range(start_run + 1, end_run + 1):
            paragraph.runs[index].text = ""


def _fill_docx(template_key: str, fields: dict[str, str], workdir: Path) -> Path:
    source = ASSET_ROOT / TEMPLATE_FILES[template_key]
    document = Document(source)
    for paragraph in _paragraphs(document):
        for key in set(re.findall(r"\{\{([^}]+)\}\}", paragraph.text)):
            _replace_token(paragraph, f"{{{{{key}}}}}", fields.get(key, "NIL" if key.startswith("salary_") else ""))
    output = workdir / f"{template_key}.docx"
    document.save(output)
    return output


def _offer_pdf(fields: dict[str, str]) -> bytes:
    source = PdfReader(ASSET_ROOT / TEMPLATE_FILES["offer"])
    page = source.pages[0]
    packet = io.BytesIO()
    overlay = canvas.Canvas(packet, pagesize=(float(page.mediabox.width), float(page.mediabox.height)))
    overlay.setFont("Helvetica", 10.5)
    overlay.drawString(458, 653, fields.get("issue_date", ""))
    overlay.drawString(78, 625, fields.get("employee_name", ""))
    overlay.drawString(264, 601, fields.get("interview_date", ""))
    overlay.drawString(60, 510, fields.get("designation", ""))
    overlay.drawString(310, 510, fields.get("joining_date", ""))
    overlay.drawString(371, 192, fields.get("signatory_name", ""))
    overlay.save()
    packet.seek(0)
    page.merge_page(PdfReader(packet).pages[0])
    writer = PdfWriter()
    writer.add_page(page)
    result = io.BytesIO()
    writer.write(result)
    return result.getvalue()


def _interview_checklist_pdf(fields: dict[str, str], rows: list[dict[str, str]]) -> bytes:
    source_path = ASSET_ROOT / TEMPLATE_FILES["offer"]
    source = PdfReader(source_path)
    page_width = float(source.pages[0].mediabox.width)
    page_height = float(source.pages[0].mediabox.height)
    overlay_buffer = io.BytesIO()
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("InterviewTitle", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=16, leading=20, alignment=TA_CENTER, textColor=colors.HexColor("#17191d"), spaceAfter=12)
    section_style = ParagraphStyle("InterviewSection", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=colors.HexColor("#17191d"), spaceBefore=5, spaceAfter=6)
    label_style = ParagraphStyle("InterviewLabel", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=7.5, leading=10, textColor=colors.HexColor("#666b73"))
    value_style = ParagraphStyle("InterviewValue", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.5, leading=11, textColor=colors.HexColor("#111111"))
    table_header_style = ParagraphStyle("InterviewHeader", parent=value_style, fontName="Helvetica-Bold", textColor=colors.white, alignment=TA_CENTER)

    def paragraph(value: str, style: ParagraphStyle = value_style) -> Paragraph:
        safe = escape(str(value or "")).replace("\n", "<br/>")
        return Paragraph(safe or "&nbsp;", style)

    def branded_page(pdf_canvas, document) -> None:
        pdf_canvas.saveState()
        pdf_canvas.setFillColor(colors.white)
        pdf_canvas.rect(0, 0, page_width, 711, stroke=0, fill=1)
        pdf_canvas.setStrokeColor(colors.HexColor("#d7dade"))
        pdf_canvas.line(42, 708, page_width - 42, 708)
        pdf_canvas.setFillColor(colors.HexColor("#6a7078"))
        pdf_canvas.setFont("Helvetica", 7.5)
        pdf_canvas.drawRightString(page_width - 42, 25, f"Page {document.page}")
        pdf_canvas.restoreState()

    document = SimpleDocTemplate(overlay_buffer, pagesize=(page_width, page_height), leftMargin=42, rightMargin=42, topMargin=158, bottomMargin=38, title="Interview Parameter Checklist", author="Aromazen Private Limited")
    info_rows = [
        ("Candidate name", fields.get("candidate", ""), "Position", fields.get("role", "")),
        ("Department", fields.get("department", ""), "Interview date", fields.get("date", "")),
        ("Interviewer(s)", fields.get("interviewer", ""), "Interview round", fields.get("round", "")),
        ("Present salary", fields.get("present_salary", ""), "Expected salary", fields.get("expected_salary", "")),
        ("Work experience", fields.get("work_experience", ""), "Source / Reference", fields.get("source_reference", "")),
    ]
    info_data = []
    for left_label, left_value, right_label, right_value in info_rows:
        info_data.append([paragraph(left_label, label_style), paragraph(left_value), paragraph(right_label, label_style), paragraph(right_value)])
    info_table = Table(info_data, colWidths=[74, 190, 74, page_width - 42 - 42 - 338], hAlign="LEFT")
    info_table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#c9cdd2")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f0f2f4")),
        ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f0f2f4")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    score_rows = rows or [{"parameter": "", "weight": "", "score": "", "comments": ""}]
    score_data = [[paragraph("Parameter", table_header_style), paragraph("Weight %", table_header_style), paragraph("Score / 5", table_header_style), paragraph("Evidence / comments", table_header_style)]]
    for row in score_rows:
        score_data.append([paragraph(row.get("parameter", "")), paragraph(row.get("weight", "")), paragraph(row.get("score", "")), paragraph(row.get("comments", ""))])
    score_table = Table(score_data, colWidths=[155, 58, 58, page_width - 42 - 42 - 271], repeatRows=1, hAlign="LEFT")
    score_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1c2025")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#bfc4ca")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 1), (2, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f8f9")]),
    ]))
    conclusion = Table([
        [paragraph("Final recommendation", label_style), paragraph(fields.get("recommendation", ""))],
        [paragraph("Overall comments", label_style), paragraph(fields.get("summary", ""))],
    ], colWidths=[120, page_width - 42 - 42 - 120])
    conclusion.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#c9cdd2")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f0f2f4")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story = [
        Paragraph("INTERVIEW PARAMETER CHECKLIST", title_style),
        Paragraph("CANDIDATE DETAILS", section_style),
        info_table,
        Spacer(1, 10),
        Paragraph("EVALUATION SCORECARD", section_style),
        score_table,
        Spacer(1, 12),
        KeepTogether([Paragraph("INTERVIEW DECISION", section_style), conclusion]),
    ]
    document.build(story, onFirstPage=branded_page, onLaterPages=branded_page)
    overlay_buffer.seek(0)
    overlay = PdfReader(overlay_buffer)
    writer = PdfWriter()
    for overlay_page in overlay.pages:
        base_page = copy.deepcopy(source.pages[0])
        base_page.merge_page(overlay_page)
        writer.add_page(base_page)
    result = io.BytesIO()
    writer.write(result)
    return result.getvalue()

def _generate_pdf(template_key: str, fields: dict[str, str]) -> bytes:
    if template_key not in TEMPLATE_FILES:
        raise ValueError("unknown_template")
    if template_key == "offer":
        return _offer_pdf(fields)
    with tempfile.TemporaryDirectory(prefix="aromazen-hr-letter-") as temporary:
        workdir = Path(temporary)
        docx_path = _fill_docx(template_key, fields, workdir)
        result = subprocess.run(
            ["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(workdir), str(docx_path)],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        pdf_path = docx_path.with_suffix(".pdf")
        if result.returncode != 0 or not pdf_path.is_file():
            raise RuntimeError("pdf_conversion_failed")
        return pdf_path.read_bytes()


async def _require_hr(session: AsyncSession, user: User) -> None:
    department = await session.get(Department, user.department_id) if user.department_id else None
    roles = await role_keys_for_user(session, user.id)
    if (department is None or department.name != "HR") and not roles.intersection({"owner", "super_admin", "admin"}):
        raise HTTPException(status_code=403, detail="This letter generator is available only to HR.")


def _send_email(payload: SendLetterRequest, pdf_bytes: bytes) -> None:
    settings = get_settings()
    username = settings.zoho_smtp_username
    password = settings.zoho_smtp_password
    from_email = settings.zoho_from_email or username
    if not username or not password or not from_email:
        raise RuntimeError("zoho_not_configured")
    message = EmailMessage()
    message["From"] = formataddr((settings.zoho_from_name, from_email))
    message["To"] = str(payload.recipient_email)
    message["Subject"] = payload.subject.strip()
    message.set_content(payload.message.strip())
    employee = re.sub(r"[^A-Za-z0-9_-]+", "-", payload.fields.get("employee_name", "employee")).strip("-") or "employee"
    message.add_attachment(pdf_bytes, maintype="application", subtype="pdf", filename=f"{payload.template_key}-{employee}.pdf")
    client = smtplib.SMTP_SSL if settings.zoho_smtp_security.strip().lower() == "ssl" else smtplib.SMTP
    with client(settings.zoho_smtp_host, settings.zoho_smtp_port, timeout=45) as smtp:
        smtp.ehlo()
        if settings.zoho_smtp_security.strip().lower() == "starttls":
            smtp.starttls()
            smtp.ehlo()
        smtp.login(username, password)
        smtp.send_message(message, from_addr=from_email, to_addrs=[str(payload.recipient_email)])


@router.post("/preview")
async def preview_letter(payload: LetterRequest, user: User = Depends(require_permissions("ai.workspace.use")), session: AsyncSession = Depends(get_db_session)) -> StreamingResponse:
    await _require_hr(session, user)
    try:
        pdf = await run_in_threadpool(_generate_pdf, payload.template_key, payload.fields)
    except (ValueError, RuntimeError, subprocess.SubprocessError) as error:
        raise HTTPException(status_code=422, detail="The selected letter could not be generated. Please review the required fields.") from error
    filename = f"{payload.template_key}-{payload.fields.get('employee_name', 'employee')}.pdf"
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{filename}"'})


@router.post("/interview-preview")
async def preview_interview_checklist(payload: InterviewChecklistRequest, user: User = Depends(require_permissions("ai.workspace.use")), session: AsyncSession = Depends(get_db_session)) -> StreamingResponse:
    await _require_hr(session, user)
    try:
        pdf = await run_in_threadpool(_interview_checklist_pdf, payload.fields, payload.rows)
    except Exception as error:
        raise HTTPException(status_code=422, detail="The interview checklist could not be generated. Please review the entered details.") from error
    candidate = re.sub(r"[^A-Za-z0-9_-]+", "-", payload.fields.get("candidate", "candidate")).strip("-") or "candidate"
    filename = f"interview-checklist-{candidate}.pdf"
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{filename}"'})

@router.post("/send")
async def send_letter(payload: SendLetterRequest, user: User = Depends(require_permissions("ai.workspace.use")), session: AsyncSession = Depends(get_db_session)) -> dict:
    await _require_hr(session, user)
    try:
        pdf = await run_in_threadpool(_generate_pdf, payload.template_key, payload.fields)
        await run_in_threadpool(_send_email, payload, pdf)
    except RuntimeError as error:
        if str(error) == "zoho_not_configured":
            raise HTTPException(status_code=503, detail="The HR Zoho Mail account is not configured on the server.") from error
        raise HTTPException(status_code=502, detail="The letter could not be emailed. Please verify Zoho Mail and try again.") from error
    sent_at = datetime.now(timezone.utc).isoformat()
    session.add(AuditEvent(organization_id=user.organization_id, actor_user_id=user.id, action="hr.letter_sent", target_type="hr_letter", target_id=payload.template_key, metadata_json={"recipient": str(payload.recipient_email), "employee": payload.fields.get("employee_name", ""), "subject": payload.subject.strip()}))
    session.add(AIUsageEvent(organization_id=user.organization_id, user_id=user.id, department_id=user.department_id, operation="hr_letter_email", provider="zoho", model="smtp", status="completed"))
    await session.commit()
    return {"status": "sent", "sent_at": sent_at}
