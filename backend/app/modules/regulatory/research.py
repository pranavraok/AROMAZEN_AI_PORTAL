from __future__ import annotations

import re
from urllib.parse import quote

import httpx


PUBCHEM_API = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
PUBCHEM_PAGE = "https://pubchem.ncbi.nlm.nih.gov/compound"
CAS_PATTERN = re.compile(r"^\d{2,7}-\d{2}-\d$")
EC_PATTERN = re.compile(r"^\d{3}-\d{3}-\d$")


def valid_cas(value: str) -> bool:
    """Return True only when a CAS-looking synonym has a valid checksum."""
    if not CAS_PATTERN.fullmatch(value):
        return False
    first, second, check = value.split("-")
    body = first + second
    checksum = sum(int(digit) * weight for weight, digit in enumerate(reversed(body), start=1)) % 10
    return checksum == int(check)


def _lookup_names(name: str) -> list[str]:
    cleaned = re.sub(r"\s+", " ", name).strip()
    candidates = [cleaned]
    collapsed_iso = re.sub(r"^ISO\s+(?=[A-Z]{4,}\b)", "ISO", cleaned, count=1, flags=re.IGNORECASE)
    if collapsed_iso.casefold() != cleaned.casefold():
        candidates.append(collapsed_iso)
    if re.fullmatch(r"TERPINYL\s+ACETATE", cleaned, flags=re.IGNORECASE):
        candidates.append("alpha-terpinyl acetate")
    return candidates


def _unique(values: list[str], *, limit: int) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = re.sub(r"\s+", " ", str(value)).strip()
        key = cleaned.casefold()
        if not cleaned or key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
        if len(result) >= limit:
            break
    return result


async def pubchem_identity(client: httpx.AsyncClient, name: str) -> tuple[dict, list[str]]:
    """Resolve identity fields from PubChem without requiring an AI provider key."""
    properties: dict | None = None
    for candidate in _lookup_names(name):
        response = await client.get(
            f"{PUBCHEM_API}/compound/name/{quote(candidate, safe='')}/property/Title,IUPACName/JSON"
        )
        if response.status_code == 404:
            continue
        response.raise_for_status()
        rows = ((response.json().get("PropertyTable") or {}).get("Properties") or [])
        if rows:
            properties = rows[0]
            break
    if not properties or not properties.get("CID"):
        return {}, []

    cid = int(properties["CID"])
    synonyms_response = await client.get(f"{PUBCHEM_API}/compound/cid/{cid}/synonyms/JSON")
    synonyms_response.raise_for_status()
    information = ((synonyms_response.json().get("InformationList") or {}).get("Information") or [{}])[0]
    synonyms = [str(value).strip() for value in information.get("Synonym") or [] if str(value).strip()]
    cas = next((value for value in synonyms if valid_cas(value)), "")
    ec = next((value for value in synonyms if EC_PATTERN.fullmatch(value) and not valid_cas(value)), "")
    canonical = str(properties.get("Title") or properties.get("IUPACName") or name).strip()
    excluded = {name.casefold(), canonical.casefold(), cas.casefold(), ec.casefold(), ""}
    aliases = _unique(
        [value for value in synonyms if value.casefold() not in excluded and not CAS_PATTERN.fullmatch(value) and not EC_PATTERN.fullmatch(value)],
        limit=12,
    )
    suggestion = {"canonical_name": canonical, "aliases": aliases, "cas": cas, "ec": ec}
    return {key: value for key, value in suggestion.items() if value}, [f"{PUBCHEM_PAGE}/{cid}"]
