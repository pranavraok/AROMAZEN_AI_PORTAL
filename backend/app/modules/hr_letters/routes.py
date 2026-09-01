from __future__ import annotations

import copy
import io
from html import escape
import os
import re
import shutil
import smtplib
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path

import pdfplumber
from docx import Document
from docx.oxml.ns import qn
from docx.shared import Pt
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, EmailStr, Field
from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfgen import canvas
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.core.config import get_settings
from app.modules.ai.providers import AIProviderRouter, ProviderError, estimate_cost
from app.modules.identity.authorization import department_matches, require_department, require_permissions
from app.db.session import get_db_session
from app.modules.identity.models import AIUsageEvent, AuditEvent, Department, KnowledgeDocument, User
from app.modules.knowledge.department_uploads import DepartmentUpload, replace_department_uploads
from app.modules.identity.service import role_keys_for_user
from app.modules.knowledge.extraction import ExtractionError, extract_text
from app.modules.payroll.engine import UNIT_ADDRESSES
from app.modules.settings.service import provider_runtime_settings

router = APIRouter(dependencies=[Depends(require_department("hr"))])
logger = structlog.get_logger(__name__)
ASSET_ROOT = Path(__file__).resolve().parents[2] / "assets" / "hr_letters"
TEMPLATE_FILES = {
    "offer": "offer-template.pdf",
    "appointment": "appointment-template.docx",
    "spot_appreciation": "spot-appreciation-template.docx",
    "special_increment": "special-increment-template.docx",
}
TEMPLATE_CATALOG = {
    "offer": ("Offer Letter", "Offer", "One-page employment offer letter."),
    "appointment": ("Appointment Letter", "Appointment", "Employment appointment terms and compensation annexure."),
    "spot_appreciation": ("Spot Appreciation Letter", "Spot appreciation", "Employee recognition and appreciation letter."),
    "special_increment": ("Special Increment Letter", "Special increment", "Salary increment confirmation and compensation annexure."),
}
TEMPLATE_CATEGORY_PREFIX = "hr_letter_template:"
SYSTEM_MANAGED_FIELDS = {"unit_address", "unit_name", "unit_number"}
MULTILINE_FIELD_MARKERS = ("address", "reason", "impact", "message", "statement", "comments", "summary", "description")
FIELD_DEFAULTS = {
    "signatory_name": "Ms. Swathi Nayak",
    "signatory_name_kannada": "ಸ್ವಾತಿ ನಾಯಕ್",
    "signatory_title": "Human Resources",
}
TEMPLATE_FIELD_DEFAULTS = {
    "spot_appreciation": {
        "appreciation_reason": "It gives us great pleasure to appreciate your alertness and proactive approach.",
        "reward_statement": "We recognise your initiative and the positive impact of your contribution. As a token of our appreciation, please accept this reward.",
        "closing_message": "Thank you for your dedication and good work. Keep up the excellent performance.",
        "signatory_name": "Mrs. Deeksha",
        "signatory_title": "Accounts & HR Head",
    },
}
OFFER_FIELDS = ("issue_date", "employee_name", "interview_date", "designation", "joining_date", "signatory_name")
OFFER_DATE_FIELDS = {"issue_date", "interview_date", "joining_date"}
OFFER_PDF_FIELD_WIDTHS = {
    "issue_date": 105,
    "employee_name": 220,
    "interview_date": 145,
    "designation": 220,
    "joining_date": 220,
    "signatory_name": 190,
}
EXPECTED_APPOINTMENT_PAGE_COUNT = 10
KANNADA_FONT_NAME = (
    "Nirmala UI"
    if sys.platform == "win32"
    or os.environ.get("DOCUMENT_CONVERTER_URL")
    or os.environ.get("DOCUMENT_CONVERTER_DIR")
    else "Noto Sans Kannada"
)
APPOINTMENT_REQUIRED_FIELDS = {
    "reference_number",
    "issue_date",
    "employee_salutation_name",
    "employee_name",
    "employee_address",
    "employee_phone",
    "designation",
    "joining_date",
    "reporting_officer",
    "gross_salary",
    "gross_salary_words",
    "signatory_name",
    "signatory_title",
}


class LetterRequest(BaseModel):
    template_key: str
    unit_number: int = Field(default=1, ge=1, le=3)
    fields: dict[str, str] = Field(default_factory=dict)


class SendLetterRequest(LetterRequest):
    recipient_email: EmailStr
    subject: str = Field(min_length=1, max_length=250)
    message: str = Field(min_length=1, max_length=6000)


class InterviewChecklistRequest(BaseModel):
    fields: dict[str, str] = Field(default_factory=dict)
    rows: list[dict[str, str]] = Field(default_factory=list)


class KannadaTranslationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


def _fields_for_unit(fields: dict[str, str], unit_number: int) -> dict[str, str]:
    return {
        **fields,
        "unit_number": str(unit_number),
        "unit_name": f"Unit {unit_number}",
        "unit_address": UNIT_ADDRESSES[str(unit_number)],
    }


def _template_category(template_key: str) -> str:
    return f"{TEMPLATE_CATEGORY_PREFIX}{template_key}"


def _field_label(key: str) -> str:
    return re.sub(r"\s+", " ", key.replace("_", " ")).strip().title()


