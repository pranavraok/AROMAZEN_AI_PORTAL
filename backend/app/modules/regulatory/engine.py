from __future__ import annotations

import io
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt
from docx.text.paragraph import Paragraph
from openpyxl import load_workbook

from app.modules.regulatory.reference_catalog import (
    CEDAR_SAGE_SDS_LABEL,
    CEDAR_SAGE_SECTION_11_INGREDIENTS,
    apply_raw_material_reference,
    is_cedar_sage_reference_formula,
    un3082_technical_names,
)


DOCUMENT_TYPES = {"sds", "ifra_certificate", "ifra_amendment", "allergen_report", "reach_declaration"}
INTERNAL_MARKERS = ("ai suggested", "review required", "confidence:", "source url")
SDS_UNDETERMINED = "Undetermined"

MIXTURE_HAZARD_RULES = {
    "H315": {
        "threshold": 10.0,
        "classification": "Skin Corrosion / Irritation Category 2",
        "statement": "H315, Causes skin irritation.",
        "pictogram": "Irritant",
    },
    "H317": {
        "threshold": 1.0,
        "classification": "Sensitization-Skin Category 1",
        "statement": "H317, May cause an allergic skin reaction.",
        "pictogram": "Irritant",
    },
    "H319": {
        "threshold": 10.0,
        "classification": "Eye Damage / Irritation Category 2",
        "statement": "H319, Causes serious eye irritation.",
        "pictogram": "Irritant",
    },
    "H411": {
        "threshold": 25.0,
        "classification": "Hazardous to the Aquatic Environment-Long-term Hazard Category 2",
        "statement": "H411, Toxic to aquatic life with long lasting effects.",
        "pictogram": "Environmental Hazard",
    },
}

PRECAUTIONARY_STATEMENTS = (
    ("P261", "P261, Avoid breathing vapour or dust.", {"H317"}),
    ("P264", "P264, Wash hands and other contacted skin thoroughly after handling.", {"H315", "H319"}),
    ("P272", "P272, Contaminated work clothing should not be allowed out of the workplace.", {"H317"}),
    ("P273", "P273, Avoid release to the environment.", {"H411"}),
    ("P280", "P280, Wear protective gloves /eye protection /face protection.", {"H315", "H317", "H319"}),
    ("P302/352", "P302/352, IF ON SKIN: Wash with plenty of soap and water.", {"H315", "H317"}),
    ("P305/351/338", "P305/351/338, IF IN EYES: Rinse cautiously with water for several minutes. Remove contact lenses, if present and easy to do. Continue rinsing.", {"H319"}),
    ("P333/313", "P333/313, If skin irritation or rash occurs: Get medical advice/attention.", {"H317"}),
    ("P337/313", "P337/313, If eye irritation persists: Get medical advice /attention.", {"H319"}),
    ("P362", "P362, Take off contaminated clothing and wash before reuse.", {"H315", "H317"}),
    ("P391", "P391, Collect spillage.", {"H411"}),
    ("P501", "P501, Dispose of contents/container to approved disposal site, in accordance with local regulations.", {"H317", "H411"}),
)
OUTPUT_PLACEHOLDERS = {
    "n a",
    "na",
    "not available",
    "no available",
    "no data available",
    "none available",
    "not determined",
    "not applicable",
    "unavailable",
    "unknown",
    "leave blank if unavailable",
}


