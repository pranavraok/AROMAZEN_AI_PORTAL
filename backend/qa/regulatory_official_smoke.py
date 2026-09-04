"""Repeatable zero-AI smoke check for a real Regulatory formula workbook."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import httpx

from app.modules.regulatory.engine import parse_regulatory_excel
from app.modules.regulatory.research import (
    echa_svhc_status,
    pubchem_regulatory_record,
    template_reference_match,
)


async def run(path: Path) -> dict:
    product, code, ingredients = parse_regulatory_excel(path.read_bytes())
    template_root = Path(__file__).resolve().parents[1] / "app" / "templates" / "regulatory"
    semaphore = asyncio.Semaphore(4)

    async def resolve(item: dict, client: httpx.AsyncClient) -> dict:
        async with semaphore:
            values, urls, checks, _ = await pubchem_regulatory_record(client, item["name"])
            candidate = {**item, **values}
            svhc, svhc_urls, svhc_checks, _ = await echa_svhc_status(
                client,
                name=str(candidate.get("canonical_name") or candidate["name"]),
                cas=str(candidate.get("cas") or ""),
                ec=str(candidate.get("ec") or ""),
            )
            candidate.update(svhc)
            checks.update(svhc_checks)
            allergen = template_reference_match(template_root / "allergen-report.docx", "allergen", candidate)
            ifra = template_reference_match(template_root / "ifra-amendment.docx", "ifra", candidate)
            return {
                "input_name": item["name"],
                "canonical_name": candidate.get("canonical_name", ""),
                "cas": candidate.get("cas", ""),
                "ec": candidate.get("ec", ""),
                "classification": candidate.get("classification", ""),
                "ghs_status": (checks.get("ghs") or {}).get("status", "not_found"),
                "svhc_status": (checks.get("svhc") or {}).get("status", "unavailable"),
                "allergen_match": allergen["name"] if allergen else "",
                "ifra_match": ifra["name"] if ifra else "",
                "source_count": len(set([*urls, *svhc_urls])),
            }

    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True) as client:
        rows = await asyncio.gather(*(resolve(item, client) for item in ingredients))
    return {
        "product": product,
        "code": code,
        "ingredient_count": len(rows),
        "identity_resolved": sum(1 for row in rows if row["cas"] or row["ec"]),
        "ai_requests": 0,
        "ingredients": rows,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    args = parser.parse_args()
    print(json.dumps(asyncio.run(run(args.workbook)), indent=2, ensure_ascii=False))
