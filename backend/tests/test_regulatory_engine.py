from io import BytesIO
from pathlib import Path

from docx import Document
from openpyxl import Workbook

from app.modules.regulatory.engine import (
    clean_issue_value,
    extract_coa_properties,
    generate_regulatory_docx,
    parse_regulatory_excel,
)


TEMPLATES = Path(__file__).resolve().parents[1] / "app" / "templates" / "regulatory"


def _workbook() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Name", "CEDAR AND SAGE"])
    sheet.append(["Code", "FS 12388"])
    sheet.append(["SL NO", "RAWMATERIALS", "%"])
    sheet.append([1, "ISO E SUPER", 10])
    sheet.append([2, "LINALOOL", 4.5])
    stream = BytesIO()
    workbook.save(stream)
    return stream.getvalue()


def _text(path: Path) -> str:
    document = Document(path)
    parts = [paragraph.text for paragraph in document.paragraphs]
    parts.extend(cell.text for table in document.tables for row in table.rows for cell in row.cells)
    return "\n".join(parts)


def test_formula_and_coa_extraction() -> None:
    product, code, ingredients = parse_regulatory_excel(_workbook())
    assert (product, code) == ("CEDAR AND SAGE", "FS 12388")
    assert ingredients[0]["name"] == "ISO E SUPER"
    assert ingredients[1]["concentration"] == "4.5"
    assert extract_coa_properties("Appearance: Clear liquid\nOdour: Woody\nFlash Point: 82 °C") == {
        "appearance": "Clear liquid", "odour": "Woody", "flash_point": "82 °C"
    }
    assert clean_issue_value("AI suggested - verify") == ""


def test_all_regulatory_documents_are_generated_without_internal_labels(tmp_path: Path) -> None:
    ingredients = [
        {"name": "ISO E SUPER", "cas": "54464-57-2", "ec": "259-174-3", "concentration": "10", "classification": "Skin Irrit. 2: H315", "toxicology": "LD50 oral 5000 mg/kg"},
        {"name": "LINALOOL", "cas": "78-70-6", "ec": "201-134-4", "concentration": "4.5", "classification": "Skin Sens. 1B: H317", "allergen_identity": "Linalool"},
    ]
    fields = {"appearance": "Clear liquid", "odour": "Woody", "flash_point": "82 °C", "other_hazards": ""}
    files = {
        "sds": "sds.docx", "ifra_certificate": "ifra-certificate.docx",
        "ifra_amendment": "ifra-amendment.docx", "allergen_report": "allergen-report.docx",
        "reach_declaration": "reach-declaration.docx",
    }
    for document_type, filename in files.items():
        output = tmp_path / filename
        generate_regulatory_docx(TEMPLATES / filename, output, document_type, "CEDAR AND SAGE", "FS 12388", fields, ingredients)
        text = _text(output).lower()
        assert "ai generated" not in text
        assert "ai suggested" not in text
        assert "review required" not in text
        assert "source url" not in text
        assert "chandan" not in text

    sds_text = _text(tmp_path / "sds.docx")
    assert "PTBCHA" not in sds_text
    assert "GALAXOLIDE" not in sds_text
    assert "ISO E SUPER" in sds_text