def normalise(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def clean_issue_value(value: Any, empty: str = "") -> str:
    text = str(value or "").strip()
    placeholder = normalise(text) in OUTPUT_PLACEHOLDERS
    return empty if placeholder or any(marker in text.lower() for marker in INTERNAL_MARKERS) else text


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
                ingredients.append({"name": name, "concentration": concentration, "cas": "", "ec": "", "classification": "", "hazard_statements": "", "precautionary_statements": "", "signal_word": "", "pictograms": "", "toxicology": "", "ecology": "", "transport": "", "allergen_identity": "", "svhc_identity": "", "ifra_limits": "", "sources": [], "provenance": "excel"})
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
                if key == "flash_point":
                    result[key] = re.sub(r"(?i)^(\d{1,3})0\s*C$", r"\1°C", result[key])
            break
    all_labels = [alias for aliases in COA_LABELS.values() for alias in aliases]
    all_labels.extend(("tested by", "checked by", "approved by", "parameter", "specification", "result"))
    boundary = "|".join(re.escape(item) for item in sorted(all_labels, key=len, reverse=True))
    for key, aliases in COA_LABELS.items():
        if key in result:
            continue
        for alias in aliases:
            match = re.search(rf"(?i)\b{re.escape(alias)}\b\s*[:|\-]?\s*(.+?)(?=\s+\b(?:{boundary})\b\s*[:|\-]|$)", " ".join(lines))
            if match:
                value = match.group(1).strip(" |,;:-")[:300]
                if value:
                    result[key] = re.sub(r"(?i)^(\d{1,3})0\s*C$", r"\1°C", value) if key == "flash_point" else value
                    break
    # Many Creation COAs record a colour description in Appearance rather
    # than in a separate Colour row. Copy only an explicit colour phrase;
    # neither a missing colour nor a generic state such as "Liquid" is guessed.
    appearance = result.get("appearance", "")
    if "colour" not in result and re.search(
        r"\b(?:yellow(?:ish)?|amber|orange|red(?:dish)?|pink(?:ish)?|green(?:ish)?|blue(?:ish)?|brown(?:ish)?|purple|violet|white|black)\b",
        appearance, re.IGNORECASE,
    ):
        result["colour"] = appearance
    return result


def extract_coa_identity(text: str) -> dict[str, str]:
    """Extract only explicit product identifiers from a Creation COA."""
    compact = "\n".join(" ".join(line.split()) for line in text.splitlines() if line.strip())
    result: dict[str, str] = {}
    patterns = {
        "product_name": r"(?im)^\s*(?:name\s+of\s+the\s+product|product\s+name)\s*[:|\-]\s*([^\n|]+)",
        "product_code": r"(?im)^\s*product\s+code\s*[:|\-]\s*([^\n|]+)",
    }
    for key, pattern in patterns.items():
        match = re.search(pattern, compact)
        if match:
            result[key] = clean_issue_value(match.group(1)).strip(" |,;:-")[:300]
    return result


def _set_paragraph_value(paragraph, label_patterns: tuple[str, ...], value: str) -> bool:
    text = paragraph.text
    for pattern in label_patterns:
        if pattern.startswith("^") and not pattern.startswith(r"^\s"):
            pattern = rf"^\s*{pattern[1:]}"
        match = re.search(rf"(?i)({pattern}\s*:?)(.*)$", text)
        if not match:
            continue
        prefix = text[:match.start(2)]
        cleaned = clean_issue_value(value)
        replacement = prefix.rstrip()
        if cleaned:
            replacement += f" {cleaned}"
        if paragraph.runs:
            paragraph.runs[0].text = replacement
            for run in paragraph.runs[1:]:
                run.text = ""
        else:
            paragraph.text = replacement
        return True
    return False


def _set_paragraph_value_preserving_layout(
    paragraph, label_patterns: tuple[str, ...], value: str, *, preserve_placeholder: bool = False
) -> bool:
    text = paragraph.text
    for pattern in label_patterns:
        if pattern.startswith("^") and not pattern.startswith(r"^\s"):
            pattern = rf"^\s*{pattern[1:]}"
        match = re.search(rf"(?i)({pattern}\s*:?)(.*)$", text)
        if not match:
            continue
        cleaned = str(value or "").strip() if preserve_placeholder else clean_issue_value(value)
        value_start = match.start(2)
        cursor = 0
        value_run = None
        for run in paragraph.runs:
            run_start, run_end = cursor, cursor + len(run.text)
            cursor = run_end
            if run_end <= value_start:
                continue
            if run_start < value_start:
                prefix_length = value_start - run_start
                suffix = run.text[prefix_length:]
                run.text = run.text[:prefix_length] + (suffix if suffix.isspace() else "")
                if suffix.strip():
                    value_run = paragraph.add_run()
                continue
            if value_run is None and run.text.strip():
                value_run = run
            elif value_run is not None:
                run.text = ""
        if value_run is None:
            value_run = paragraph.add_run()
        needs_separator = bool(cleaned and text[:value_start] and not text[:value_start][-1].isspace() and not text[value_start:].startswith((" ", "\t")))
        value_run.text = f" {cleaned}" if needs_separator else cleaned
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
        _set_paragraph_value(paragraph, (r"^\s*PRODUCT\s+NAME",), product)
        _set_paragraph_value(paragraph, (r"^\s*PRODUCT\s+CODE",), code)
        _set_paragraph_value(paragraph, (r"^\s*Product\s+identifier\s*:",), f"{product} {code}".strip())


def _clear_paragraph(paragraph, remove_drawings: bool = False) -> None:
    for run in paragraph.runs:
        run.text = ""
    if remove_drawings:
        _remove_paragraph_drawings(paragraph)


def _remove_paragraph_drawings(paragraph) -> None:
    for tag in (".//w:drawing", ".//w:pict"):
        for node in paragraph._p.xpath(tag):
            node.getparent().remove(node)


def _set_paragraph_text_preserving_layout(paragraph, value: str) -> None:
    if paragraph.runs:
        paragraph.runs[0].text = value
        for run in paragraph.runs[1:]:
            run.text = ""
    else:
        paragraph.text = value


def _remove_output_placeholders(document) -> None:
    """Keep unknown SDS values blank without exposing internal placeholders."""
    suffix = re.compile(
        r"(?i)^(.*?[:：])\s*(?:n\s*/?\s*a|not available|no available|no data available|none available|"
        r"not determined|not applicable|unavailable|unknown)\.?\s*$"
    )
    for paragraph in _all_paragraphs(document):
        text = paragraph.text.strip()
        if not text:
            continue
        if normalise(text) in OUTPUT_PLACEHOLDERS:
            _clear_paragraph(paragraph)
            continue
        match = suffix.match(text)
        if match:
            _set_paragraph_text_preserving_layout(paragraph, match.group(1).rstrip())


def _set_footer_metadata(document, fields: dict[str, str]) -> None:
    version = clean_issue_value(fields.get("version"))
    revision_date = clean_issue_value(fields.get("revision_date"))
    pattern = re.compile(r"(?is)^(.*?Version\s*:)\s*.*?(\s+Date\s*:)\s*.*?$")
    seen_parts: set[str] = set()
    for section in document.sections:
        for footer in (section.footer, section.first_page_footer, section.even_page_footer):
            part_key = str(footer.part.partname)
            if part_key in seen_parts:
                continue
            seen_parts.add(part_key)
            # Some uploaded masters place metadata inside a content control or
            # text box, which footer.paragraphs does not expose.
            for node in footer._element.xpath(".//w:t"):
                match = pattern.match(node.text or "")
                if not match:
                    continue
                replacement = match.group(1)
                if version:
                    replacement += f" {version}"
                replacement += match.group(2)
                if revision_date:
                    replacement += f" {revision_date}"
                node.text = replacement


def _remove_duplicate_particle_characteristics(document) -> None:
    found = False
    for paragraph in document.paragraphs:
        if not normalise(paragraph.text).startswith("particle characteristics"):
            continue
        if found:
            _clear_paragraph(paragraph)
        found = True


def _paragraph_index(paragraphs: list, pattern: str, start: int = 0) -> int | None:
    regex = re.compile(pattern, re.IGNORECASE)
    return next((index for index in range(start, len(paragraphs)) if regex.search(paragraphs[index].text.strip())), None)


def _replace_labeled_block(document, start_pattern: str, end_pattern: str, value: str, *, remove_drawings: bool = False) -> None:
    paragraphs = list(document.paragraphs)
    start = _paragraph_index(paragraphs, start_pattern)
    if start is None:
        return
    end = _paragraph_index(paragraphs, end_pattern, start + 1)
    if end is None:
        return
    cleaned = clean_issue_value(value)
    if cleaned:
        _set_paragraph_value_preserving_layout(paragraphs[start], (start_pattern,), cleaned)
        if remove_drawings:
            _remove_paragraph_drawings(paragraphs[start])
    else:
        _clear_paragraph(paragraphs[start], remove_drawings=remove_drawings)
    for paragraph in paragraphs[start + 1:end]:
        _clear_paragraph(paragraph, remove_drawings=remove_drawings)
        # The SDS master has many sample-text paragraphs between labels.
        # Leaving their empty paragraph marks creates large blank bands and
        # pushes Section 3 to another page. Keep drawing/section anchors.
        if not paragraph.text.strip() and not paragraph._p.xpath(".//w:drawing | .//w:pict | .//w:sectPr"):
            paragraph._p.getparent().remove(paragraph._p)


def _prune_blank_paragraphs_between(document, start_pattern: str, end_pattern: str) -> None:
    paragraphs = list(document.paragraphs)
    start = _paragraph_index(paragraphs, start_pattern)
    end = _paragraph_index(paragraphs, end_pattern, (start or 0) + 1)
    if start is None or end is None:
        return
    for paragraph in paragraphs[start + 1:end]:
        if not paragraph.text.strip() and not paragraph._p.xpath(".//w:drawing | .//w:pict | .//w:sectPr"):
            paragraph._p.getparent().remove(paragraph._p)


def _multiline_regulatory_value(value: Any, code_prefix: str = "") -> str:
    """Keep approved text unchanged while restoring the reference's readable line flow."""
    text = clean_issue_value(value)
    if not text:
        return ""
    text = re.sub(r"\s*;\s*", "\n", text)
    if code_prefix:
        text = re.sub(rf"\s+(?={re.escape(code_prefix)}\d{{3}}(?:/\d{{3}})*(?:\b|,))", "\n", text, flags=re.IGNORECASE)
    return text.strip()


def _numeric_concentration(value: Any) -> float:
    text = clean_issue_value(value).replace(",", ".")
    numbers = re.findall(r"\d+(?:\.\d+)?", text)
    if not numbers:
        return 0.0
    # For a concentration band, use the lower stated value so an ingredient
    # cannot cross a mixture-label threshold solely because of an upper bound.
    return float(numbers[0])


def _derived_mixture_label(fields: dict[str, str], ingredients: list[dict]) -> dict[str, str]:
    """Fill missing Section 2 label elements from approved ingredient rows.

    Explicit employee-entered mixture fields always win. The fallback covers
    the four hazard classes used by the approved Aromazen SDS master and only
    crosses a class threshold using the saved formula concentrations.
    """
    totals = {code: 0.0 for code in MIXTURE_HAZARD_RULES}
    for item in ingredients:
        concentration = _numeric_concentration(item.get("concentration"))
        classification = clean_issue_value(item.get("classification"))
        for code in totals:
            if re.search(rf"\b{code}\b", classification, re.IGNORECASE):
                totals[code] += concentration

    selected = [
        code for code, rule in MIXTURE_HAZARD_RULES.items()
        if totals[code] >= float(rule["threshold"])
    ]
    selected_set = set(selected)
    derived_classification = "\n".join(
        str(MIXTURE_HAZARD_RULES[code]["classification"]) for code in selected
    )
    derived_hazards = "\n".join(
        str(MIXTURE_HAZARD_RULES[code]["statement"]) for code in selected
    )
    derived_precautions = "\n".join(
        statement for _, statement, hazards in PRECAUTIONARY_STATEMENTS
        if hazards & selected_set
    )
    pictograms: list[str] = []
    for code in selected:
        pictogram = str(MIXTURE_HAZARD_RULES[code]["pictogram"])
        if pictogram not in pictograms:
            pictograms.append(pictogram)

    return {
        "codes": ",".join(selected),
        "classification": clean_issue_value(fields.get("classification")) or derived_classification or "Not classified",
        "hazard_statements": clean_issue_value(fields.get("hazard_statements")) or derived_hazards or "No hazard statements required.",
        "precautionary_statements": clean_issue_value(fields.get("precautionary_statements")) or derived_precautions or "No precautionary statements required.",
        "signal_word": clean_issue_value(fields.get("signal_word")) or ("Warning" if selected else "Not applicable"),
        "pictograms": clean_issue_value(fields.get("pictograms")) or ", ".join(pictograms),
    }


def _toxicology_summary(hazard_codes: set[str], fields: dict[str, str]) -> str:
    lines = [
        "This mixture has not been tested as a whole for health effects. The health effects have been calculated using the methods outlined in Regulation (EC) No1272/2008 (CLP).",
        "Acute Toxicity:\tBased on available data the classification criteria are not met",
        f"Acute Toxicity Oral:\t{clean_issue_value(fields.get('acute_toxicity_oral')) or 'Not available'}",
        f"Acute Toxicity Dermal:\t{clean_issue_value(fields.get('acute_toxicity_dermal')) or 'Not available'}",
        "Acute Toxicity Inhalation:\tNot available",
        f"Skin corrosion/irritation:\t{'Skin Corrosion / Irritation Category 2' if 'H315' in hazard_codes else 'Based on available data the classification criteria are not met'}",
        f"Serious eye damage/irritation:\t{'Eye Damage / Irritation Category 2' if 'H319' in hazard_codes else 'Based on available data the classification criteria are not met'}",
        f"Respiratory or skin sensitization:\t{'Sensitization-Skin Category 1' if 'H317' in hazard_codes else 'Based on available data the classification criteria are not met'}",
        "Germ cell mutagenicity:\tBased on available data the classification criteria are not met",
        "Carcinogenicity:\tBased on available data the classification criteria are not met",
        "Reproductive toxicity:\tBased on available data the classification criteria are not met",
        "STOT-single exposure:\tBased on available data the classification criteria are not met",
        "STOT-repeated exposure:\tBased on available data the classification criteria are not met",
        "Aspiration hazard:\tBased on available data the classification criteria are not met",
    ]
    return "\n".join(lines)


def _h317_supplemental_information(ingredients: list[dict], existing: Any = "") -> str:
    names: list[str] = []
    for item in ingredients:
        classification = clean_issue_value(item.get("classification"))
        if not re.search(r"\bH317\b", classification, re.IGNORECASE):
            continue
        name = clean_issue_value(item.get("canonical_name") or item.get("name") or item.get("allergen_identity"))
        if name and normalise(name) not in {normalise(value) for value in names}:
            names.append(name)
    if names:
        return f"EUH208, Contains {', '.join(names)}. May produce an allergic reaction."
    current = clean_issue_value(existing)
    if not current:
        return "EUH208"
    return current if re.search(r"\bEUH208\b", current, re.IGNORECASE) else f"EUH208, {current}"


def _fill_section_9(document, fields: dict[str, str]) -> None:
    section_9_fields = (
        ((r"^Appearance",), "appearance"),
        ((r"^Colou?r",), "colour"),
        ((r"^Odou?r(?:/Odor threshold)?",), "odour"),
        ((r"^Melting point/freezing point",), "melting_point"),
        ((r"^boiling range",), "boiling_point"),
        ((r"^Flammability",), "flammability"),
        ((r"^Lower and upper explosion limit",), "explosion_limits"),
        ((r"^Flash point",), "flash_point"),
        ((r"^Auto-ignition temperature",), "auto_ignition_temperature"),
        ((r"^Decomposition temperature",), "decomposition_temperature"),
        ((r"^pH",), "ph"),
        ((r"^Kinematic viscosity",), "kinematic_viscosity"),
        ((r"^Solubility",), "solubility"),
        ((r"^Water \(log value\)",), "partition_coefficient"),
        ((r"^Vapou?r pressure",), "vapour_pressure"),
        ((r"^Density and/or relative density", r"^Relative density"), "relative_density"),
        ((r"^Relative vapou?r density",), "relative_vapour_density"),
        ((r"^Particle characteristics",), "particle_characteristics"),
        ((r"^9\.2\s+Other information",), "other_physical_information"),
    )
    paragraphs = list(document.paragraphs)
    start = _paragraph_index(paragraphs, r"^Section 9\.")
    end = _paragraph_index(paragraphs, r"^Section 10\.", (start or 0) + 1)
    if start is None or end is None:
        return
    section_fields = dict(fields)
    if not clean_issue_value(section_fields.get("colour")):
        appearance = clean_issue_value(section_fields.get("appearance"))
        if re.search(r"\b(?:yellow(?:ish)?|amber|orange|red(?:dish)?|pink(?:ish)?|green(?:ish)?|blue(?:ish)?|brown(?:ish)?|purple|violet|white|black)\b", appearance, re.IGNORECASE):
            section_fields["colour"] = appearance
    for paragraph in paragraphs[start + 1:end]:
        for patterns, field in section_9_fields:
            if _set_paragraph_value_preserving_layout(paragraph, patterns, clean_issue_value(section_fields.get(field)) or SDS_UNDETERMINED):
                break


def _fill_unknown_section_body(document, heading_pattern: str, next_heading_pattern: str, value: Any = "") -> None:
    _replace_section_body(document, heading_pattern, next_heading_pattern, clean_issue_value(value) or SDS_UNDETERMINED)


def _replace_section_body(
    document, heading_pattern: str, next_heading_pattern: str, value: str = "", *, preserve_placeholder: bool = False
) -> None:
    paragraphs = list(document.paragraphs)
    heading = _paragraph_index(paragraphs, heading_pattern)
    if heading is None:
        return
    end = _paragraph_index(paragraphs, next_heading_pattern, heading + 1)
    if end is None:
        return
    body = paragraphs[heading + 1:end]
    cleaned = str(value or "").strip() if preserve_placeholder else clean_issue_value(value)
    # Locator regexes intentionally match only the beginning of a heading.
    # Preserve its complete wording, removing only an old inline value.
    heading_text = paragraphs[heading].text.strip().split(":", 1)[0].rstrip()
    if ":" in paragraphs[heading].text:
        heading_text += ":"
    if cleaned and not body:
        _set_paragraph_value_preserving_layout(
            paragraphs[heading], ("^" + re.escape(heading_text),), cleaned,
            preserve_placeholder=preserve_placeholder,
        )
        return
    _set_paragraph_text_preserving_layout(paragraphs[heading], heading_text)
    for offset, paragraph in enumerate(body):
        if offset == 0 and cleaned:
            if paragraph.runs:
                paragraph.runs[0].text = cleaned
                for run in paragraph.runs[1:]:
                    run.text = ""
            else:
                paragraph.text = cleaned
            for run in paragraph.runs:
                run.font.name = "Arial"
                run.font.size = Pt(10)
                run.bold = False
        else:
            _clear_paragraph(paragraph, remove_drawings=True)


def _compact_classification(value: Any) -> str:
    text = clean_issue_value(value)
    if not text:
        return ""
    replacements = (
        (r"Specific target organ toxicity\s*-\s*Single exposure", "STOT SE"),
        (r"Specific target organ toxicity\s*-\s*Repeated exposure", "STOT RE"),
        (r"Hazardous to the aquatic environment\s*,?\s*Short term\s*\(Acute\)", "Aquatic Acute"),
        (r"Hazardous to the aquatic environment\s*,?\s*long[- ]term hazard", "Aquatic Chronic"),
        (r"Hazardous to the aquatic environment\s*,?\s*Long term\s*\(Chronic\)", "Aquatic Chronic"),
        (r"Serious eye damage/eye irritation", "Eye Irrit."),
        (r"Skin corrosion/irritation", "Skin Irrit."),
        (r"Sensitization,\s*Skin", "Skin Sens."),
        (r"Flammable liquids", "Flam. Liq."),
        (r"Acute toxicity,\s*oral", "Acute Tox. (oral)"),
        (r"\s*:\s*Category\s*", " "),
    )
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    text = re.sub(r"\s*\((H\d{3})\)", r": \1", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*;\s*", "; ", text)
    return re.sub(r"\s+", " ", text).strip()


def _format_concentration(value: Any) -> str:
    text = clean_issue_value(value)
    if not text or "%" in text:
        return text
    try:
        number = float(text)
    except ValueError:
        return text
    return f"{number:.1f}%"


def _set_row_no_split(row, *, repeat_header: bool = False) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    for height in list(tr_pr.findall(qn("w:trHeight"))):
        tr_pr.remove(height)
    if tr_pr.find(qn("w:cantSplit")) is None:
        tr_pr.append(OxmlElement("w:cantSplit"))
    if repeat_header and tr_pr.find(qn("w:tblHeader")) is None:
        tr_pr.append(OxmlElement("w:tblHeader"))


def _set_compact_cell_text(
    cell, value: Any, size: float = 8.5, line_spacing: float = 1, *, preserve_placeholder: bool = False
) -> None:
    paragraphs = list(cell.paragraphs)
    paragraph = paragraphs[0]
    for extra in paragraphs[1:]:
        cell._tc.remove(extra._p)
    if paragraph.runs:
        run = paragraph.runs[0]
        run.text = str(value or "").strip() if preserve_placeholder else clean_issue_value(value)
        for extra in paragraph.runs[1:]:
            extra.text = ""
    else:
        run = paragraph.add_run(str(value or "").strip() if preserve_placeholder else clean_issue_value(value))
    run.font.size = Pt(size)
    run.font.name = "Arial"
    run.bold = False
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), "Arial")
    paragraph.paragraph_format.space_before = Pt(0)
    paragraph.paragraph_format.space_after = Pt(0)
    paragraph.paragraph_format.line_spacing = line_spacing
    paragraph.paragraph_format.left_indent = Pt(0)
    paragraph.paragraph_format.right_indent = Pt(0)
    paragraph.paragraph_format.first_line_indent = Pt(0)
    paragraph.paragraph_format.keep_with_next = False
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def _format_sds_table(table, centered_columns: set[int], *, vertical_padding: int = 60) -> None:
    """Normalize the template's cell-level overrides without changing data."""
    table.autofit = False
    # The supplied master uses negative body indents. Give all SDS tables
    # the same left edge and printable width instead of each table's offset.
    props = table._tbl.tblPr
    for tag, value in (("tblInd", "-576"), ("tblW", "10368")):
        node = props.find(qn(f"w:{tag}"))
        if node is None:
            node = OxmlElement(f"w:{tag}")
            props.append(node)
        node.set(qn("w:w"), value)
        node.set(qn("w:type"), "dxa")
    widths = [column.width for column in table.columns]
    total_width = sum(widths)
    widths = [Inches(7.2 * width / total_width) for width in widths]
    for column, width in zip(table.columns, widths):
        column.width = width
    for row_index, row in enumerate(table.rows):
        _set_row_no_split(row, repeat_header=row_index == 0)
        for column_index, cell in enumerate(row.cells):
            cell.width = widths[column_index]
            margins = cell._tc.get_or_add_tcPr().find(qn("w:tcMar"))
            if margins is None:
                margins = OxmlElement("w:tcMar")
                cell._tc.get_or_add_tcPr().append(margins)
            for side, width in (("top", vertical_padding), ("bottom", vertical_padding), ("left", 70), ("right", 70)):
                node = margins.find(qn(f"w:{side}"))
                if node is None:
                    node = OxmlElement(f"w:{side}")
                    margins.append(node)
                node.set(qn("w:w"), str(width))
                node.set(qn("w:type"), "dxa")
            value = cell.text.strip()
            size = 8.5
            _set_compact_cell_text(cell, value, size=size, line_spacing=1.05, preserve_placeholder=True)
            paragraph = cell.paragraphs[0]
            paragraph.alignment = (
                WD_ALIGN_PARAGRAPH.CENTER if row_index == 0 or column_index in centered_columns
                else WD_ALIGN_PARAGRAPH.LEFT
            )
            paragraph.runs[0].bold = row_index == 0


