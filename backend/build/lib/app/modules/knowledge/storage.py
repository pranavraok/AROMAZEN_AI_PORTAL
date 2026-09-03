from __future__ import annotations

import re
import unicodedata
import uuid
from pathlib import Path, PurePosixPath


def safe_storage_segment(value: str | None, fallback: str = "file", max_length: int = 80) -> str:
    """Return a readable, filesystem-safe segment for Docker volume storage."""
    normalized = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", normalized).strip("-._").lower()
    return (normalized[:max_length].rstrip("-._") or fallback).lower()


def organized_storage_name(
    namespace: str,
    organization_id: object,
    original_filename: str,
    *,
    category: str | None = None,
    identifier: uuid.UUID | None = None,
    version: int | None = None,
) -> str:
    """Build a readable, collision-safe relative path under the upload volume.

    Example: templates/<org>/hr-letters/offer/appointment-letter--v003--a1b2c3d4.docx
    """
    file_id = identifier or uuid.uuid4()
    supplied = Path(original_filename or "file").name
    extension = safe_storage_segment(Path(supplied).suffix, fallback="", max_length=16)
    if extension and not extension.startswith("."):
        extension = f".{extension}"
    stem = safe_storage_segment(Path(supplied).stem, fallback="file", max_length=96)
    version_part = f"--v{version:03d}" if version is not None else ""
    filename = f"{stem}{version_part}--{file_id.hex[:12]}{extension}"
    segments = [safe_storage_segment(namespace, "uploads"), str(organization_id)]
    if category:
        segments.extend(safe_storage_segment(part, "general") for part in category.replace("\\", "/").split("/") if part)
    return str(PurePosixPath(*segments, filename))
