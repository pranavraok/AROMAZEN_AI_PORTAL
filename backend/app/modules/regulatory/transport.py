"""Conservative transport resolution, separate from ingredient CLP labels.

ADR 2.2.9.1.10.4.6 includes Acute 1 / Chronic 1 / Chronic 2 mixtures.
Missing evidence never establishes that a mixture is not dangerous goods.
"""
import re

from app.modules.regulatory.reference_catalog import un3082_technical_names


def resolve_transport(fields: dict, ingredients: list[dict], cedar_reference: bool = False) -> str:
    stated = str(fields.get("transport_un_number") or "").strip()
    number = re.search(r"\b(?:UN\s*)?(\d{4})\b", stated, re.I)
    if number:
        return "UN" + number.group(1)
    if stated.lower() in {"not regulated", "not dangerous goods", "not classified as dangerous goods"}:
        return "Not regulated"  # Explicit employee mixture-level decision.
    if cedar_reference:
        return "UN3082"
    mixture = str(fields.get("classification") or "") + " " + str(fields.get("hazard_statements") or "")
    # Other transport classes need their own assessment, not the generic Class 9 entry.
    if re.search(r"\bH(?:22[0-8]|260|261|270|271|272|300|301|310|311|330|331)\b", mixture):
        return "Not determined"
    if re.search(r"\bH(?:400|410|411)\b|Aquatic\s+(?:Acute\s+1|Chronic\s+[12])\b", mixture, re.I):
        return "UN3082"
    acute = chronic1 = chronic2 = 0.0
    total = 0.0
    for item in ingredients:
        concentration = str(item.get("concentration") or "").replace(",", ".")
        match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*%?\s*", concentration)
        if not match:
            continue
        percent = float(match.group(1))
        total += percent
        if percent <= 0:
            continue
        classification = str(item.get("classification") or "")
        limits = str(item.get("specific_concentration_limits") or "")
        # With no unambiguous M factor, 1 gives a sufficient lower bound for
        # positive classification only; it is never evidence of non-classification.
        def factor(category):
            match = re.search(rf"\bM(?:\s*-?\s*factor)?\s*\(\s*{category}\s*\)\s*[:=]\s*(\d+(?:\.\d+)?)", limits, re.I)
            return max(1.0, float(match.group(1))) if match else 1.0
        if "H400" in classification:
            acute += percent * factor('acute')
        if "H410" in classification:
            chronic1 += percent * factor('chronic')
        elif "H411" in classification:
            chronic2 += percent
    if acute >= 25 or chronic1 >= 25 or 10 * chronic1 + chronic2 >= 25:
        return "UN3082"
    listed = un3082_technical_names(ingredients)
    if listed:
        if len(ingredients) == 1 and abs(total - 100) < 0.00001:
            return "UN3082"  # The supplied transport reference for that material.
        return "Not determined"  # Membership alone does not classify a diluted mixture.
    return "Not determined"
