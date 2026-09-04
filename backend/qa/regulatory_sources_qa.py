"""Live official-source QA using generic public test chemicals only."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx

from app.modules.regulatory.research import (
    PUBCHEM_THROTTLE,
    echa_svhc_status,
    ifra_snapshot_match,
    load_echa_candidate_snapshot,
    load_ifra_snapshot,
    load_nite_ghs_snapshot,
    nite_ghs_match,
    pubchem_regulatory_record,
)


async def main() -> None:
    with TemporaryDirectory(prefix="aromazen-regulatory-source-qa-") as directory:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            cache_dir = Path(directory)
            echa_snapshot = await load_echa_candidate_snapshot(client, cache_dir)
            nite_snapshot = await load_nite_ghs_snapshot(client, cache_dir)
            ifra_snapshot = await load_ifra_snapshot(client, cache_dir)
            linalool, linalool_urls, linalool_checks, _ = await pubchem_regulatory_record(client, "Linalool", PUBCHEM_THROTTLE)
            dhm, _, _, _ = await pubchem_regulatory_record(client, "DHM", PUBCHEM_THROTTLE)
            svhc_positive, _, positive_checks, _ = await echa_svhc_status(
                client,
                name="Bis(2-ethylhexyl) phthalate",
                cas="117-81-7",
                ec="204-211-0",
                snapshot=echa_snapshot,
            )
            _, _, negative_checks, _ = await echa_svhc_status(
                client,
                name="Linalool",
                cas="78-70-6",
                ec="201-134-4",
                snapshot=echa_snapshot,
            )
            nite_values, _, nite_checks, _ = nite_ghs_match(nite_snapshot, linalool)
            ifra_values, _, ifra_checks, _ = ifra_snapshot_match(ifra_snapshot, linalool)
    assert linalool["cas"] == "78-70-6"
    assert linalool["ec"] == "201-134-4"
    assert "H317" in linalool["hazard_statements"]
    assert "H317 (" not in linalool["hazard_statements"]
    assert linalool_checks["ghs"]["status"] == "matched"
    assert dhm["cas"] == "18479-58-8"
    assert svhc_positive["svhc_identity"] == "Bis(2-ethylhexyl) phthalate"
    assert positive_checks["svhc"]["status"] == "listed"
    assert negative_checks["svhc"]["status"] == "not_listed"
    assert nite_checks["nite_ghs"]["status"] == "matched"
    assert nite_values["classification"]
    assert ifra_checks["ifra"]["status"] in {"listed", "not_listed"}
    print(json.dumps({
        "linalool": {
            "cas": linalool["cas"],
            "ec": linalool["ec"],
            "classification": linalool.get("classification", ""),
            "hazard_statements": linalool.get("hazard_statements", ""),
            "precautionary_statements": linalool.get("precautionary_statements", ""),
            "signal_word": linalool.get("signal_word", ""),
            "pictograms": linalool.get("pictograms", ""),
            "source_count": len(linalool_urls),
        },
        "dihydromyrcenol_primary_cas": dhm["cas"],
        "svhc_positive": positive_checks["svhc"],
        "svhc_negative": negative_checks["svhc"],
        "offline_reference_versions": {
            "echa": echa_snapshot["version"],
            "nite": nite_snapshot["version"],
            "ifra": ifra_snapshot["version"],
        },
        "ifra_limits_available": bool(ifra_values.get("ifra_limits")),
        "ai_requests": 0,
    }, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
