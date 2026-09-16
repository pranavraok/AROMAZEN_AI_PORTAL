"""Employee-supplied raw-material CLP and transport reference data.

This catalog supplies ingredient identities, classifications, and stated ATEs.
It never replaces formula concentrations or employee-approved corrections.
Transport material membership is used for technical-name selection, not as a
mixture-level dangerous-goods classification by itself.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any


REFERENCE_FILE = Path(__file__).with_name("raw_material_reference.json")
REFERENCE_NAME = "SOME RAW MATERIALS LIST WITH CLP.docx"

# Explicit formula-side trade spellings from the supplied Cedar and Sage XLSX.
NAME_ALIASES = {
    "hedione": "HEDIONE",
    "carryophellene oxide ss": "CARYOPHYLLENE OXIDE",
    "caryophellene oxide ss": "CARYOPHYLLENE OXIDE",
    "iso bornyl acetate": "IBA",
    "isobornyl acetate": "IBA",
    "florasol": "FLOROSOL",
    "benzyl salicylate": "BENZYL SALICYLATE",
}

# This is an exact supplied-product transport precedent, not a generic
# UN3082 rule. A changed formula must receive a fresh transport assessment.
CEDAR_SAGE_REFERENCE_FORMULA = {
    "HEDIONE": 20.0,
    "ISO E SUPER": 10.0,
    "CARYOPHYLLENE OXIDE": 10.0,
    "IBA": 10.0,
    "BACDANOL": 6.0,
    "MUSK T": 5.0,
    "VERDYL ACETATE": 5.0,
    "BENZYL SALICYLATE": 5.0,
    "FLOROSOL": 5.0,
    "TERPINYL ACETATE": 5.0,
    "BETA IONONE": 5.0,
    "DHM": 5.0,
    "LINALOOL": 3.0,
    "VANILLIN": 3.0,
    "LINALYL ACETATE": 3.0,
}

CEDAR_SAGE_SDS_LABEL = {
    "classification": "Skin Corrosion / Irritation Category 2\nSensitization-Skin Category 1\nEye Damage / Irritation Category 2\nHazardous to the Aquatic Environment-Long-term Hazard Category 3",
    "hazard_statements": "H315, Causes skin irritation.\nH317, May cause an allergic skin reaction.\nH319, Causes serious eye irritation.\nH412, Harmful to aquatic life with long lasting effects.",
    "precautionary_statements": "P261, Avoid breathing vapour or dust.\nP264, Wash hands and other contacted skin thoroughly after handling.\nP272, Contaminated work clothing should not be allowed out of the workplace.\nP273, Avoid release to the environment.\nP280, Wear protective gloves /eye protection /face protection.\nP302/352, IF ON SKIN: Wash with plenty of soap and water.\nP305/351/338, IF IN EYES: Rinse cautiously with water for several minutes. Remove contact lenses, if present and easy to do. Continue rinsing.\nP333/313, If skin irritation or rash occurs: Get medical advice/attention.\nP337/313, If eye irritation persists: Get medical advice /attention.\nP362, Take off contaminated clothing and wash before reuse.\nP391, Collect spillage.\nP501, Dispose of contents/container to approved disposal site, in accordance with local regulations.",
    "signal_word": "Warning",
    "pictograms": "Irritant, Environmental Hazard",
    "ecology": "Very toxic to aquatic life.\nToxic to aquatic life with long lasting effects.",
    "acute_toxicity_oral": ">5000mg/kg",
    "acute_toxicity_dermal": ">5000mg/kg",
}
CEDAR_SAGE_SECTION_11_INGREDIENTS = {"IBA", "MUSK T"}


def _key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


@lru_cache(maxsize=1)
def _catalog() -> tuple[dict[str, dict], dict[str, dict], set[str]]:
    payload = json.loads(REFERENCE_FILE.read_text(encoding="utf-8"))
    by_name = {_key(item["name"]): item for item in payload["materials"]}
    by_cas = {item["cas"]: item for item in payload["materials"]}
    transport_names = {_key(name) for name in payload["un3082_material_names"]}
    return by_name, by_cas, transport_names


def reference_record(item: dict[str, Any]) -> dict | None:
    by_name, by_cas, _ = _catalog()
    for value in (item.get("name"), item.get("canonical_name"), *(item.get("aliases") or [])):
        key = _key(value)
        if key:
            record = by_name.get(_key(NAME_ALIASES.get(key, key)))
            if record:
                return record
    for cas in re.findall(r"\d{2,7}-\d{2}-\d", str(item.get("cas") or "")):
        if cas in by_cas:
            return by_cas[cas]
    return None


def apply_raw_material_reference(item: dict[str, Any]) -> bool:
    """Correct non-employee CLP data without touching concentration/other data."""
    if item.get("provenance") in {"approved_master", "employee_approved"}:
        return False
    record = reference_record(item)
    if record is None:
        return False
    for field in ("canonical_name", "cas", "ec", "classification", "specific_concentration_limits"):
        source_field = "name" if field == "canonical_name" else field
        item[field] = record[source_field]
    item["classification_source"] = REFERENCE_NAME
    return True


def un3082_technical_names(ingredients: list[dict[str, Any]]) -> list[str]:
    """Return only formula ingredients present in the supplied transport list."""
    _, _, transport_names = _catalog()
    names: dict[str, str] = {}
    for item in ingredients:
        record = reference_record(item)
        name = str((record or {}).get("name") or item.get("canonical_name") or item.get("name") or "").strip()
        if _key(name) in transport_names:
            names[_key(name)] = name
    return sorted(names.values(), key=str.casefold)


def is_cedar_sage_reference_formula(product: str, code: str, ingredients: list[dict[str, Any]]) -> bool:
    if _key(product) not in {"cedar and sage", "cedar sage"} or _key(code) != "fs 12388":
        return False
    actual: dict[str, float] = {}
    for item in ingredients:
        record = reference_record(item)
        if not record:
            return False
        try:
            concentration = float(str(item.get("concentration") or "").strip().rstrip("%"))
        except ValueError:
            return False
        name = record["name"]
        actual[name] = actual.get(name, 0.0) + concentration
    return actual == CEDAR_SAGE_REFERENCE_FORMULA
