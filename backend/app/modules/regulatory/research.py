from __future__ import annotations

import asyncio
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import re
from urllib.parse import quote, urlparse

import httpx
from docx import Document


PUBCHEM_API = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
PUBCHEM_VIEW_API = "https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound"
PUBCHEM_PAGE = "https://pubchem.ncbi.nlm.nih.gov/compound"
ECHA_CANDIDATE_API = "https://chem.echa.europa.eu/api-obligation-list/v1/candidateList"
ECHA_CANDIDATE_PAGE = "https://chem.echa.europa.eu/obligation-lists/candidateList"
IFRA_LIBRARY_PAGE = "https://ifrafragrance.org/standards-library"
EU_COSMETICS_REGULATION = "https://eur-lex.europa.eu/eli/reg/2009/1223/oj"
CAS_PATTERN = re.compile(r"^\d{2,7}-\d{2}-\d$")
EC_PATTERN = re.compile(r"^\d{3}-\d{3}-\d$")
CAS_IN_TEXT = re.compile(r"\b\d{2,7}-\d{2}-\d\b")
EC_IN_TEXT = re.compile(r"\b\d{3}-\d{3}-\d\b")
TRUSTED_GHS_HOSTS = (
    "echa.europa.eu",
    "eur-lex.europa.eu",
    "pubchem.ncbi.nlm.nih.gov",
    "chem-info.nite.go.jp",
    "safeworkaustralia.gov.au",
    "industrialchemicals.gov.au",
    "epa.gov",
    "fda.gov",
)


def valid_cas(value: str) -> bool:
    """Return True only when a CAS-looking identifier has a valid checksum."""
    if not CAS_PATTERN.fullmatch(value):
        return False
    first, second, check = value.split("-")
    body = first + second
    checksum = sum(int(digit) * weight for weight, digit in enumerate(reversed(body), start=1)) % 10
    return checksum == int(check)


def _lookup_names(name: str) -> list[str]:
    cleaned = re.sub(r"\s+", " ", name).strip()
    candidates = [cleaned]
    normalized_trade_name = re.sub(r"\s+SS$", "", cleaned, flags=re.IGNORECASE)
    normalized_trade_name = re.sub(r"CARRYOPHELLENE", "CARYOPHYLLENE", normalized_trade_name, flags=re.IGNORECASE)
    if normalized_trade_name.casefold() != cleaned.casefold():
        candidates.append(normalized_trade_name)
    collapsed_iso = re.sub(r"^ISO\s+(?=[A-Z]{4,}\b)", "ISO", cleaned, count=1, flags=re.IGNORECASE)
    if collapsed_iso.casefold() != cleaned.casefold():
        candidates.append(collapsed_iso)
    if re.fullmatch(r"TERPINYL\s+ACETATE", cleaned, flags=re.IGNORECASE):
        candidates.append("alpha-terpinyl acetate")
    if cleaned.casefold() == "dhm":
        candidates.append("dihydromyrcenol")
    return candidates


def _unique(values: list[str], *, limit: int) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = re.sub(r"\s+", " ", str(value)).strip(" ;,|")
        key = cleaned.casefold()
        if not cleaned or key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
        if len(result) >= limit:
            break
    return result


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _host(url: object) -> str:
    return (urlparse(str(url or "")).hostname or "").lower().rstrip(".")


def _trusted_host(url: object) -> bool:
    host = _host(url)
    return any(host == allowed or host.endswith(f".{allowed}") for allowed in TRUSTED_GHS_HOSTS)


async def _official_get(client: httpx.AsyncClient, url: str, *, params: dict | None = None) -> httpx.Response:
    response: httpx.Response | None = None
    for attempt in range(4):
        response = await client.get(url, params=params)
        if response.status_code not in {429, 502, 503, 504}:
            return response
        retry_after = response.headers.get("retry-after")
        delay = float(retry_after) if retry_after and retry_after.replace(".", "", 1).isdigit() else 0.6 * (2 ** attempt)
        await asyncio.sleep(min(delay, 5.0))
    assert response is not None
    return response


async def _pubchem_get(client: httpx.AsyncClient, url: str) -> httpx.Response:
    return await _official_get(client, url)