def _align_sds_label_paragraph(paragraph, value_offset: float) -> None:
    if paragraph._p.xpath(".//w:drawing | .//w:pict") or "\t" not in paragraph.text:
        return
    label, value = paragraph.text.strip().split("\t", 1)
    paragraph.text = label.rstrip() + "\t" + value.lstrip("\t ")
    fmt = paragraph.paragraph_format
    fmt.left_indent = Pt(value_offset)
    fmt.first_line_indent = Pt(-value_offset)
    fmt.right_indent = Pt(0)
    fmt.tab_stops.clear_all()
    fmt.tab_stops.add_tab_stop(Pt(value_offset))
    fmt.space_after = Pt(4)
    fmt.line_spacing = 1.05
    paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
    for run in paragraph.runs:
        run.font.name = "Arial"
        run.font.size = Pt(10)
        run.bold = False


def _align_sds_labels(document) -> None:
    for paragraph in list(document.paragraphs):
        if paragraph.text.startswith("This mixture has not been tested") and "\nAcute Toxicity:" in paragraph.text:
            # Individual paragraphs allow wrapped values to align with their
            # value column instead of returning to the page's left margin.
            lines = paragraph.text.split("\n")
            paragraph.text = lines[0]
            for run in paragraph.runs:
                run.font.name = "Arial"
                run.font.size = Pt(10)
                run.bold = False
            anchor = paragraph
            for line in lines[1:]:
                node = deepcopy(paragraph._p)
                anchor._p.addnext(node)
                anchor = Paragraph(node, paragraph._parent)
                anchor.text = line
                _align_sds_label_paragraph(anchor, 190)
        elif re.match(r"^(Class and category of danger|Hazard statements|Supplemental Information|Precautionary statements)", paragraph.text.strip()):
            _align_sds_label_paragraph(paragraph, 155)
    for paragraph in document.paragraphs:
        if re.match(r"^(Section \d+[.:]|\d+\.\d+\s|Respiratory Protection|Information about hazardous ingredients|Key to abbreviations)", paragraph.text.strip()):
            paragraph.paragraph_format.keep_with_next = True


