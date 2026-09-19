import re
from io import BytesIO
from pathlib import Path

from docx import Document
from openpyxl import Workbook

from app.modules.regulatory.engine import (
    clean_issue_value,
    extract_coa_identity,
    extract_coa_properties,
    generate_regulatory_docx,
    parse_regulatory_excel,
)
from app.modules.regulatory.reference_catalog import apply_raw_material_reference, is_cedar_sage_reference_formula, un3082_technical_names


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
    seen_footer_parts: set[str] = set()
    for section in document.sections:
        for footer in (section.footer, section.first_page_footer, section.even_page_footer):
            part_key = str(footer.part.partname)
            if part_key in seen_footer_parts:
                continue
            seen_footer_parts.add(part_key)
            parts.extend(node.text or "" for node in footer._element.xpath(".//w:t"))
    return "\n".join(parts)


def test_formula_and_coa_extraction() -> None:
    product, code, ingredients = parse_regulatory_excel(_workbook())
    assert (product, code) == ("CEDAR AND SAGE", "FS 12388")
    assert ingredients[0]["name"] == "ISO E SUPER"
    assert ingredients[1]["concentration"] == "4.5"
    assert extract_coa_properties("Appearance: Clear liquid\nOdour: Woody\nFlash Point: 82 °C") == {
        "appearance": "Clear liquid", "odour": "Woody", "flash_point": "82 °C"
    }
    assert extract_coa_properties("Flash Point | For record | 990C")["flash_point"] == "99°C"
    assert clean_issue_value("AI suggested - verify") == ""
    assert clean_issue_value("N/A") == ""
    assert clean_issue_value("Leave blank if unavailable") == ""


def test_coa_property_extraction_stops_before_approval_fields() -> None:
    text = "Storage Condition: Store in a cool place\nTested By: Sneha\nChecked By: Rakshanda"
    assert extract_coa_properties(text)["storage_condition"] == "Store in a cool place"


def test_explicit_coa_colour_is_not_left_undetermined() -> None:
    values = extract_coa_properties(
        "Appearance | Pale yellowish Liquid | Passes\n"
        "Odour | Woody, Balsamic, Musk Powdery | Passes\n"
        "Flash Point | For record | 990C"
    )
    assert values["colour"] == "Pale yellowish Liquid"
    assert values["odour"] == "Woody, Balsamic, Musk Powdery"
    assert values["flash_point"] == "99°C"
    assert "colour" not in extract_coa_properties("Appearance | Liquid | Passes")


def test_employee_clp_reference_corrects_ai_without_changing_formula_values() -> None:
    item = {
        "name": "ISO E SUPER", "concentration": "10", "cas": "59056-94-9",
        "classification": "Eye Irrit. 2: H319", "toxicology": "AI estimate",
        "provenance": "official_database",
    }
    assert apply_raw_material_reference(item)
    assert item["concentration"] == "10"
    assert item["cas"] == "54464-57-2"
    assert item["ec"] == "259-174-3"
    assert "Skin Sens. 1B: H317" in item["classification"]
    assert item["toxicology"] == "AI estimate"
    assert item["classification_source"].endswith("CLP.docx")
    approved = {**item, "classification": "Employee correction", "provenance": "employee_approved"}
    assert not apply_raw_material_reference(approved)
    assert approved["classification"] == "Employee correction"


def test_transport_reference_selects_only_actual_formula_materials() -> None:
    ingredients = [
        {"name": "ISO E SUPER", "concentration": "10"},
        {"name": "MUSK T", "concentration": "5"},
        {"name": "BETA IONONE", "concentration": "5"},
        {"name": "HEDIONE", "concentration": "20"},
    ]
    assert un3082_technical_names(ingredients) == ["BETA IONONE", "ISO E SUPER", "MUSK T"]
    assert not is_cedar_sage_reference_formula("CEDAR & SAGE", "FS 12388", ingredients)