def _section_information(record: dict, heading: str) -> list[dict]:
    found: list[dict] = []

    def visit(value: object) -> None:
        if not isinstance(value, dict):
            return
        if str(value.get("TOCHeading") or "").casefold() == heading.casefold():
            found.extend(item for item in value.get("Information") or [] if isinstance(item, dict))
        for child in value.get("Section") or []:
            visit(child)

    visit(record)
    return found


def _information_strings(information: dict) -> list[str]:
    value = information.get("Value") or {}
    strings: list[str] = []
    for entry in value.get("StringWithMarkup") or []:
        if isinstance(entry, dict) and str(entry.get("String") or "").strip():
            strings.append(str(entry["String"]).strip())
    if isinstance(value.get("String"), str) and value["String"].strip():
        strings.append(value["String"].strip())
    return strings


def _information_icons(information: dict) -> list[str]:
    icons: list[str] = []
    for entry in (information.get("Value") or {}).get("StringWithMarkup") or []:
        for markup in entry.get("Markup") or [] if isinstance(entry, dict) else []:
            if markup.get("Type") == "Icon" and str(markup.get("Extra") or "").strip():
                icons.append(str(markup["Extra"]).strip())
    return icons


def _ghs_reference_rank(reference: dict) -> int | None:
    source = str(reference.get("SourceName") or "").casefold()
    host = _host(reference.get("URL"))
    if "regulation (ec) no 1272/2008" in source or host.endswith("eur-lex.europa.eu"):
        return 0
    if "european chemicals agency" in source or host.endswith("echa.europa.eu"):
        return 1
    if _trusted_host(reference.get("URL")):
        return 2
    return None


def _classification_from_hazards(hazards: list[str]) -> str:
    classes: list[str] = []
    for hazard in hazards:
        code_match = re.search(r"\bH\d{3}(?:\+H\d{3})*\b", hazard)
        code = code_match.group(0) if code_match else ""
        for bracketed in re.findall(r"\[([^\]]+)\]", hazard):
            label = re.sub(r"^(?:Danger|Warning)\s+", "", bracketed, flags=re.IGNORECASE).strip()
            if label:
                classes.append(f"{label} ({code})" if code else label)
    return "; ".join(_unique(classes, limit=20))


def _parse_ghs(record: dict) -> tuple[dict, list[str]]:
    references = {
        int(item.get("ReferenceNumber")): item
        for item in record.get("Reference") or []
        if isinstance(item, dict) and item.get("ReferenceNumber") is not None
    }
    ranked = []
    for item in _section_information(record, "GHS Classification"):
        reference = references.get(int(item.get("ReferenceNumber") or -1), {})
        rank = _ghs_reference_rank(reference)
        if rank is not None:
            ranked.append((rank, item, reference))
    if not ranked:
        return {}, []
    best_rank = min(rank for rank, _, _ in ranked)
    selected = [(item, reference) for rank, item, reference in ranked if rank == best_rank]
    hazards: list[str] = []
    precaution_codes: list[str] = []
    signals: list[str] = []
    pictograms: list[str] = []
    source_urls: list[str] = []
    for item, reference in selected:
        name = str(item.get("Name") or "").casefold()
        values = _information_strings(item)
        if name == "ghs hazard statements":
            hazards.extend(values)
        elif name == "precautionary statement codes":
            for value in values:
                precaution_codes.extend(re.findall(r"\bP\d{3}(?:\+P\d{3})*\b", value))
        elif name == "signal":
            signals.extend(values)
        elif name == "pictogram(s)":
            pictograms.extend(_information_icons(item))
        if _trusted_host(reference.get("URL")):
            source_urls.append(str(reference["URL"]))
    hazards = _unique(hazards, limit=30)
    signal_values = _unique(signals, limit=5)
    signal = "Danger" if any(value.casefold() == "danger" for value in signal_values) else "Warning" if signal_values else ""
    suggestion = {
        "classification": _classification_from_hazards(hazards),
        "hazard_statements": "; ".join(hazards),
        "precautionary_statements": ", ".join(_unique(precaution_codes, limit=40)),
        "signal_word": signal,
        "pictograms": ", ".join(_unique(pictograms, limit=10)),
    }
    return {key: value for key, value in suggestion.items() if value}, _unique(source_urls, limit=12)