def _populate_composition_table(table, template_row, ingredients: list[dict]) -> None:
    while len(table.rows) > 1:
        table._tbl.remove(table.rows[-1]._tr)
    _set_row_no_split(table.rows[0], repeat_header=True)
    for item in ingredients:
        table._tbl.append(deepcopy(template_row))
        row = table.rows[-1]
        _set_row_no_split(row)
        values = [
            item.get("canonical_name") or item.get("name"), item.get("cas"), item.get("ec"),
            _format_concentration(item.get("concentration")),
            _compact_classification(item.get("classification")),
            item.get("specific_concentration_limits") if item.get("classification_source") else
            (item.get("specific_concentration_limits") or item.get("toxicology")),
        ]
        for index, value in enumerate(values):
            if index < len(row.cells):
                _set_compact_cell_text(
                    row.cells[index], clean_issue_value(value) or "Not available",
                    size=8 if index >= 4 else 8.5,
                    line_spacing=1,
                    preserve_placeholder=True,
                )


def _reset_workplace_exposure_table(table) -> None:
    template_row = deepcopy(table.rows[1]._tr if len(table.rows) > 1 else table.rows[0]._tr)
    while len(table.rows) > 1:
        table._tbl.remove(table.rows[-1]._tr)
    table._tbl.append(template_row)
    _set_row_no_split(table.rows[0], repeat_header=True)
    _set_row_no_split(table.rows[1])
    for index, cell in enumerate(table.rows[1].cells):
        _set_compact_cell_text(cell, "NONE" if index == 0 else "Not applicable", preserve_placeholder=True)