def _template_tokens(path: Path) -> list[str]:
    if path.suffix.lower() != ".docx":
        return list(OFFER_FIELDS) if path.suffix.lower() == ".pdf" else []
    document = Document(path)
    tokens: list[str] = []
    for paragraph in _paragraphs(document):
        for key in re.findall(r"\{\{\s*([^}]+?)\s*\}\}", paragraph.text):
            cleaned = key.strip()
            if cleaned and cleaned not in tokens:
                tokens.append(cleaned)
    return tokens


def _template_schema(template_key: str, path: Path) -> dict:
    tokens = _template_tokens(path)
    defaults = {**FIELD_DEFAULTS, **TEMPLATE_FIELD_DEFAULTS.get(template_key, {})}
    normal_fields = []
    salary_groups: dict[str, dict] = {}
    for key in tokens:
        salary_match = re.fullmatch(r"salary_(.+)_(existing|revised|monthly|annual)", key)
        if salary_match:
            row_key, column = salary_match.groups()
            group = salary_groups.setdefault(row_key, {"key": row_key, "label": _field_label(row_key), "columns": []})
            if column not in group["columns"]:
                group["columns"].append(column)
            continue
        if key in SYSTEM_MANAGED_FIELDS:
            continue
        normal_fields.append({
            "key": key,
            "label": _field_label(key),
            "multiline": any(marker in key.lower() for marker in MULTILINE_FIELD_MARKERS),
            "required": template_key == "appointment" and key in APPOINTMENT_REQUIRED_FIELDS,
            "default_value": defaults.get(key, ""),
        })
    return {"fields": normal_fields, "salary_rows": list(salary_groups.values()), "detected_field_count": len(tokens)}


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


def _legacy_appointment_layout(document: Document) -> bool:
    return (
        len(document.paragraphs) > 263
        and bool(document.tables)
        and any(paragraph.text.strip().startswith("a. Compensation:") for paragraph in document.paragraphs)
        and any(paragraph.text.strip().startswith("ಪರಿಹಾರ:") for paragraph in document.paragraphs)
    )


def _replace_token(
    paragraph,
    token: str,
    value: str,
    font_name: str | None = None,
    font_size: float | None = None,
) -> None:
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
        if font_name:
            run = paragraph.runs[start_run]
            run.font.name = font_name
            run_properties = run._element.get_or_add_rPr()
            run_fonts = run_properties.get_or_add_rFonts()
            for font_type in ("ascii", "hAnsi", "eastAsia", "cs"):
                run_fonts.set(qn(f"w:{font_type}"), font_name)
        if font_size:
            paragraph.runs[start_run].font.size = Pt(font_size)
        for index in range(start_run + 1, end_run + 1):
            paragraph.runs[index].text = ""


