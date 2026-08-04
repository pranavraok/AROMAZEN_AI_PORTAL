from pathlib import Path

from docx import Document as WordDocument
from openpyxl import load_workbook
from pypdf import PdfReader
from pptx import Presentation


class ExtractionError(Exception):
    """Raised when a supported document cannot be read locally."""


def _clean(parts: list[str]) -> str:
    return "\n".join(part.strip() for part in parts if part and part.strip())


def extract_text(file_path: Path, extension: str) -> str:
    """Extract readable text locally. No external AI service is used."""
    try:
        if extension == ".pdf":
            return _clean([page.extract_text() or "" for page in PdfReader(str(file_path)).pages])
        if extension == ".docx":
            document = WordDocument(str(file_path))
            return _clean([paragraph.text for paragraph in document.paragraphs] + [" | ".join(cell.text for cell in row.cells) for table in document.tables for row in table.rows])
        if extension == ".xlsx":
            workbook = load_workbook(str(file_path), read_only=True, data_only=True)
            parts: list[str] = []
            for sheet in workbook.worksheets:
                parts.append(f"Worksheet: {sheet.title}")
                for row in sheet.iter_rows(values_only=True):
                    values = [str(value) for value in row if value is not None and str(value).strip()]
                    if values:
                        parts.append(" | ".join(values))
            return _clean(parts)
        if extension == ".pptx":
            presentation = Presentation(str(file_path))
            parts = []
            for number, slide in enumerate(presentation.slides, start=1):
                parts.append(f"Slide {number}")
                parts.extend(shape.text for shape in slide.shapes if hasattr(shape, "text"))
            return _clean(parts)
    except Exception as exc:
        raise ExtractionError("This file could not be read. Please confirm it is a valid, unprotected document.") from exc
    raise ExtractionError("This file type is not supported.")
