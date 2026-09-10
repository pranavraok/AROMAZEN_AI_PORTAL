import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import httpx

from app.modules.regulatory.research import (
    _lookup_names,
    _parse_ghs,
    epa_comptox_identity,
    echa_svhc_status,
    ifra_snapshot_match,
    nite_ghs_match,
    template_reference_match,
    valid_cas,
)
from app.modules.regulatory.routes import _ingredient_lookup_keys, _master_lookup_index


def test_cas_checksum_rejects_ec_number_with_same_shape() -> None:
    assert valid_cas("24851-98-7")
    assert not valid_cas("246-495-9")


def test_common_regulatory_name_variants() -> None:
    assert _lookup_names("ISO BORNYL ACETATE") == ["ISO BORNYL ACETATE", "ISOBORNYL ACETATE"]
    assert _lookup_names("TERPINYL ACETATE") == ["TERPINYL ACETATE", "alpha-terpinyl acetate"]
    assert _lookup_names("CARRYOPHELLENE OXIDE SS")[1] == "CARYOPHYLLENE OXIDE"
    assert _lookup_names("FLORASOL") == ["FLORASOL", "FLOROSOL"]
    assert _lookup_names("DHM")[1] == "dihydromyrcenol"


def test_standardized_master_wins_over_old_misspelled_record() -> None:
    old = SimpleNamespace(
        normalized_name="florasol", display_name="FLORASOL",
        data_json={"name": "FLORASOL"}, approved_by_user_id="employee",
    )
    corrected = SimpleNamespace(
        normalized_name="florosol", display_name="FLOROSOL",
        data_json={"name": "FLOROSOL", "cas": "63500-71-0"}, approved_by_user_id="employee",
    )
    index = _master_lookup_index([old, corrected])
    first_key = _ingredient_lookup_keys("FLORASOL")[0]
    assert first_key == "florosol"
    assert index[first_key] is corrected


def test_ghs_uses_trusted_eu_reference_and_ignores_vendor_data() -> None:
    record = {
        "Reference": [
            {"ReferenceNumber": 1, "SourceName": "Regulation (EC) No 1272/2008 of the European Parliament and of the Council", "URL": "https://eur-lex.europa.eu/eli/reg/2008/1272/oj"},
            {"ReferenceNumber": 2, "SourceName": "Vendor SDS", "URL": "https://example.com/sds"},
        ],
        "Section": [{"TOCHeading": "GHS Classification", "Information": [
            {"ReferenceNumber": 1, "Name": "Signal", "Value": {"StringWithMarkup": [{"String": "Warning"}]}},
            {"ReferenceNumber": 1, "Name": "GHS Hazard Statements", "Value": {"StringWithMarkup": [{"String": "H317 (24.5%): May cause an allergic skin reaction [Warning Sensitization, Skin]"}]}},
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


def test_versioned_nite_and_ifra_data_require_exact_identifiers() -> None:
    nite = {"version": "NITE 2026-09-02", "records": [{
        "cas": "78-70-6",
        "name": "Linalool",
        "classification": "Skin sensitization: Category 1",
        "detail_url": "https://www.chem-info.nite.go.jp/example",
    }]}
    values, _, checks, versions = nite_ghs_match(nite, {"name": "Linalool", "cas": "78-70-6"})
    assert values["classification"] == "Skin sensitization: Category 1"
    assert checks["nite_ghs"]["status"] == "matched"
    assert versions["nite_ghs"] == "NITE 2026-09-02"
    values, _, checks, _ = nite_ghs_match(nite, {"name": "Linalool", "cas": ""})
    assert values == {}
    assert checks["nite_ghs"]["status"] == "not_found"

    ifra = {"version": "IFRA 51st Amendment official overview", "records": [{
        "name": "Linalool",
        "normalized_name": "linalool",
        "normalized_synonyms": [],
        "cas": ["78-70-6"],
        "standard_type": "RESTRICTION",
        "intrinsic_property": "DERMAL SENSITIZATION",
        "amendment": "49",
        "limits": "Category 4: 0.6%",
    }]}
    values, _, checks, _ = ifra_snapshot_match(ifra, {"name": "Linalool", "cas": "78-70-6"})
    assert values["ifra_limits"] == "Category 4: 0.6%"
    assert checks["ifra"]["status"] == "listed"


def test_epa_comptox_exact_identity_mapping() -> None:
    async def check() -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            if "/chemical/search/equal/" in request.url.path:
                payload = {"preferredName": "Linalool", "casrn": "78-70-6", "dtxsid": "DTXSID1022062"}
            else:
                payload = {"valid": ["Linalool", "3,7-Dimethyl-1,6-octadien-3-ol"]}
            return httpx.Response(200, content=json.dumps(payload), request=request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            values, urls, checks, versions = await epa_comptox_identity(
                client,
                name="Linalool",
                api_key="test-key",
            )
        assert values["canonical_name"] == "Linalool"
        assert values["cas"] == "78-70-6"
        assert "3,7-Dimethyl-1,6-octadien-3-ol" in values["aliases"]
        assert checks["epa_comptox"]["status"] == "matched"
        assert versions["epa_comptox"] == "DTXSID1022062"
        assert urls[0].endswith("/DTXSID1022062")

    asyncio.run(check())


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
