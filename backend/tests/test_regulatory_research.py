import asyncio
import json
from pathlib import Path

import httpx

from app.modules.regulatory.research import (
    _lookup_names,
    _parse_ghs,
    echa_svhc_status,
    template_reference_match,
    valid_cas,
)


def test_cas_checksum_rejects_ec_number_with_same_shape() -> None:
    assert valid_cas("24851-98-7")
    assert not valid_cas("246-495-9")


def test_common_regulatory_name_variants() -> None:
    assert _lookup_names("ISO BORNYL ACETATE") == ["ISO BORNYL ACETATE", "ISOBORNYL ACETATE"]
    assert _lookup_names("TERPINYL ACETATE") == ["TERPINYL ACETATE", "alpha-terpinyl acetate"]
    assert _lookup_names("CARRYOPHELLENE OXIDE SS")[1] == "CARYOPHYLLENE OXIDE"
    assert _lookup_names("DHM")[1] == "dihydromyrcenol"


def test_ghs_uses_trusted_eu_reference_and_ignores_vendor_data() -> None:
    record = {
        "Reference": [
            {"ReferenceNumber": 1, "SourceName": "Regulation (EC) No 1272/2008 of the European Parliament and of the Council", "URL": "https://eur-lex.europa.eu/eli/reg/2008/1272/oj"},
            {"ReferenceNumber": 2, "SourceName": "Vendor SDS", "URL": "https://example.com/sds"},
        ],
        "Section": [{"TOCHeading": "GHS Classification", "Information": [
            {"ReferenceNumber": 1, "Name": "Signal", "Value": {"StringWithMarkup": [{"String": "Warning"}]}},
            {"ReferenceNumber": 1, "Name": "GHS Hazard Statements", "Value": {"StringWithMarkup": [{"String": "H317: May cause an allergic skin reaction [Warning Sensitization, Skin]"}]}},
            {"ReferenceNumber": 1, "Name": "Precautionary Statement Codes", "Value": {"StringWithMarkup": [{"String": "P261, P280"}]}},
            {"ReferenceNumber": 2, "Name": "GHS Hazard Statements", "Value": {"StringWithMarkup": [{"String": "H999: invented vendor value"}]}},
        ]}],
    }
    values, urls = _parse_ghs(record)
    assert values["signal_word"] == "Warning"
    assert values["hazard_statements"].startswith("H317:")
    assert values["classification"] == "Sensitization, Skin (H317)"
    assert values["precautionary_statements"] == "P261, P280"
    assert "H999" not in values["hazard_statements"]
    assert urls == ["https://eur-lex.europa.eu/eli/reg/2008/1272/oj"]


def test_echa_candidate_list_requires_an_exact_identifier_match() -> None:
    payload = {
        "items": [{
            "substanceName": ["Bis(2-ethylhexyl) phthalate"],
            "ecNumber": ["204-211-0"],
            "casNumber": ["117-81-7"],
            "dateOfInclusion": "28-Oct-2008",
            "reasonForInclusion": ["Toxic for reproduction (Article 57c)"],
            "decision": [],
        }],
    }

    async def check() -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=json.dumps(payload), request=request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            positive, _, checks, _ = await echa_svhc_status(client, name="DEHP", cas="117-81-7", ec="204-211-0")
            assert positive["svhc_identity"] == "Bis(2-ethylhexyl) phthalate"
            assert checks["svhc"]["status"] == "listed"
            negative, _, checks, _ = await echa_svhc_status(client, name="Linalool", cas="78-70-6", ec="201-134-4")
            assert negative == {}
            assert checks["svhc"]["status"] == "not_listed"

    asyncio.run(check())


def test_approved_templates_are_used_as_allergen_and_ifra_masters() -> None:
    templates = Path(__file__).resolve().parents[1] / "app" / "templates" / "regulatory"
    allergen = template_reference_match(templates / "allergen-report.docx", "allergen", {"name": "LINALOOL", "cas": "78-70-6", "ec": "201-134-4"})
    ifra = template_reference_match(templates / "ifra-amendment.docx", "ifra", {"name": "BENZYL ALCOHOL", "cas": "100-51-6", "ec": "202-859-9"})
    assert allergen and allergen["name"].casefold() == "linalool"
    assert ifra and "Restriction" in ifra["standards"]