async def _primary_cas(client: httpx.AsyncClient, cid: int, fallback: list[str]) -> str:
    valid = [value for value in fallback if valid_cas(value)]
    if len(set(valid)) <= 1:
        return valid[0] if valid else ""
    response = await _pubchem_get(client, f"{PUBCHEM_VIEW_API}/{cid}/JSON?heading=CAS")
    if response.status_code >= 400:
        return Counter(valid).most_common(1)[0][0]
    values = [
        value
        for item in _section_information(response.json().get("Record") or {}, "CAS")
        for value in _information_strings(item)
        if valid_cas(value)
    ]
    return Counter(values or valid).most_common(1)[0][0]


async def pubchem_regulatory_record(client: httpx.AsyncClient, name: str) -> tuple[dict, list[str], dict, dict]:
    """Resolve identity and defensible GHS fields from PubChem without an AI key."""
    properties: dict | None = None
    for candidate in _lookup_names(name):
        response = await _pubchem_get(
            client,
            f"{PUBCHEM_API}/compound/name/{quote(candidate, safe='')}/property/Title,IUPACName/JSON",
        )
        if response.status_code == 404:
            continue
        response.raise_for_status()
        rows = ((response.json().get("PropertyTable") or {}).get("Properties") or [])
        if rows:
            properties = rows[0]
            break
    checked_at = _now()
    if not properties or not properties.get("CID"):
        return {}, [], {"identity": {"status": "not_found", "source": "PubChem", "checked_at": checked_at}}, {"pubchem": checked_at}

    cid = int(properties["CID"])
    synonyms_response = await _pubchem_get(client, f"{PUBCHEM_API}/compound/cid/{cid}/synonyms/JSON")
    synonyms_response.raise_for_status()
    information = ((synonyms_response.json().get("InformationList") or {}).get("Information") or [{}])[0]
    synonyms = [str(value).strip() for value in information.get("Synonym") or [] if str(value).strip()]
    cas_candidates = [value for value in synonyms if valid_cas(value)]
    cas = await _primary_cas(client, cid, cas_candidates)
    ec_candidates = [value for value in synonyms if EC_PATTERN.fullmatch(value) and not valid_cas(value)]
    ec = Counter(ec_candidates).most_common(1)[0][0] if ec_candidates else ""
    canonical = str(properties.get("Title") or properties.get("IUPACName") or name).strip()
    excluded = {name.casefold(), canonical.casefold(), cas.casefold(), ec.casefold(), ""}
    aliases = _unique(
        [value for value in synonyms if value.casefold() not in excluded and not CAS_PATTERN.fullmatch(value) and not EC_PATTERN.fullmatch(value)],
        limit=12,
    )
    suggestion: dict = {"canonical_name": canonical, "aliases": aliases, "cas": cas, "ec": ec}
    urls = [f"{PUBCHEM_PAGE}/{cid}"]

    ghs_response = await _pubchem_get(client, f"{PUBCHEM_VIEW_API}/{cid}/JSON?heading=GHS%20Classification")
    if ghs_response.status_code < 400:
        ghs, ghs_urls = _parse_ghs(ghs_response.json().get("Record") or {})
        suggestion.update(ghs)
        urls.extend(ghs_urls)
    else:
        ghs = {}
    checks = {
        "identity": {"status": "matched", "source": "PubChem", "checked_at": checked_at},
        "ghs": {"status": "matched" if ghs else "not_found", "source": "Trusted official references via PubChem", "checked_at": checked_at},
    }
    return {key: value for key, value in suggestion.items() if value}, _unique(urls, limit=20), checks, {"pubchem": checked_at}


async def pubchem_identity(client: httpx.AsyncClient, name: str) -> tuple[dict, list[str]]:
    """Backward-compatible identity-only wrapper used by existing callers and tests."""
    suggestion, urls, _, _ = await pubchem_regulatory_record(client, name)
    identity_fields = {key: suggestion[key] for key in ("canonical_name", "aliases", "cas", "ec") if suggestion.get(key)}
    return identity_fields, urls


def _exact_echa_match(item: dict, cas_values: set[str], ec_values: set[str], names: set[str]) -> bool:
    item_cas = {value for value in item.get("casNumber") or [] if isinstance(value, str)}
    item_ec = {value for value in item.get("ecNumber") or [] if isinstance(value, str)}
    item_names = {re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip() for value in item.get("substanceName") or [] if isinstance(value, str)}
    return bool(cas_values.intersection(item_cas) or ec_values.intersection(item_ec) or names.intersection(item_names))