def _split_toxicology(value: Any) -> tuple[str, str, str, str]:
    oral = dermal = inhalation = route = ""
    unassigned: list[str] = []
    for part in (piece.strip() for piece in re.split(r"\s*;\s*", clean_issue_value(value)) if piece.strip()):
        match = re.match(r"(?i)^(oral|dermal|inhalation)\s*:\s*(.*)$", part)
        if not match:
            unassigned.append(part)
            continue
        label, result = match.group(1).lower(), match.group(2).strip()
        if label == "oral":
            oral = result
        elif label == "dermal":
            dermal = result
        else:
            inhalation = result
    if unassigned:
        oral = "; ".join([oral, *unassigned]).strip("; ")
    return oral, dermal, inhalation, route


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
            _set_cell_text_preserving_layout(
                target,
                clean_issue_value(item.get("concentration"), absent) if item else absent,
            )


def _set_cell_text_preserving_layout(cell, value: Any) -> None:
    paragraphs = list(cell.paragraphs)
    paragraph = paragraphs[0]
    for extra in paragraphs[1:]:
        cell._tc.remove(extra._p)
    if paragraph.runs:
        run = paragraph.runs[0]
        run.text = clean_issue_value(value)
        for extra in paragraph.runs[1:]:
            extra.text = ""
    else:
        paragraph.add_run(clean_issue_value(value))