def _fill_docx(
    template_key: str,
    fields: dict[str, str],
    workdir: Path,
    *,
    appointment_scale: float = 1.0,
    source_path: Path | None = None,
) -> Path:
    source = source_path or ASSET_ROOT / TEMPLATE_FILES[template_key]
    document = Document(source)
    for paragraph in _paragraphs(document):
        for key in set(re.findall(r"\{\{([^}]+)\}\}", paragraph.text)):
            value = fields.get(key, "").strip()
            if key.startswith("salary_") and not value:
                value = "NIL"
            _replace_token(
                paragraph,
                f"{{{{{key}}}}}",
                value,
                font_name=KANNADA_FONT_NAME if key.endswith("_kannada") else None,
                # Keep the exact size defined by the approved Word template.
                # Enlarging replacement values changes wrapping and moves the
                # date, section 9, and annexure to different pages.
                font_size=None,
            )
    legacy_appointment = template_key == "appointment" and _legacy_appointment_layout(document)
    if legacy_appointment:
        # Rebuild the bilingual compensation sentences so currency words are
        # stated exactly once and Kannada shaping/spacing stays consistent.
        english_compensation = next(
            paragraph
            for paragraph in document.paragraphs
            if paragraph.text.strip().startswith("a. Compensation:")
        )
        english_compensation.clear()

        def add_english(text: str, *, bold: bool = False, underline: bool = False) -> None:
            run = english_compensation.add_run(text)
            run.bold = bold
            run.underline = underline
            run.font.name = "Arial"
            run.font.size = Pt(10)

        add_english("a. Compensation: ", bold=True)
        add_english("You will receive a ")
        add_english("Gross salary of Rs. ", bold=True)
        add_english(fields.get("gross_salary", "").strip(), bold=True, underline=True)
        add_english(" (")
        add_english(fields.get("gross_salary_words", "").strip(), bold=True, underline=True)
        add_english(") per month, subject to tax deduction at source in accordance with the Income Tax Act and any other applicable statutory deductions.")

        kannada_compensation = next(
            paragraph
            for paragraph in document.paragraphs
            if paragraph.text.strip().startswith("ಪರಿಹಾರ:")
        )
        kannada_compensation.clear()

        def add_kannada(text: str, *, bold: bool = False, underline: bool = False) -> None:
            run = kannada_compensation.add_run(text)
            run.bold = bold
            run.underline = underline
            run.font.name = KANNADA_FONT_NAME
            run.font.size = Pt(11)
            run_fonts = run._element.get_or_add_rPr().get_or_add_rFonts()
            for font_type in ("ascii", "hAnsi", "eastAsia", "cs"):
                run_fonts.set(qn(f"w:{font_type}"), KANNADA_FONT_NAME)

        add_kannada("ಪರಿಹಾರ: ", bold=True)
        add_kannada("ನೀವು ರೂ. ")
        add_kannada(fields.get("gross_salary", "").strip(), underline=True)
        add_kannada(" (")
        add_kannada(fields.get("gross_salary_words_kannada", "").strip(), underline=True)
        add_kannada(") ಒಟ್ಟು ಮಾಸಿಕ ವೇತನವನ್ನು ಪಡೆಯುತ್ತೀರಿ. ಆದಾಯ ತೆರಿಗೆ ಕಾಯ್ದೆ ಮತ್ತು ಅನ್ವಯವಾಗುವ ಇತರ ಶಾಸನಬದ್ಧ ಕಡಿತಗಳಿಗೆ ಅನುಸಾರವಾಗಿ ಮೂಲದಲ್ಲೇ ತೆರಿಗೆ ಕಡಿತಗೊಳಿಸಲಾಗುತ್ತದೆ.")

        # Keep the bilingual confidentiality label legible. The source used
        # manual spaces inside the Kannada words, which rendered as cramped
        # and malformed text in the PDF.
        confidentiality_kannada = document.paragraphs[2]
        confidentiality_kannada.text = "ಖಾಸಗಿ ಮತ್ತು ಗೌಪ್ಯ"
        confidentiality_kannada.paragraph_format.space_before = Pt(2)
        confidentiality_kannada.paragraph_format.space_after = Pt(3)
        confidentiality_kannada.paragraph_format.line_spacing = 1.15
        for run in confidentiality_kannada.runs:
            run.font.name = KANNADA_FONT_NAME
            run.font.size = Pt(11)
            run_fonts = run._element.get_or_add_rPr().get_or_add_rFonts()
            for font_type in ("ascii", "hAnsi", "eastAsia", "cs"):
                run_fonts.set(qn(f"w:{font_type}"), KANNADA_FONT_NAME)
        # Preserve the supplied dummy document's native margins, paragraph
        # rhythm, blank spacer paragraphs and run sizes. Those blank paragraphs
        # are intentional signing space, not disposable whitespace.
        # Do not force page-end signature blocks. The dummy document uses its
        # own blank paragraphs and Word pagination to position these blocks.
        signature_lines = (27, 57, 86, 108, 131, 154, 185, 214, 251, 262)
        signature_blocks = (28, 58, 87, 109, 132, 155, 186, 215, 252, 263)
        for line_index, block_index in zip(signature_lines, signature_blocks):
            document.paragraphs[line_index].paragraph_format.keep_with_next = True
            document.paragraphs[block_index].paragraph_format.keep_together = True
        # The annexure acceptance signature needs an actual handwriting area.
        # Reserve this independently of removable blank template paragraphs so
        # the portal's Word-to-PDF conversion cannot collapse the gap.
        document.paragraphs[signature_lines[-1]].paragraph_format.space_before = Pt(42)
        # Preserve the dummy document's ten logical page sections. Dynamic
        # employee data must not pull the following section upward onto the
        # preceding signature page.
        for page_start in (29, 59, 89, 111, 134, 158, 188, 217, 253):
            document.paragraphs[page_start].paragraph_format.page_break_before = True
        # Section 9 follows the page-8 employee/date block; pairing it with
        # clause 9.1 prevents the heading from being orphaned on page 7.
        document.paragraphs[188].paragraph_format.keep_with_next = True
        # The joining confirmation naturally follows the page-9 employee/date
        # block in the approved template; an explicit break creates a blank page.
        # Keep the annexure label and subtitle paired at the page 9/10 boundary.
        document.paragraphs[253].paragraph_format.keep_with_next = True
        document.paragraphs[254].paragraph_format.keep_with_next = True
        # Keep table row heights flexible, but retain the template's own font
        # sizes and cell spacing.
        table = document.tables[0]
        removed_annexure_labels = {
            "Residential Telephone Reimbursement*",
            "Car fuel and Maintenance Allowance",
        }
        for row in list(table.rows):
            if row.cells[0].text.strip() in removed_annexure_labels:
                table._tbl.remove(row._tr)
        for row in table.rows:
            row.height = None
        # Reclaim exactly one of the dummy's repeated empty spacer lines before
        # each signature. Do this last so fixed template anchors above remain
        # valid while their formatting is applied.
        for line_index in reversed(signature_lines):
            removals_needed = 2 if line_index == signature_lines[0] else 1
            for _ in range(removals_needed):
                current_line_index = next(
                    index
                    for index, paragraph in enumerate(document.paragraphs)
                    if paragraph.text.strip() == "________________"
                    and index <= line_index
                ) if line_index == signature_lines[0] else line_index
                for candidate_index in range(current_line_index - 1, -1, -1):
                    candidate = document.paragraphs[candidate_index]
                    if not candidate.text.strip():
                        candidate._element.getparent().remove(candidate._element)
                        break
    if legacy_appointment and appointment_scale < 1.0:
        for style in document.styles:
            style_font = getattr(style, "font", None)
            if style_font is not None and style_font.size:
                style_font.size = Pt(style_font.size.pt * appointment_scale)
        for paragraph in _paragraphs(document):
            for run in paragraph.runs:
                if run.font.size:
                    run.font.size = Pt(run.font.size.pt * appointment_scale)
            formatting = paragraph.paragraph_format
            if formatting.space_before:
                formatting.space_before = Pt(formatting.space_before.pt * appointment_scale)
            if formatting.space_after:
                formatting.space_after = Pt(formatting.space_after.pt * appointment_scale)
    output = workdir / f"{template_key}.docx"
    document.save(output)
    return output