def test_section_14_does_not_infer_un3082_from_ingredient_list_alone(tmp_path: Path) -> None:
    ingredients = [{"name": "ISO E SUPER", "concentration": "1", "provenance": "excel"}]
    untreated = tmp_path / "untreated.docx"
    generate_regulatory_docx(TEMPLATES / "sds.docx", untreated, "sds", "OTHER BLEND", "X1", {}, ingredients)
    transport = next(table for table in Document(untreated).tables if table.rows and "UN Proper Shipping Name" in " ".join(cell.text for cell in table.rows[0].cells))
    assert all(row.cells[1].text == "Not determined" for row in transport.rows[1:])

    reviewed = tmp_path / "reviewed.docx"
    generate_regulatory_docx(TEMPLATES / "sds.docx", reviewed, "sds", "OTHER BLEND", "X1", {"transport_un_number": "UN 3082"}, ingredients)
    transport = next(table for table in Document(reviewed).tables if table.rows and "UN Proper Shipping Name" in " ".join(cell.text for cell in table.rows[0].cells))
    assert all(row.cells[1].text == "UN3082" for row in transport.rows[1:])


def test_coa_identity_extraction() -> None:
    text = "Date: 27-08-2026\nName of the Product : PEARL\nProduct Code : FPM 10691\nBatch Number: X1"
    assert extract_coa_identity(text) == {"product_name": "PEARL", "product_code": "FPM 10691"}


def test_sds_tables_have_explicit_missing_values_and_consistent_alignment(tmp_path: Path) -> None:
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn

    output = tmp_path / "aligned.docx"
    ingredients = [
        {"name": "HEDIONE", "concentration": "20"},
        {"name": "IBA", "concentration": "10"},
        {"name": "Employee material", "concentration": "0.125", "cas": "123-45-6",
         "ec": "123-456-7", "classification": "Employee classification",
         "toxicology": "Oral: LD50 1234 mg/kg", "provenance": "employee_approved"},
    ]
    generate_regulatory_docx(TEMPLATES / "sds.docx", output, "sds", "ALIGNMENT CHECK", "A1", {}, ingredients)
    document = Document(output)
    for table_index, table in enumerate(document.tables[:5]):
        for row in table.rows:
            assert row._tr.get_or_add_trPr().find(qn("w:cantSplit")) is not None
            # Placeholder rows follow the approved reference convention: the
            # first cell reads NONE and the companion cells stay empty. Filling
            # them with "Not applicable" squeezes narrow columns into mid-word
            # breaks in the converted PDF.
            if row.cells[0].text.strip() == "NONE":
                assert all(not cell.text.strip() for cell in row.cells[1:])
            else:
                assert all(cell.text.strip() for cell in row.cells)
            assert all(cell._tc.get_or_add_tcPr().find(qn("w:tcMar")) is not None for cell in row.cells)
        repeated = table.rows[0]._tr.get_or_add_trPr().find(qn("w:tblHeader")) is not None
        assert repeated == (table_index not in {0, 3})
    composition = document.tables[0]
    assert composition.rows[1].cells[5].text == "Not available"
    assert composition.rows[1].cells[1].paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.CENTER
    assert composition.rows[1].cells[0].paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.LEFT
    assert "LD50 1234 mg/kg" in composition.rows[3].cells[5].text
    toxicity = document.tables[3]
    assert all(row.cells[5].text == "Not available" and row.cells[6].text == "Not available" for row in toxicity.rows[1:])
    paragraphs = [paragraph.text for paragraph in document.paragraphs]
    assert "11.1 Information on hazard classes as defined in Regulation (EC) No1272/2008" in paragraphs
    assert any(p.startswith("14.7 Maritime transport in bulk according to IMO instruments:") for p in paragraphs)
    assert any(p.startswith("15.1 Safety, health and environmental regulations/legislation specific") for p in paragraphs)
    acute = next(p for p in document.paragraphs if p.text.startswith("Acute Toxicity Dermal:"))
    assert acute.paragraph_format.left_indent.pt == 170