def _tighten_ifra_certificate(document) -> None:
    if len(document.tables) < 2:
        return
    annex = max(document.tables, key=lambda table: len(table.rows))
    for row_index, row in enumerate(annex.rows):
        _set_row_no_split(row, repeat_header=row_index == 0)
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                paragraph.paragraph_format.space_before = Pt(0)
                paragraph.paragraph_format.space_after = Pt(0)
                paragraph.paragraph_format.line_spacing = 0.9
                for run in paragraph.runs:
                    if run.font.size is None or run.font.size.pt > 7:
                        run.font.size = Pt(7)


def _fill_sds(document, fields: dict[str, str], ingredients: list[dict], product: str, code: str) -> None:
    # Generation also corrects previously approved snapshots. The saved
    # ingredient rows and formula concentrations are never mutated here.
    ingredients = deepcopy(ingredients)
    for item in ingredients:
        apply_raw_material_reference(item)
    fields = dict(fields)
    cedar_reference = is_cedar_sage_reference_formula(product, code, ingredients)
    if cedar_reference:
        for field, value in CEDAR_SAGE_SDS_LABEL.items():
            if not clean_issue_value(fields.get(field)):
                fields[field] = value
    mixture_label = _derived_mixture_label(fields, ingredients)
    hazard_codes = set(filter(None, mixture_label["codes"].split(",")))
    if cedar_reference and not clean_issue_value(fields.get("ecology")):
        hazard_codes.add("H412")
    stated_transport = normalise(fields.get("transport_un_number")).replace(" ", "")
    transport_is_un3082 = (
        stated_transport == "un3082" or
        (not stated_transport and (cedar_reference or "H411" in hazard_codes))
    )
    classification = _multiline_regulatory_value(mixture_label["classification"])
    hazard_statements = _multiline_regulatory_value(mixture_label["hazard_statements"], "H")
    precautionary_statements = _multiline_regulatory_value(mixture_label["precautionary_statements"], "P")
    supplemental_information = _h317_supplemental_information(ingredients, fields.get("supplemental_information"))
    _replace_labeled_block(document, r"^Class and category of danger", r"^2\.2\s+Label elements", classification)
    _set_paragraph_value_preserving_layout(
        next((paragraph for paragraph in document.paragraphs if re.search(r"^\s*Signal word", paragraph.text, re.IGNORECASE)), document.paragraphs[0]),
        (r"^Signal word",), mixture_label["signal_word"], preserve_placeholder=True,
    )
    _replace_labeled_block(document, r"^Hazard statements", r"^Supplemental Information", hazard_statements)
    _replace_labeled_block(document, r"^Supplemental Information", r"^Precautionary statements", supplemental_information)
    _replace_labeled_block(document, r"^Precautionary statements", r"^Pictograms", precautionary_statements)
    pictogram_names = {normalise(value) for value in mixture_label["pictograms"].split(",") if normalise(value)}
    use_reference_artwork = {"irritant", "environmental hazard"}.issubset(pictogram_names)
    _replace_labeled_block(
        document, r"^Pictograms", r"^Other hazards",
        mixture_label["pictograms"] or "Not applicable",
        remove_drawings=not use_reference_artwork,
    )
    other_hazards = next((paragraph for paragraph in document.paragraphs if re.search(r"^\s*Other hazards", paragraph.text, re.IGNORECASE)), None)
    if other_hazards is not None:
        _set_paragraph_value_preserving_layout(other_hazards, (r"^Other hazards",), clean_issue_value(fields.get("other_hazards")) or "None")
    _replace_section_body(document, r"^4\.2\s+Most important symptoms", r"^4\.3\s+", hazard_statements)
    _replace_section_body(
        document, r"^7\.2\s+Conditions for safe storage", r"^7\.3\s+",
        clean_issue_value(fields.get("storage_condition")) or "Store in a cool, well-ventilated place away from direct sunlight.",
    )
    ecology = clean_issue_value(fields.get("ecology"))
    if not ecology:
        ecology = "Toxic to aquatic life with long lasting effects." if "H411" in hazard_codes else "Based on available data the classification criteria are not met."
    _replace_section_body(document, r"^12\.1\s+Toxicity", r"^12\.2\s+", ecology)
    _replace_section_body(document, r"^14\.5\s+Environmental hazards", r"^14\.6\s+", clean_issue_value(fields.get("transport_environmental_hazards")) or ("This is classified as an environmentally hazardous substance under the UN Model Regulations. This is classified as a Marine Pollutant under the IMDG Code." if transport_is_un3082 else "Not classified as environmentally hazardous for transport."))
    _replace_section_body(document, r"^14\.6\s+Special precautions", r"^14\.7\s+", clean_issue_value(fields.get("transport_precautions")) or "None additional")
    _replace_section_body(document, r"^14\.7\s+Maritime transport", r"^Section 15", clean_issue_value(fields.get("transport_bulk")) or "Not applicable", preserve_placeholder=True)
    regulatory_information = clean_issue_value(fields.get("regulatory_information"))
    if not regulatory_information:
        svhc_names = [clean_issue_value(item.get("svhc_identity")) for item in ingredients if clean_issue_value(item.get("svhc_identity"))]
        regulatory_information = f"The following SVHC substances are contained in this fragrance:\n{', '.join(svhc_names)}" if svhc_names else "This fragrance does not contain any identified SVHC substances."
    _replace_section_body(document, r"^15\.1\s+Safety, health and environmental", r"^15\.2\s+", regulatory_information)
    _replace_section_body(document, r"^15\.2\s+Chemical Safety Assessment", r"^Section 16", clean_issue_value(fields.get("chemical_safety_assessment")) or "A Chemical Safety Assessment has not been carried out for this product")
    _replace_section_body(document, r"^11\.1\s+Information on hazard classes", r"^Information about hazardous ingredients", _toxicology_summary(hazard_codes, fields))
    section_12_defaults = (
        (r"^12\.2\s+Persistence and degradability", r"^12\.3\s+", "Not available"),
        (r"^12\.3\s+Bio accumulative potential", r"^12\.4\s+", "Not available"),
        (r"^12\.4\s+Mobility in soil", r"^12\.5\s+", "Not available"),
        (r"^12\.5\s+Results of PBT", r"^12\.6\s+", "Not available"),
        (r"^12\.6\s+Endocrine disrupting properties", r"^12\.7\s+", "Not applicable"),
        (r"^12\.7\s+Other adverse effects", r"^Section 13", "None known"),
        (r"^Key to revisions", r"^Key to abbreviations", "Sections 2, 3, 9, 11, 12, 14 and 15 updated from the approved workflow."),
    )
    for heading, following, default in section_12_defaults:
        _replace_section_body(document, heading, following, default, preserve_placeholder=True)

    _fill_section_9(document, fields)

    composition_tables = [
        table for table in document.tables
        if table.rows and "cas" in normalise(" ".join(c.text for c in table.rows[0].cells))
        and "%" in " ".join(c.text for c in table.rows[0].cells)
        and len(table.rows[0].cells) == 6
    ]
    if not composition_tables:
        return
    composition = composition_tables[0]
    primary_template = deepcopy(composition.rows[1]._tr if len(composition.rows) > 1 else composition.rows[0]._tr)
    # Word flows this table naturally across pages. The following six-column
    # table belongs to workplace exposure limits and is not a continuation.
    _populate_composition_table(composition, primary_template, ingredients)
    if len(composition_tables) > 1:
        _reset_workplace_exposure_table(composition_tables[1])

    # Product-specific toxicology: replace all sample-product rows. A single
    # reviewed free-text value is kept in the first result column.
    toxicity = next((table for table in document.tables if table.rows and "ld50 ate oral" in normalise(" ".join(c.text for c in table.rows[0].cells))), None)
    if toxicity is not None:
        template_row = deepcopy(toxicity.rows[1]._tr if len(toxicity.rows) > 1 else toxicity.rows[0]._tr)
        while len(toxicity.rows) > 1:
            toxicity._tbl.remove(toxicity.rows[-1]._tr)
        for item in ingredients:
            if cedar_reference and clean_issue_value(item.get("canonical_name") or item.get("name")) not in CEDAR_SAGE_SECTION_11_INGREDIENTS:
                continue
            value = clean_issue_value(item.get("specific_concentration_limits") if item.get("classification_source") else item.get("toxicology"))
            if not value:
                continue
            toxicity._tbl.append(deepcopy(template_row)); cells = toxicity.rows[-1].cells
            oral, dermal, inhalation, route = _split_toxicology(value)
            values = [item.get("canonical_name") or item.get("name"), item.get("cas"), item.get("ec"), oral, dermal, inhalation, route]
            for index, cell_value in enumerate(values):
                if index < len(cells):
                    _set_compact_cell_text(cells[index], cell_value or "Not available", size=8, preserve_placeholder=True)
        if len(toxicity.rows) == 1:
            toxicity._tbl.append(deepcopy(template_row)); cells = toxicity.rows[-1].cells
            values = ["NONE", "Not applicable", "Not applicable", "Not available", "Not available", "Not available", "Not available"]
            for index, cell_value in enumerate(values):
                if index < len(cells):
                    _set_compact_cell_text(cells[index], cell_value, size=8, preserve_placeholder=True)

    # Transport classification is a mixture-level decision. Never retain the
    # example product's ingredient names in a newly generated SDS.
    transport = next((table for table in document.tables if table.rows and "un proper shipping name" in normalise(" ".join(c.text for c in table.rows[0].cells))), None)
    if transport is not None:
        _set_compact_cell_text(transport.rows[0].cells[0], "Regulation")
        transport_heading = next((paragraph for paragraph in document.paragraphs if re.search(r"^\s*Section 14\.", paragraph.text, re.IGNORECASE)), None)
        if transport_heading is not None:
            transport_heading.paragraph_format.keep_with_next = True
            transport_heading.paragraph_format.page_break_before = False
        environmental_names = sorted(
            (
                (_numeric_concentration(item.get("concentration")), clean_issue_value(item.get("name")))
                for item in ingredients
                if re.search(r"\bH411\b", clean_issue_value(item.get("classification")), re.IGNORECASE)
            ),
            reverse=True,
        )
        reference_names = un3082_technical_names(ingredients)
        technical_names = ", ".join(reference_names or [name for _, name in environmental_names[:2] if name])
        for row in transport.rows[1:]:
            if transport_is_un3082:
                proper_name = f"ENVIRONMENTALLY HAZARDOUS SUBSTANCE, LIQUID, N.O.S. ({technical_names})"
                if normalise(row.cells[0].text) == "imdg":
                    proper_name += " MARINE POLLUTANT"
                values = ["UN3082", proper_name, "9", "-", "III"]
            else:
                values = ["Not regulated", "Not regulated as dangerous goods", "-", "-", "-"]
            for cell, value in zip(row.cells[1:], values):
                _set_compact_cell_text(cell, value)

    # Clear any sample row in the generic ingredient/value table.
    generic = next((table for table in document.tables if table.rows and normalise(" ".join(c.text for c in table.rows[0].cells)) == "ingredient cas ec description value"), None)
    if generic is not None:
        for row in generic.rows[1:]:
            for index, cell in enumerate(row.cells):
                _set_compact_cell_text(cell, "NONE" if index == 0 else "Not applicable", preserve_placeholder=True)

    _format_sds_table(composition, {1, 2, 3})
    for table in composition_tables[1:]:
        _format_sds_table(table, {1, 2, 3})
    if toxicity is not None:
        _format_sds_table(toxicity, {1, 2})
    if transport is not None:
        _format_sds_table(transport, {1, 3, 4, 5})
    if generic is not None:
        _format_sds_table(generic, {1, 2, 4})
    for table in document.tables:
        if table.rows and normalise(" ".join(cell.text for cell in table.rows[0].cells)) == "abbreviation meaning":
            _format_sds_table(table, set(), vertical_padding=40)
    _align_sds_labels(document)

    _remove_duplicate_particle_characteristics(document)
    _prune_blank_paragraphs_between(document, r"^11\.1\s+Information on hazard classes", r"^Information about hazardous ingredients")
    _prune_blank_paragraphs_between(document, r"^13\.1\s+Waste treatment methods", r"^Section 14\.")
    _prune_blank_paragraphs_between(document, r"^15\.1\s+Safety, health and environmental", r"^15\.2\s+")
    _prune_blank_paragraphs_between(document, r"^Key to revisions", r"^Key to abbreviations")