async def echa_svhc_status(client: httpx.AsyncClient, *, name: str, cas: str = "", ec: str = "") -> tuple[dict, list[str], dict, dict]:
    """Check the live ECHA Candidate List using exact CAS/EC/name matching."""
    cas_values = {value for value in CAS_IN_TEXT.findall(cas) if valid_cas(value)}
    ec_values = {value for value in EC_IN_TEXT.findall(ec) if not valid_cas(value)}
    normalized_names = {
        re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()
        for value in _lookup_names(name)
        if value.strip()
    }
    # One exact identifier is sufficient for a definitive list lookup and
    # avoids three ECHA requests for every non-listed ingredient.
    searches = list(cas_values) or list(ec_values) or list(normalized_names)[:1]
    checked_at = _now()
    for search in searches:
        response = await _official_get(client, ECHA_CANDIDATE_API, params={
            "pageIndex": 1,
            "pageSize": 100,
            "searchText": search,
        })
        response.raise_for_status()
        for item in (response.json().get("items") or []):
            if not isinstance(item, dict) or not _exact_echa_match(item, cas_values, ec_values, normalized_names):
                continue
            substance_name = next((str(value).strip() for value in item.get("substanceName") or [] if str(value).strip()), name)
            reasons = [str(value).strip() for value in item.get("reasonForInclusion") or [] if str(value).strip()]
            decision_urls = [
                str(decision.get("decisionPath"))
                for decision in item.get("decision") or []
                if isinstance(decision, dict) and str(decision.get("decisionPath") or "").startswith("https://chem.echa.europa.eu/")
            ]
            check = {
                "status": "listed",
                "source": "ECHA Candidate List",
                "checked_at": checked_at,
                "details": "; ".join(filter(None, [str(item.get("dateOfInclusion") or "").strip(), "; ".join(reasons)])),
            }
            return {"svhc_identity": substance_name}, _unique([ECHA_CANDIDATE_PAGE, *decision_urls], limit=10), {"svhc": check}, {"echa_candidate_list": checked_at}
    check = {"status": "not_listed", "source": "ECHA Candidate List", "checked_at": checked_at}
    return {}, [ECHA_CANDIDATE_PAGE], {"svhc": check}, {"echa_candidate_list": checked_at}


def _normalise(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold()).strip()


def _template_records(path: Path, kind: str) -> list[dict]:
    records: list[dict] = []
    if not path.exists():
        return records
    document = Document(path)
    for table in document.tables:
        for row in table.rows:
            texts = [re.sub(r"\s+", " ", cell.text).strip(" |") for cell in row.cells]
            joined = " | ".join(text for text in texts if text)
            if not joined or "name of ingredient" in joined.casefold() or joined.casefold().startswith("ingredient"):
                continue
            first = next((text for text in texts if text), "")
            name = re.split(r"\bCAS\s+(?:Number|No\.)\s*:", first, maxsplit=1, flags=re.IGNORECASE)[0].strip(" |")
            cases = {value for value in CAS_IN_TEXT.findall(joined) if valid_cas(value)}
            ecs = {value for value in EC_IN_TEXT.findall(joined) if not valid_cas(value)}
            record = {"name": name, "normalized_name": _normalise(name), "cas": cases, "ec": ecs}
            if kind == "ifra":
                standards = _unique(re.findall(r"\b(?:Restriction|Prohibition|Specification)\b", joined, flags=re.IGNORECASE), limit=3)
                years = re.findall(r"\b(?:19|20)\d{2}\b", joined)
                record.update({"standards": standards, "publication_year": years[-1] if years else ""})
            records.append(record)
    return records


def template_reference_match(path: Path | None, kind: str, item: dict) -> dict | None:
    if path is None:
        return None
    cases = {value for value in CAS_IN_TEXT.findall(str(item.get("cas") or "")) if valid_cas(value)}
    ecs = {value for value in EC_IN_TEXT.findall(str(item.get("ec") or "")) if not valid_cas(value)}
    names = {
        _normalise(value)
        for value in [item.get("name"), item.get("canonical_name"), *(item.get("aliases") or [])]
        if _normalise(value)
    }
    for record in _template_records(path, kind):
        if cases.intersection(record["cas"]) or ecs.intersection(record["ec"]) or record["normalized_name"] in names:
            return record
    return None