def test_all_regulatory_documents_are_generated_without_internal_labels(tmp_path: Path) -> None:
    ingredients = [
        {"name": "ISO E SUPER", "cas": "54464-57-2", "ec": "259-174-3", "concentration": "30", "classification": "Skin Irrit. 2: H315; Eye Irrit. 2: H319; Aquatic Chronic 2: H411", "toxicology": "Oral: LD50 5000 mg/kg"},
        {"name": "LINALOOL", "cas": "78-70-6", "ec": "201-134-4", "concentration": "12", "classification": "Skin Sens. 1B: H317", "allergen_identity": "Linalool", "toxicology": "Oral: LD50 2200 mg/kg bw; Dermal: LD50 5610 mg/kg bw"},
        {"name": "BETA IONONE", "cas": "14901-07-6", "ec": "238-969-9", "concentration": "30", "classification": "Aquatic Chronic 2: H411"},
    ]
    fields = {
        "appearance": "Clear liquid", "odour": "Woody", "flash_point": "82 °C",
        "classification": "Skin Irrit. 2: H315", "supplemental_information": "EUH208",
        "other_hazards": "", "version": "0.0", "revision_date": "28-08-2026",
    }
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
        assert "13-07-2026" not in text

    assert "PRODUCT NAME: CEDAR AND SAGE FS 12388" in _text(tmp_path / "ifra-certificate.docx")
    assert "PRODUCTNAME:CEDARANDSAGEFS12388" in _text(tmp_path / "allergen-report.docx").replace(" ", "")
    assert "28-08-2026" in _text(tmp_path / "ifra-certificate.docx")
    assert "28-08-2026" in _text(tmp_path / "ifra-amendment.docx")

    sds_text = _text(tmp_path / "sds.docx")
    assert "PTBCHA" not in sds_text
    assert "GALAXOLIDE" not in sds_text
    assert "ISO E SUPER" in sds_text
    assert "CHANDAN" not in sds_text
    assert "H412, Harmful to aquatic life with long lasting effects" not in sds_text
    # The preserving layout keeps the master's tab separators between label
    # and value, so compare with whitespace/tabs normalized away.
    assert "Product identifier: CEDAR AND SAGE FS 12388" in re.sub(r"[\s\t]+", " ", sds_text)
    assert "1.1 Product Identifier CEDAR" not in sds_text
    assert "Skin Irrit. 2: H315" in sds_text
    assert "Skin Corrosion / Irritation Category 2" in sds_text
    assert "Sensitization-Skin Category 1" in sds_text
    assert "H319, Causes serious eye irritation." in sds_text
    assert "H411, Toxic to aquatic life with long lasting effects." in sds_text
    assert "Signal word:\t\t\tWarning" in sds_text
    assert "EUH208" in sds_text
    assert "EUH208, Contains ISO E SUPER, LINALOOL. May produce an allergic reaction." in sds_text
    lowered_sds = sds_text.lower()
    assert "undetermined" in lowered_sds
    assert lowered_sds.count("undetermined") < 20
    assert "13-07-2026" not in sds_text
    assert lowered_sds.count("particle characteristics:") == 1
    for section in range(1, 17):
        assert f"section {section}." in lowered_sds or f"section {section}:" in lowered_sds

    sds = Document(tmp_path / "sds.docx")
    composition_tables = [
        table for table in sds.tables
        if table.rows and "cas" in " ".join(cell.text.lower() for cell in table.rows[0].cells)
        and "%" in " ".join(cell.text for cell in table.rows[0].cells)
        and len(table.rows[0].cells) == 6
    ]
    assert len(composition_tables[0].rows) == 4
    assert len(composition_tables[1].rows) == 2
    assert composition_tables[1].rows[1].cells[0].text == "NONE"
    assert "LD50 2 200 mg/kg bw" in composition_tables[0].rows[2].cells[5].text
    # Table data keeps the master's Calibri typography instead of a forced size.
    first_value_run = composition_tables[0].rows[1].cells[0].paragraphs[0].runs[0]
    assert first_value_run.font.name == "Calibri"
    assert first_value_run.font.size is None

    section_9 = sds_text.lower().split("section 9.", 1)[1].split("section 10.", 1)[0]
    assert section_9.count("undetermined") >= 12
    outside_section_9 = sds_text.lower().split("section 9.", 1)[0] + sds_text.lower().split("section 10.", 1)[1]
    assert "undetermined" not in outside_section_9
    assert "12.2 Persistence and degradability:\t\tNot available" in sds_text
    toxicity = next(table for table in sds.tables if table.rows and "ld50/ate oral" in " ".join(cell.text.lower() for cell in table.rows[0].cells))
    assert len(toxicity.rows) > 1
    transport = next(table for table in sds.tables if table.rows and "un proper shipping name" in " ".join(cell.text.lower() for cell in table.rows[0].cells))
    assert all(row.cells[1].text == "UN3082" for row in transport.rows[1:])
    assert all(row.cells[3].text == "9" for row in transport.rows[1:])
    assert all(row.cells[5].text == "III" for row in transport.rows[1:])
    assert "ISO E SUPER" in transport.rows[1].cells[2].text
    assert len(sds._element.xpath(".//w:drawing")) >= 1