def generate_regulatory_docx(template: Path, output: Path, document_type: str, product: str, code: str, fields: dict[str, str], ingredients: list[dict]) -> None:
    if document_type not in DOCUMENT_TYPES:
        raise ValueError("Unsupported regulatory document type.")
    document = Document(template)
    clean_product = clean_issue_value(product)
    clean_code = clean_issue_value(code)
    # IFRA certificates and allergen declarations expose one product-name line
    # rather than a separate product-code field, so retain the code on that line.
    display_product = f"{clean_product} {clean_code}".strip() if document_type in {"ifra_certificate", "allergen_report"} else clean_product
    _replace_product(document, display_product, clean_code)
    # Every supplied regulatory master carries the same Version/Date footer.
    # Replace the example metadata for every generated document, not only SDS.
    _set_footer_metadata(document, fields)
    if document_type == "sds":
        _fill_sds(document, fields, ingredients, clean_product, clean_code)
    elif document_type == "ifra_certificate":
        _tighten_ifra_certificate(document)
    elif document_type == "ifra_amendment":
        _fill_catalog_tables(document, ingredients, "NIL")
    elif document_type == "allergen_report":
        _fill_catalog_tables(document, ingredients, "-")
    elif document_type == "reach_declaration":
        _fill_catalog_tables(document, ingredients, "NIL")
    output.parent.mkdir(parents=True, exist_ok=True)
    document.save(output)
