"""Live official-source QA using generic public test chemicals only."""

from __future__ import annotations

import asyncio
import json

import httpx

from app.modules.regulatory.research import echa_svhc_status, pubchem_regulatory_record


async def main() -> None:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        linalool, linalool_urls, linalool_checks, _ = await pubchem_regulatory_record(client, "Linalool")
        dhm, _, _, _ = await pubchem_regulatory_record(client, "DHM")
        svhc_positive, _, positive_checks, _ = await echa_svhc_status(
            client,
            name="Bis(2-ethylhexyl) phthalate",
            cas="117-81-7",
            ec="204-211-0",
        )
        _, _, negative_checks, _ = await echa_svhc_status(
            client,
            name="Linalool",
            cas="78-70-6",
            ec="201-134-4",
        )
    assert linalool["cas"] == "78-70-6"
    assert linalool["ec"] == "201-134-4"
    assert "H317" in linalool["hazard_statements"]
    assert linalool_checks["ghs"]["status"] == "matched"
    assert dhm["cas"] == "18479-58-8"
    assert svhc_positive["svhc_identity"] == "Bis(2-ethylhexyl) phthalate"
    assert positive_checks["svhc"]["status"] == "listed"
    assert negative_checks["svhc"]["status"] == "not_listed"
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
        "ai_requests": 0,
    }, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
