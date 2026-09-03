from __future__ import annotations

import io
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

from docx import Document
from openpyxl import load_workbook


DOCUMENT_TYPES = {"sds", "ifra_certificate", "ifra_amendment", "allergen_report", "reach_declaration"}
INTERNAL_MARKERS = ("ai suggested", "review required", "confidence:", "source url")


def normalise(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def clean_issue_value(value: Any, empty: str = "") -> str:
    text = str(value or "").strip()
    return empty if any(marker in text.lower() for marker in INTERNAL_MARKERS) else text


def parse_regulatory_excel(content: bytes) -> tuple[str, str, list[dict[str, str]]]:
    workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    product = code = ""
    ingredients: list[dict[str, str]] = []
    for sheet in workbook.worksheets:
        rows = list(sheet.iter_rows(values_only=True))
        header_index = -1
        for index, row in enumerate(rows):
            first = normalise(row[0] if row else "")
            if first == "name" and len(row) > 1:
                product = clean_issue_value(row[1])
            elif first == "code" and len(row) > 1:
                code = clean_issue_value(row[1])
            elif first in {"sl no", "serial no", "s no"}:
                header_index = index
        if header_index >= 0:
            for row in rows[header_index + 1:]:
                name = clean_issue_value(row[1] if len(row) > 1 else "")
                concentration = clean_issue_value(row[2] if len(row) > 2 else "")
                if not name or normalise(name) in {"total", "rawmaterials", "raw materials"}:
                    continue
                if not concentration and not any(value is not None for value in row):
                    continue
                ingredients.append({"name": name, "concentration": concentration, "cas": "", "ec": "", "classification": "", "hazard_statements": "", "precautionary_statements": "", "signal_word": "", "pictograms": "", "toxicology": "", "ecology": "", "transport": "", "allergen_identity": "", "svhc_identity": "", "sources": [], "provenance": "excel"})
            break
    workbook.close()
    if not product or not code or not ingredients:
        raise ValueError("The workbook must contain Name, Code, and an SL NO / RAWMATERIALS / % table.")
    return product, code, ingredients


COA_LABELS = {
    "appearance": ("appearance",), "colour": ("colour", "color"), "odour": ("odour", "odor"),
    "relative_density": ("specific gravity", "relative density", "density"), "flash_point": ("flash point",),
    "refractive_index": ("refractive index",), "solubility": ("solubility",), "storage_condition": ("storage condition", "storage"),
}


def extract_coa_properties(text: str) -> dict[str, str]:
    lines = [" ".join(line.split()) for line in text.splitlines() if line.strip()]
    result: dict[str, str] = {}
    # Word/Excel table extraction uses pipes between cells. Prefer the actual
    # result column, except for qualitative pass/fail rows where the
    # specification is the useful SDS description.
    for line in lines:
        cells = [cell.strip() for cell in line.split("|")]
        if len(cells) < 2:
            continue
        label = normalise(cells[0])
        for key, aliases in COA_LABELS.items():
            if label not in {normalise(alias) for alias in aliases}:
                continue
            values = [cell for cell in cells[1:] if cell]
            if values:
                final = values[-1]
                result[key] = values[0] if normalise(final) in {"pass", "passes", "complies", "conforms"} else final
            break
    all_labels = [alias for aliases in COA_LABELS.values() for alias in aliases]
    boundary = "|".join(re.escape(item) for item in sorted(all_labels, key=len, reverse=True))
    for key, aliases in COA_LABELS.items():
        if key in result:
            continue
        for alias in aliases:
            match = re.search(rf"(?i)\b{re.escape(alias)}\b\s*[:|\-]?\s*(.+?)(?=\s+\b(?:{boundary})\b\s*[:|\-]|$)", " ".join(lines))
            if match:
                value = match.group(1).strip(" |,;:-")[:300]
                if value:
                    result[key] = value
                    break
    return result


def _set_paragraph_value(paragraph, label_patterns: tuple[str, ...], value: str) -> bool:
    text = paragraph.text
    for pattern in label_patterns:
        match = re.search(rf"(?i)({pattern}\s*:?)(.*)$", text)
        if not match:
            continue
        prefix = text[:match.start(2)]
        replacement = prefix + clean_issue_value(value)
        if paragraph.runs:
            paragraph.runs[0].text = replacement
            for run in paragraph.runs[1:]:
                run.text = ""
        else:
            paragraph.text = replacement
        return True
    return False


def _all_paragraphs(document):
    for paragraph in document.paragraphs:
        yield paragraph
    for section in document.sections:
        yield from section.header.paragraphs
        yield from section.footer.paragraphs
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                yield from cell.paragraphs


def _replace_product(document, product: str, code: str) -> None:
    for paragraph in _all_paragraphs(document):
        _set_paragraph_value(paragraph, (r"PRODUCT\s+NAME",), product)
        _set_paragraph_value(paragraph, (r"PRODUCT\s+CODE",), code)
        _set_paragraph_value(paragraph, (r"1\.1\s+Product\s+identifier", r"Product\s+identifier"), f"{product} {code}".strip())


def _ingredient_indexes(ingredients: list[dict[str, Any]]) -> tuple[dict[str, dict], dict[str, dict]]:
    names: dict[str, dict] = {}
    cases: dict[str, dict] = {}
    for item in ingredients:
        for candidate in (item.get("name"), item.get("canonical_name"), item.get("allergen_identity"), item.get("svhc_identity")):
            if normalise(candidate):
                names[normalise(candidate)] = item
        for alias in item.get("aliases") or []:
            if normalise(alias):
                names[normalise(alias)] = item
        for cas in re.split(r"[/,;\s]+", str(item.get("cas") or "")):
            if re.fullmatch(r"\d{2,7}-\d{2}-\d", cas):
                cases[cas] = item
    return names, cases


def _matching_ingredient(name: str, cas_text: str, names: dict[str, dict], cases: dict[str, dict]) -> dict | None:
    normalized_name = normalise(name)
    exact = names.get(normalized_name)
    if exact:
        return exact
    for candidate, item in sorted(names.items(), key=lambda pair: len(pair[0]), reverse=True):
        if len(candidate) >= 4 and re.search(rf"(?:^|\s){re.escape(candidate)}(?:\s|$)", normalized_name):
            return item
    for cas in re.findall(r"\d{2,7}-\d{2}-\d", cas_text):
        if cas in cases:
            return cases[cas]
    return None


def _fill_catalog_tables(document, ingredients: list[dict], absent: str) -> None:
    names, cases = _ingredient_indexes(ingredients)
    for table in document.tables:
        for row in table.rows:
            if len(row.cells) < 2:
                continue
            name = row.cells[0].text.strip()
            if normalise(name) in {"ingredient", "name of ingredient", "substance name"}:
                continue
            cas_text = " ".join(cell.text for cell in row.cells[1:-1])
            item = _matching_ingredient(name, cas_text, names, cases)
            target = row.cells[-1]
            target.text = clean_issue_value(item.get("concentration"), absent) if item else absent


def _fill_sds(document, fields: dict[str, str], ingredients: list[dict]) -> None:
    labels = {
        "appearance": (r"Appearance",), "colour": (r"Colou?r",), "odour": (r"Odou?r(?:/Odor threshold)?",),
        "flash_point": (r"Flash point",), "solubility": (r"Solubility",),
        "relative_density": (r"Density and/or relative density", r"Relative density"),
        "signal_word": (r"Signal word",), "hazard_statements": (r"Hazard statements",),
        "precautionary_statements": (r"Precautionary statements",),
        "other_hazards": (r"Other hazards", r"Supplemental Information"),
    }
    for paragraph in _all_paragraphs(document):
        for key, patterns in labels.items():
            _set_paragraph_value(paragraph, patterns, clean_issue_value(fields.get(key)))
    composition = next((table for table in document.tables if table.rows and "cas" in normalise(" ".join(c.text for c in table.rows[0].cells)) and "%" in " ".join(c.text for c in table.rows[0].cells)), None)
    if composition is None:
        return
    template_row = deepcopy(composition.rows[1]._tr if len(composition.rows) > 1 else composition.rows[0]._tr)
    while len(composition.rows) > 1:
        composition._tbl.remove(composition.rows[-1]._tr)
    for item in ingredients:
        row_element = deepcopy(template_row); composition._tbl.append(row_element); cells = composition.rows[-1].cells
        values = [item.get("name"), item.get("cas"), item.get("ec"), item.get("concentration"), item.get("classification"), item.get("specific_concentration_limits")]
        for index, value in enumerate(values):
            if index < len(cells):
                cells[index].text = clean_issue_value(value)
    # Remove stale continuation rows inherited from the previous product in
    # the master. The populated first composition table will paginate in Word.
    seen_composition = False
    for table in document.tables:
        if table is composition:
            seen_composition = True
            continue
        if not seen_composition or not table.rows or len(table.rows[0].cells) != 6:
            continue
        first_text = normalise(" ".join(cell.text for cell in table.rows[0].cells))
        if any(marker in first_text for marker in ("carcinogenic", "ld50", "un proper shipping", "abbreviation")):
            continue
        for row in table.rows[1:]:
            for cell in row.cells:
                cell.text = ""
        break

    # Product-specific toxicology: replace all sample-product rows. A single
    # reviewed free-text value is kept in the first result column.
    toxicity = next((table for table in document.tables if table.rows and "ld50 ate oral" in normalise(" ".join(c.text for c in table.rows[0].cells))), None)
    if toxicity is not None:
        template_row = deepcopy(toxicity.rows[1]._tr if len(toxicity.rows) > 1 else toxicity.rows[0]._tr)
        while len(toxicity.rows) > 1:
            toxicity._tbl.remove(toxicity.rows[-1]._tr)
        for item in ingredients:
            value = clean_issue_value(item.get("toxicology"))
            if not value:
                continue
            toxicity._tbl.append(deepcopy(template_row)); cells = toxicity.rows[-1].cells
            values = [item.get("name"), item.get("cas"), item.get("ec"), value, "", "", ""]
            for index, cell_value in enumerate(values):
                if index < len(cells):
                    cells[index].text = clean_issue_value(cell_value)

    # Transport classification is a mixture-level decision. Never retain the
    # example product's UN number, proper shipping name, class or packing group.
    transport = next((table for table in document.tables if table.rows and "un proper shipping name" in normalise(" ".join(c.text for c in table.rows[0].cells))), None)
    if transport is not None:
        for row in transport.rows[1:]:
            for cell in row.cells[1:]:
                cell.text = ""

    # Clear any sample row in the generic ingredient/value table.
    generic = next((table for table in document.tables if table.rows and normalise(" ".join(c.text for c in table.rows[0].cells)) == "ingredient cas ec description value"), None)
    if generic is not None:
        for row in generic.rows[1:]:
            for cell in row.cells:
                cell.text = ""


def generate_regulatory_docx(template: Path, output: Path, document_type: str, product: str, code: str, fields: dict[str, str], ingredients: list[dict]) -> None:
    if document_type not in DOCUMENT_TYPES:
        raise ValueError("Unsupported regulatory document type.")
    document = Document(template)
    _replace_product(document, clean_issue_value(product), clean_issue_value(code))
    if document_type == "sds":
        _fill_sds(document, fields, ingredients)
    elif document_type == "ifra_amendment":
        _fill_catalog_tables(document, ingredients, "NIL")
    elif document_type == "allergen_report":
        _fill_catalog_tables(document, ingredients, "-")
    elif document_type == "reach_declaration":
        _fill_catalog_tables(document, ingredients, "NIL")
    output.parent.mkdir(parents=True, exist_ok=True)
    document.save(output)