def _validate_letter_fields(template_key: str, fields: dict[str, str], template_path: Path | None = None) -> None:
    if template_key != "appointment":
        return
    required = APPOINTMENT_REQUIRED_FIELDS
    if template_path and template_path.suffix.lower() == ".docx":
        required = required.intersection(_template_tokens(template_path))
    missing = sorted(key for key in required if not fields.get(key, "").strip())
    if missing:
        raise ValueError(f"missing_fields:{','.join(missing)}")


def _convert_with_libreoffice(docx_path: Path, output_dir: Path, executable: str) -> Path:
    profile_dir = output_dir / "libreoffice-profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    profile_uri = profile_dir.resolve().as_uri()
    environment = os.environ.copy()
    environment["HOME"] = str(output_dir)
    result = subprocess.run(
        [
            executable,
            "--headless",
            "--nologo",
            "--nodefault",
            "--nolockcheck",
            f"-env:UserInstallation={profile_uri}",
            "--convert-to",
            "pdf",
            "--outdir",
            str(output_dir),
            str(docx_path),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
        env=environment,
    )
    pdf_path = output_dir / f"{docx_path.stem}.pdf"
    if result.returncode != 0 or not pdf_path.is_file() or pdf_path.stat().st_size == 0:
        logger.error(
            "hr_letter_libreoffice_conversion_failed",
            return_code=result.returncode,
            stdout=result.stdout[-2000:],
            stderr=result.stderr[-2000:],
        )
        raise RuntimeError("pdf_conversion_failed")
    return pdf_path


def _convert_with_microsoft_word(docx_path: Path, output_dir: Path) -> Path:
    powershell = shutil.which("powershell.exe") or shutil.which("powershell")
    program_roots = {
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")),
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")),
    }
    word_available = any(
        (root / "Microsoft Office/root/Office16/WINWORD.EXE").is_file()
        for root in program_roots
    )
    if not powershell or not word_available:
        raise RuntimeError("document_converter_unavailable")
    pdf_path = output_dir / f"{docx_path.stem}.pdf"
    script_path = output_dir / "convert-docx.ps1"
    script_path.write_text(
        """param([string]$InputDocx, [string]$OutputPdf)
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $document = $word.Documents.Open($InputDocx, $false, $true)
  try { $document.ExportAsFixedFormat($OutputPdf, 17) } finally { $document.Close($false) }
} finally { try { $word.Quit() } catch {} }
""",
        encoding="utf-8-sig",
    )
    result = subprocess.run(
        [
            powershell,
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script_path),
            str(docx_path.resolve()),
            str(pdf_path.resolve()),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if result.returncode != 0 or not pdf_path.is_file() or pdf_path.stat().st_size == 0:
        logger.error(
            "hr_letter_word_conversion_failed",
            return_code=result.returncode,
            stdout=result.stdout[-2000:],
            stderr=result.stderr[-2000:],
        )
        raise RuntimeError("pdf_conversion_failed")
    return pdf_path


def _convert_docx_to_pdf(docx_path: Path, output_dir: Path) -> Path:
    converter_dir_value = os.environ.get("DOCUMENT_CONVERTER_DIR", "").strip()
    if converter_dir_value:
        converter_dir = Path(converter_dir_value)
        request_id = uuid.uuid4().hex
        request_path = converter_dir / f"{request_id}.docx"
        response_path = converter_dir / f"{request_id}.pdf"
        error_path = converter_dir / f"{request_id}.error"
        converter_dir.mkdir(parents=True, exist_ok=True)
        request_path.write_bytes(docx_path.read_bytes())
        try:
            deadline = datetime.now(timezone.utc).timestamp() + 150
            while datetime.now(timezone.utc).timestamp() < deadline:
                if response_path.is_file() and response_path.stat().st_size:
                    pdf_bytes = response_path.read_bytes()
                    if not pdf_bytes.startswith(b"%PDF-"):
                        raise RuntimeError("pdf_conversion_failed")
                    pdf_path = output_dir / f"{docx_path.stem}.pdf"
                    pdf_path.write_bytes(pdf_bytes)
                    return pdf_path
                if error_path.is_file():
                    logger.error("hr_letter_word_bridge_failed", error=error_path.read_text(errors="replace")[-1000:])
                    raise RuntimeError("pdf_conversion_failed")
                time.sleep(0.2)
            raise RuntimeError("pdf_conversion_failed")
        finally:
            for path in (request_path, response_path, error_path):
                path.unlink(missing_ok=True)
    converter_url = os.environ.get("DOCUMENT_CONVERTER_URL", "").strip()
    if converter_url:
        request = urllib.request.Request(
            converter_url,
            data=docx_path.read_bytes(),
            headers={"Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=150) as response:
                pdf_bytes = response.read()
        except (urllib.error.URLError, TimeoutError) as error:
            logger.error("hr_letter_word_bridge_failed", error=str(error))
            raise RuntimeError("pdf_conversion_failed") from error
        if not pdf_bytes.startswith(b"%PDF-"):
            raise RuntimeError("pdf_conversion_failed")
        pdf_path = output_dir / f"{docx_path.stem}.pdf"
        pdf_path.write_bytes(pdf_bytes)
        return pdf_path
    executable = shutil.which("soffice") or shutil.which("libreoffice")
    if executable:
        return _convert_with_libreoffice(docx_path, output_dir, executable)
    if sys.platform == "win32":
        return _convert_with_microsoft_word(docx_path, output_dir)
    raise RuntimeError("document_converter_unavailable")


def _trim_appointment_footer_overflow(pdf_bytes: bytes) -> bytes:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    keep_count = len(reader.pages)
    while keep_count > EXPECTED_APPOINTMENT_PAGE_COUNT:
        text = reader.pages[keep_count - 1].extract_text() or ""
        body = re.sub(r"Page\s+\d+\s+of\s+\d+", "", text, flags=re.IGNORECASE)
        body = re.sub(r"Date\s*/?[^:]*:\s*[0-9/.-]+", "", body, flags=re.IGNORECASE)
        body = re.sub(r"[\s\W_]+", "", body, flags=re.UNICODE)
        if body:
            break
        keep_count -= 1
    if keep_count == len(reader.pages):
        return pdf_bytes
    writer = PdfWriter()
    for page in reader.pages[:keep_count]:
        writer.add_page(page)
    output = io.BytesIO()
    writer.write(output)
    logger.info(
        "appointment_letter_footer_overflow_trimmed",
        original_page_count=len(reader.pages),
        final_page_count=keep_count,
    )
    return output.getvalue()


def _offer_pdf(fields: dict[str, str], template_path: Path | None = None) -> bytes:
    source_path = template_path or ASSET_ROOT / TEMPLATE_FILES["offer"]
    source = PdfReader(source_path)
    page = source.pages[0]
    packet = io.BytesIO()
    page_width = float(page.mediabox.width)
    page_height = float(page.mediabox.height)
    overlay = canvas.Canvas(packet, pagesize=(page_width, page_height))
    # Canva preserves the design's custom page dimensions when exporting. Scale
    # the approved A4 mapping so uploaded Canva PDFs and the built-in A4 starter
    # use the same logical field positions.
    scale_x = page_width / 595.276
    scale_y = page_height / 841.89
    font_scale = min(scale_x, scale_y)

    def display_value(key: str) -> str:
        value = fields.get(key, "").strip()
        if key in OFFER_DATE_FIELDS:
            date_match = re.fullmatch(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", value)
            if date_match:
                value = f"{int(date_match.group(1)):02d}-{int(date_match.group(2)):02d}-{date_match.group(3)}"
        if key == "employee_name" and value and not value.endswith(","):
            value = f"{value},"
        return value

    unit_address = display_value("unit_address")
    placeholder_pattern = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")
    placeholder_words: list[tuple[dict, re.Match[str]]] = []
    expanded_line_keys: set[str] = set()
    try:
        with pdfplumber.open(source_path) as template_pdf:
            template_page = template_pdf.pages[0]
            expanded_lines: dict[str, tuple[dict, re.Match[str]]] = {}
            for line in template_page.extract_text_lines(strip=True, return_chars=False):
                line_match = placeholder_pattern.search(str(line.get("text", "")))
                if not line_match:
                    continue
                line_key = line_match.group(1).lower()
                if line_key in {"issue_date", "employee_name", "interview_date"}:
                    expanded_lines[line_key] = (line, line_match)
                    expanded_line_keys.add(line_key)
            seen_keys: set[str] = set()
            for word in template_page.extract_words():
                match = placeholder_pattern.search(str(word.get("text", "")))
                if not match:
                    continue
                key = match.group(1).lower()
                if key not in {*OFFER_FIELDS, *SYSTEM_MANAGED_FIELDS} or key in seen_keys:
                    continue
                placeholder_words.append(expanded_lines.get(key, (word, match)))
                seen_keys.add(key)
    except Exception as error:
        logger.warning("offer_pdf_placeholder_detection_failed", error=str(error))

    overlay.setFillColor(colors.white)
    if placeholder_words:
        for word, match in placeholder_words:
            key = match.group(1).lower()
            word_top = float(word["top"])
            word_bottom = float(word["bottom"])
            if key == "unit_address":
                left = 48 * scale_x
                width = page_width - 96 * scale_x
            else:
                left = float(word["x0"]) - 2 * scale_x
                width = float(word["x1"]) - float(word["x0"]) + 4 * scale_x
            overlay.rect(
                left,
                page_height - word_bottom - 2 * scale_y,
                width,
                word_bottom - word_top + 4 * scale_y,
                stroke=0,
                fill=1,
            )

        overlay.setFillColor(colors.HexColor("#24272b"))
        for word, match in placeholder_words:
            key = match.group(1).lower()
            raw_text = str(word["text"])
            value = f"{raw_text[:match.start()]}{display_value(key)}{raw_text[match.end():]}"
            font_size = (8.4 if key == "unit_address" else 10.5) * font_scale
            maximum_width = (
                page_width - 110 * scale_x
                if key == "unit_address"
                else page_width - float(word["x0"]) - 75 * scale_x
                if key in expanded_line_keys
                else OFFER_PDF_FIELD_WIDTHS.get(key, 220) * scale_x
            )
            minimum_font_size = 6 * font_scale
            while font_size > minimum_font_size and overlay.stringWidth(value, "Helvetica", font_size) > maximum_width:
                font_size -= 0.2 * font_scale
            overlay.setFont("Helvetica", font_size)
            baseline = page_height - float(word["bottom"])
            if key == "unit_address":
                overlay.drawCentredString(page_width / 2, baseline, value)
            else:
                overlay.drawString(float(word["x0"]), baseline, value)
    else:
        # Backward-compatible mapping for the original blank A4 starter.
        placeholder_areas = (
            (48, 716, page_width / scale_x - 96, 22),
            (448, 646, 105, 15),
            (72, 618, 220, 15),
            (255, 594, 145, 15),
            (55, 500, 220, 25),
            (305, 500, 220, 25),
            (365, 185, 190, 17),
        )
        for left, bottom, width, height in placeholder_areas:
            overlay.rect(left * scale_x, bottom * scale_y, width * scale_x, height * scale_y, stroke=0, fill=1)
        overlay.setFillColor(colors.HexColor("#24272b"))
        address_font_size = 8.4 * font_scale
        while (
            address_font_size > 6 * font_scale
            and overlay.stringWidth(unit_address, "Helvetica", address_font_size) > page_width - 110 * scale_x
        ):
            address_font_size -= 0.2 * font_scale
        overlay.setFont("Helvetica", address_font_size)
        overlay.drawCentredString(page_width / 2, 723 * scale_y, unit_address)
        overlay.setFont("Helvetica", 10.5 * font_scale)
        overlay.drawString(458 * scale_x, 653 * scale_y, display_value("issue_date"))
        overlay.drawString(78 * scale_x, 625 * scale_y, display_value("employee_name"))
        overlay.drawString(264 * scale_x, 601 * scale_y, display_value("interview_date"))
        overlay.drawString(60 * scale_x, 510 * scale_y, display_value("designation"))
        overlay.drawString(310 * scale_x, 510 * scale_y, display_value("joining_date"))
        overlay.drawString(371 * scale_x, 192 * scale_y, display_value("signatory_name"))
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

def _generate_pdf(template_key: str, fields: dict[str, str], template_path: Path | None = None) -> bytes:
    if template_key not in TEMPLATE_FILES:
        raise ValueError("unknown_template")
    source_path = template_path or ASSET_ROOT / TEMPLATE_FILES[template_key]
    _validate_letter_fields(template_key, fields, source_path)
    if source_path.suffix.lower() == ".pdf":
        if template_key != "offer":
            raise ValueError("pdf_template_requires_docx")
        return _offer_pdf(fields, source_path)
    legacy_appointment = template_key == "appointment" and _legacy_appointment_layout(Document(source_path))
    with tempfile.TemporaryDirectory(prefix="aromazen-hr-letter-") as temporary:
        workdir = Path(temporary)
        docx_path = _fill_docx(template_key, fields, workdir, source_path=source_path)
        pdf_path = _convert_docx_to_pdf(docx_path, workdir)
        pdf_bytes = pdf_path.read_bytes()
        if legacy_appointment:
            page_count = len(PdfReader(io.BytesIO(pdf_bytes)).pages)
            if (
                page_count > EXPECTED_APPOINTMENT_PAGE_COUNT
                and not os.environ.get("DOCUMENT_CONVERTER_URL")
                and not os.environ.get("DOCUMENT_CONVERTER_DIR")
            ):
                for scale in (0.96, 0.92, 0.88, 0.84, 0.80, 0.76, 0.72):
                    compact_dir = workdir / f"compact-{int(scale * 100)}"
                    compact_dir.mkdir()
                    compact_docx = _fill_docx(
                        template_key,
                        fields,
                        compact_dir,
                        appointment_scale=scale,
                        source_path=source_path,
                    )
                    compact_pdf = _convert_docx_to_pdf(compact_docx, compact_dir)
                    compact_bytes = compact_pdf.read_bytes()
                    compact_page_count = len(PdfReader(io.BytesIO(compact_bytes)).pages)
                    if compact_page_count <= page_count:
                        pdf_bytes = compact_bytes
                        page_count = compact_page_count
                    if page_count <= EXPECTED_APPOINTMENT_PAGE_COUNT:
                        break
            if page_count != EXPECTED_APPOINTMENT_PAGE_COUNT:
                pdf_bytes = _trim_appointment_footer_overflow(pdf_bytes)
                page_count = len(PdfReader(io.BytesIO(pdf_bytes)).pages)
            if page_count != EXPECTED_APPOINTMENT_PAGE_COUNT:
                logger.warning(
                    "appointment_letter_page_count_changed",
                    expected_page_count=EXPECTED_APPOINTMENT_PAGE_COUNT,
                    actual_page_count=page_count,
                )
        return pdf_bytes


async def _require_hr(session: AsyncSession, user: User) -> None:
    department = await session.get(Department, user.department_id) if user.department_id else None
    roles = await role_keys_for_user(session, user.id)
    if not department_matches(department, "hr") and not roles.intersection({"owner", "super_admin", "admin"}):
        raise HTTPException(status_code=403, detail="This letter generator is available only to HR.")


async def _active_template_document(session: AsyncSession, organization_id: uuid.UUID, template_key: str) -> KnowledgeDocument | None:
    return await session.scalar(
        select(KnowledgeDocument)
        .where(
            KnowledgeDocument.organization_id == organization_id,
            KnowledgeDocument.document_category == _template_category(template_key),
            KnowledgeDocument.status == "ready",
        )
        .order_by(KnowledgeDocument.version.desc(), KnowledgeDocument.created_at.desc())
    )


async def _template_source(
    session: AsyncSession,
    organization_id: uuid.UUID,
    template_key: str,
) -> tuple[Path, KnowledgeDocument | None]:
    document = await _active_template_document(session, organization_id, template_key)
    if document:
        path = Path(get_settings().upload_storage_path) / document.stored_filename
        if path.is_file():
            return path, document
    return ASSET_ROOT / TEMPLATE_FILES[template_key], None


def _template_response(template_key: str, path: Path, document: KnowledgeDocument | None) -> dict:
    title, short, description = TEMPLATE_CATALOG[template_key]
    return {
        "key": template_key,
        "title": title,
        "short": short,
        "description": description,
        "filename": document.original_filename if document else path.name,
        "version": document.version if document else 1,
        "source": "knowledge" if document else "built_in",
        "uploaded_at": document.created_at.isoformat() if document else None,
        "supports_dynamic_fields": template_key == "offer" or path.suffix.lower() == ".docx",
        **_template_schema(template_key, path),
    }


@router.get("/templates")
async def list_letter_templates(
    user: User = Depends(require_permissions("ai.workspace.use")),
    session: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    await _require_hr(session, user)
    result = []
    for template_key in TEMPLATE_FILES:
        path, document = await _template_source(session, user.organization_id, template_key)
        result.append(_template_response(template_key, path, document))
    return result


@router.get("/templates/{template_key}/content")
async def letter_template_content(
    template_key: str,
    user: User = Depends(require_permissions("ai.workspace.use")),
    session: AsyncSession = Depends(get_db_session),
) -> FileResponse:
    await _require_hr(session, user)
    if template_key not in TEMPLATE_FILES:
        raise HTTPException(status_code=404, detail="HR template not found.")
    path, document = await _template_source(session, user.organization_id, template_key)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="HR template file is unavailable.")
    return FileResponse(path, filename=document.original_filename if document else path.name, content_disposition_type="inline")


@router.post("/templates/{template_key}")
async def replace_letter_template(
    template_key: str,
    template_file: UploadFile = File(...),
    user: User = Depends(require_permissions("knowledge.write")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _require_hr(session, user)
    if template_key not in TEMPLATE_FILES:
        raise HTTPException(status_code=404, detail="HR template not found.")
    original_filename = Path(template_file.filename or "template.docx").name
    extension = Path(original_filename).suffix.lower()
    if extension != ".docx" and not (template_key == "offer" and extension == ".pdf"):
        detail = (
            "Upload a PDF or DOCX Offer Letter template."
            if template_key == "offer"
            else "Upload a DOCX template containing {{field_name}} placeholders so its fields can be mapped automatically."
        )
        raise HTTPException(status_code=422, detail=detail)
    content = await template_file.read()
    if len(content) > get_settings().max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="The HR template is too large.")
    validation_path = (
        Path(get_settings().upload_storage_path)
        / f"hr-template-validation-{uuid.uuid4()}{extension}"
    )
    validation_path.parent.mkdir(parents=True, exist_ok=True)
    validation_path.write_bytes(content)
    try:
        if extension == ".docx":
            tokens = _template_tokens(validation_path)
            if not tokens:
                raise ValueError("missing_placeholders")
            extract_text(validation_path, ".docx")
        elif len(PdfReader(validation_path).pages) != 1:
            raise ValueError("offer_pdf_page_count")
    except (ValueError, ExtractionError, PdfReadError) as error:
        detail = (
            "Upload a valid one-page Offer Letter PDF."
            if extension == ".pdf"
            else "No usable {{field_name}} placeholders were found in this DOCX template."
        )
        raise HTTPException(status_code=422, detail=detail) from error
    finally:
        validation_path.unlink(missing_ok=True)
    documents = await replace_department_uploads(session, user, "hr", [DepartmentUpload(
        f"hr-letter-template:{template_key}",
        content,
        original_filename,
        (
            "application/pdf"
            if extension == ".pdf"
            else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ),
        _template_category(template_key),
    )])
    document = documents[0]
    destination = Path(get_settings().upload_storage_path) / document.stored_filename
    return _template_response(template_key, destination, document)


@router.post("/translate-kannada")
async def translate_kannada(
    payload: KannadaTranslationRequest,
    user: User = Depends(require_permissions("ai.workspace.use")),
    session: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    await _require_hr(session, user)
    runtime_settings = await provider_runtime_settings(session, user.organization_id)
    translation = ""
    provider = ""
    model = ""
    input_tokens = 0
    output_tokens = 0
    system = (
        "Translate the supplied English text into natural, professional Kannada suitable for an employee "
        "appointment letter. Transliterate personal names and job titles appropriately. Preserve dates, numbers, "
        "and company names accurately. Return only the Kannada translation with no label, explanation, or quotes."
    )
    try:
        async for event in AIProviderRouter(runtime_settings).stream(system, payload.text.strip(), payload.text):
            provider = event.provider
            model = event.model
            if event.kind == "delta":
                translation += event.text
            elif event.kind == "usage":
                input_tokens = event.input_tokens
                output_tokens = event.output_tokens
    except ProviderError as error:
        logger.warning(
            "kannada_translation_provider_error",
            provider=error.provider,
            code=error.code,
            retryable=error.retryable,
        )
        raise HTTPException(status_code=503, detail="The Kannada translator is temporarily unavailable. Please try again.") from error
    translation = translation.strip()
    if not translation:
        raise HTTPException(status_code=502, detail="The Kannada translator returned an empty result. Please try again.")
    session.add(AIUsageEvent(
        organization_id=user.organization_id,
        user_id=user.id,
        department_id=user.department_id,
        operation="hr_kannada_translation",
        provider=provider,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=estimate_cost(provider, model, input_tokens, output_tokens),
        status="completed",
    ))
    await session.commit()
    return {"translation": translation}


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
    message.add_attachment(pdf_bytes, maintype="application", subtype="pdf", filename=f"{payload.template_key}-unit-{payload.unit_number}-{employee}.pdf")
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
    if payload.template_key not in TEMPLATE_FILES:
        raise HTTPException(status_code=404, detail="HR template not found.")
    template_path, _ = await _template_source(session, user.organization_id, payload.template_key)
    letter_fields = _fields_for_unit(payload.fields, payload.unit_number)
    try:
        pdf = await run_in_threadpool(_generate_pdf, payload.template_key, letter_fields, template_path)
    except ValueError as error:
        if str(error).startswith("missing_fields:"):
            missing = str(error).split(":", 1)[1].replace("_", " ").replace(",", ", ")
            raise HTTPException(status_code=422, detail=f"Complete these appointment fields: {missing}.") from error
        raise HTTPException(status_code=422, detail="The selected letter template is not valid.") from error
    except RuntimeError as error:
        if str(error) == "document_converter_unavailable":
            raise HTTPException(status_code=503, detail="The server document converter is unavailable. Please contact the administrator.") from error
        logger.exception("hr_letter_preview_failed", template_key=payload.template_key, error=str(error))
        raise HTTPException(status_code=500, detail="The server could not convert the letter to PDF. Please try again or contact the administrator.") from error
    except subprocess.SubprocessError as error:
        logger.exception("hr_letter_preview_converter_failed", template_key=payload.template_key)
        raise HTTPException(status_code=500, detail="The server document converter timed out. Please try again.") from error
    filename = f"{payload.template_key}-unit-{payload.unit_number}-{payload.fields.get('employee_name', 'employee')}.pdf"
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
    if payload.template_key not in TEMPLATE_FILES:
        raise HTTPException(status_code=404, detail="HR template not found.")
    template_path, _ = await _template_source(session, user.organization_id, payload.template_key)
    letter_fields = _fields_for_unit(payload.fields, payload.unit_number)
    try:
        pdf = await run_in_threadpool(_generate_pdf, payload.template_key, letter_fields, template_path)
        await run_in_threadpool(_send_email, payload, pdf)
    except ValueError as error:
        if str(error).startswith("missing_fields:"):
            missing = str(error).split(":", 1)[1].replace("_", " ").replace(",", ", ")
            raise HTTPException(status_code=422, detail=f"Complete these appointment fields: {missing}.") from error
        raise HTTPException(status_code=422, detail="The selected letter template is not valid.") from error
    except RuntimeError as error:
        if str(error) == "zoho_not_configured":
            raise HTTPException(status_code=503, detail="The HR Zoho Mail account is not configured on the server.") from error
        if str(error) == "document_converter_unavailable":
            raise HTTPException(status_code=503, detail="The server document converter is unavailable. Please contact the administrator.") from error
        if str(error) == "pdf_conversion_failed":
            logger.exception("hr_letter_email_conversion_failed", template_key=payload.template_key)
            raise HTTPException(status_code=500, detail="The server could not convert the letter to PDF. Please try again or contact the administrator.") from error
        raise HTTPException(status_code=502, detail="The letter could not be emailed. Please verify Zoho Mail and try again.") from error
    sent_at = datetime.now(timezone.utc).isoformat()
    session.add(AuditEvent(organization_id=user.organization_id, actor_user_id=user.id, action="hr.letter_sent", target_type="hr_letter", target_id=payload.template_key, metadata_json={"recipient": str(payload.recipient_email), "employee": payload.fields.get("employee_name", ""), "subject": payload.subject.strip(), "unit_number": payload.unit_number}))
    session.add(AIUsageEvent(organization_id=user.organization_id, user_id=user.id, department_id=user.department_id, operation="hr_letter_email", provider="zoho", model="smtp", status="completed"))
    await session.commit()
    return {"status": "sent", "sent_at": sent_at}
