import calendar
import re
import time
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from uuid import UUID

import structlog
from pypdf import PdfReader
from sqlalchemy import delete, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.ai.providers import OpenAIEmbeddings, estimate_cost
from app.modules.identity.models import (
    AIUsageEvent,
    KnowledgeChunk,
    KnowledgeCollection,
    KnowledgeDocument,
    User,
    collection_departments,
)
from app.modules.identity.service import role_keys_for_user
from app.modules.knowledge.extraction import ExtractionError, extract_text

logger = structlog.get_logger(__name__)
KNOWLEDGE_INDEX_VERSION = "v2"
MIN_RETRIEVAL_RELEVANCE = 0.35
LEXICAL_STOP_WORDS = {
    "a", "after", "all", "along", "and", "are", "as", "at", "before", "by",
    "company", "complete", "details", "explain", "for", "from", "give", "have", "how",
    "in", "information", "is", "joined", "list", "me", "of", "on", "or", "our",
    "please", "tell", "the", "their", "to", "what", "who", "why", "with", "year",
}


def _index_model_name(embedding_model: str) -> str:
    return f"{embedding_model}:{KNOWLEDGE_INDEX_VERSION}"


@dataclass(slots=True)
class TextUnit:
    content: str
    page_number: int | None


def _split_text(text: str, page_number: int | None) -> list[TextUnit]:
    settings = get_settings()
    cleaned = re.sub(r"[ \t]+", " ", text or "")
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    if not cleaned:
        return []
    chunks: list[TextUnit] = []
    start = 0
    while start < len(cleaned):
        end = min(len(cleaned), start + settings.ai_chunk_size)
        if end < len(cleaned):
            boundary = max(cleaned.rfind("\n", start + settings.ai_chunk_size // 2, end), cleaned.rfind(". ", start + settings.ai_chunk_size // 2, end))
            if boundary > start:
                end = boundary + 1
        content = cleaned[start:end].strip()
        if content:
            chunks.append(TextUnit(content, page_number))
        if end >= len(cleaned):
            break
        start = max(start + 1, end - settings.ai_chunk_overlap)
    return chunks


def document_units(document: KnowledgeDocument) -> list[TextUnit]:
    settings = get_settings()
    document_path = Path(settings.upload_storage_path) / document.stored_filename
    if document.original_filename.lower().endswith(".pdf"):
        try:
            reader = PdfReader(document_path)
            units: list[TextUnit] = []
            for page_number, page in enumerate(reader.pages, start=1):
                units.extend(_split_text(page.extract_text() or "", page_number))
            if units:
                return units
        except Exception as error:
            logger.warning("ai.pdf_chunk_fallback", document_id=str(document.id), error_type=type(error).__name__)
    if document.original_filename.lower().endswith(".xlsx"):
        try:
            return _split_text(extract_text(document_path, ".xlsx"), None)
        except ExtractionError as error:
            logger.warning(
                "ai.xlsx_chunk_fallback",
                document_id=str(document.id),
                error_type=type(error).__name__,
            )
    return _split_text(document.extracted_text or "", None)


async def _access_filter(session: AsyncSession, user: User):
    role_keys = await role_keys_for_user(session, user.id)
    if role_keys.intersection({"owner", "super_admin"}):
        return None
    if user.department_id:
        return or_(
            KnowledgeCollection.is_shared.is_(True),
            exists(select(collection_departments.c.collection_id).where(
                collection_departments.c.collection_id == KnowledgeCollection.id,
                collection_departments.c.department_id == user.department_id,
            )),
        )
    return KnowledgeCollection.is_shared.is_(True)


async def index_document(session: AsyncSession, document: KnowledgeDocument, user: User) -> int:
    units = document_units(document)
    if not units:
        return 0
    settings = get_settings()
    started = time.perf_counter()
    vectors: list[list[float]] = []
    input_tokens = 0
    embeddings = OpenAIEmbeddings(settings)
    index_model = _index_model_name(settings.openai_embedding_model)
    for offset in range(0, len(units), 64):
        result = await embeddings.create([unit.content for unit in units[offset:offset + 64]])
        vectors.extend(result.vectors)
        input_tokens += result.input_tokens
    await session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.document_id == document.id))
    for index, (unit, vector) in enumerate(zip(units, vectors, strict=True)):
        session.add(KnowledgeChunk(
            organization_id=document.organization_id,
            collection_id=document.collection_id,
            document_id=document.id,
            chunk_index=index,
            page_number=unit.page_number,
            content=unit.content,
            embedding_model=index_model,
            embedding=vector,
        ))
    latency_ms = int((time.perf_counter() - started) * 1000)
    session.add(AIUsageEvent(
        organization_id=user.organization_id,
        user_id=user.id,
        department_id=user.department_id,
        operation="embedding",
        provider="openai",
        model=settings.openai_embedding_model,
        input_tokens=input_tokens,
        output_tokens=0,
        cost_usd=estimate_cost("openai", settings.openai_embedding_model, input_tokens, 0),
        latency_ms=latency_ms,
        status="completed",
    ))
    await session.flush()
    logger.info("ai.document_indexed", document_id=str(document.id), chunks=len(units), input_tokens=input_tokens, latency_ms=latency_ms)
    return len(units)


async def ensure_permitted_documents_indexed(
    session: AsyncSession,
    user: User,
    collection_ids: list[UUID],
    max_documents: int = 20,
    *,
    question: str = "",
) -> int:
    settings = get_settings()
    index_model = _index_model_name(settings.openai_embedding_model)
    query = select(KnowledgeDocument).join(KnowledgeCollection, KnowledgeCollection.id == KnowledgeDocument.collection_id).where(
        KnowledgeDocument.organization_id == user.organization_id,
        KnowledgeDocument.status == "ready",
        KnowledgeCollection.status == "active",
        ~exists(select(KnowledgeChunk.id).where(
            KnowledgeChunk.document_id == KnowledgeDocument.id,
            KnowledgeChunk.embedding_model == index_model,
        )),
    )
    access = await _access_filter(session, user)
    if access is not None:
        query = query.where(access)
    if collection_ids:
        query = query.where(KnowledgeDocument.collection_id.in_(collection_ids))
    documents = list(await session.scalars(query.order_by(KnowledgeDocument.created_at)))
    if question:
        documents.sort(
            key=lambda document: (_document_lexical_score(question, document), document.created_at),
            reverse=True,
        )
    documents = documents[:max_documents]
    total = 0
    for document in documents:
        total += await index_document(session, document, user)
    if documents:
        await session.commit()
    return total


async def retrieve_chunks(session: AsyncSession, user: User, question: str, collection_ids: list[UUID], limit: int | None = None) -> tuple[list[dict], int]:
    settings = get_settings()
    index_model = _index_model_name(settings.openai_embedding_model)
    started = time.perf_counter()
    embedded = await OpenAIEmbeddings(settings).create([question])
    distance = KnowledgeChunk.embedding.cosine_distance(embedded.vectors[0]).label("distance")
    query = select(KnowledgeChunk, KnowledgeDocument, KnowledgeCollection, distance).join(
        KnowledgeDocument, KnowledgeDocument.id == KnowledgeChunk.document_id,
    ).join(
        KnowledgeCollection, KnowledgeCollection.id == KnowledgeChunk.collection_id,
    ).where(
        KnowledgeChunk.organization_id == user.organization_id,
        KnowledgeChunk.embedding_model == index_model,
        KnowledgeDocument.status == "ready",
        KnowledgeCollection.status == "active",
    )
    access = await _access_filter(session, user)
    if access is not None:
        query = query.where(access)
    if collection_ids:
        query = query.where(KnowledgeChunk.collection_id.in_(collection_ids))
    rows = (await session.execute(query.order_by(distance).limit(limit or settings.ai_retrieval_limit))).all()
    latency_ms = int((time.perf_counter() - started) * 1000)
    results = []
    for chunk, document, collection, raw_distance in rows:
        relevance = max(0.0, min(1.0, 1.0 - float(raw_distance)))
        if relevance < MIN_RETRIEVAL_RELEVANCE:
            continue
        results.append({
            "chunk_id": str(chunk.id),
            "chunk_index": chunk.chunk_index,
            "page": chunk.page_number,
            "content": chunk.content,
            "document_id": str(document.id),
            "document_name": document.original_filename,
            "collection_id": str(collection.id),
            "collection_name": collection.name,
            "relevance": round(relevance, 4),
        })
    session.add(AIUsageEvent(
        organization_id=user.organization_id,
        user_id=user.id,
        department_id=user.department_id,
        operation="embedding",
        provider="openai",
        model=settings.openai_embedding_model,
        input_tokens=embedded.input_tokens,
        output_tokens=0,
        cost_usd=estimate_cost("openai", settings.openai_embedding_model, embedded.input_tokens, 0),
        latency_ms=latency_ms,
        status="completed",
    ))
    await session.commit()
    logger.info("ai.retrieval", user_id=str(user.id), result_count=len(results), latency_ms=latency_ms)
    return results, latency_ms


async def expand_relevant_documents(
    session: AsyncSession,
    user: User,
    seed_chunks: list[dict],
    collection_ids: list[UUID],
    *,
    max_documents: int = 8,
    max_characters: int = 180_000,
) -> list[dict]:
    """Read complete relevant documents for exhaustive/list-style questions.

    Semantic retrieval identifies the likely documents; this second pass restores
    every indexed chunk in document order so names or rows outside the top few
    matches are not silently omitted.
    """
    if not seed_chunks:
        return []
    ranked_document_ids: list[UUID] = []
    for chunk in seed_chunks:
        document_id = UUID(chunk["document_id"])
        if document_id not in ranked_document_ids:
            ranked_document_ids.append(document_id)
        if len(ranked_document_ids) >= max_documents:
            break
    query = select(KnowledgeChunk, KnowledgeDocument, KnowledgeCollection).join(
        KnowledgeDocument, KnowledgeDocument.id == KnowledgeChunk.document_id,
    ).join(
        KnowledgeCollection, KnowledgeCollection.id == KnowledgeChunk.collection_id,
    ).where(
        KnowledgeChunk.organization_id == user.organization_id,
        KnowledgeChunk.document_id.in_(ranked_document_ids),
        KnowledgeDocument.status == "ready",
        KnowledgeCollection.status == "active",
    )
    access = await _access_filter(session, user)
    if access is not None:
        query = query.where(access)
    if collection_ids:
        query = query.where(KnowledgeChunk.collection_id.in_(collection_ids))
    rows = (await session.execute(query.order_by(KnowledgeChunk.document_id, KnowledgeChunk.chunk_index))).all()
    grouped: dict[UUID, dict] = {}
    for chunk, document, collection in rows:
        item = grouped.setdefault(document.id, {
            "chunk_id": str(chunk.id), "chunk_index": 0, "page": None,
            "content_parts": [], "document_id": str(document.id),
            "document_name": document.original_filename, "collection_id": str(collection.id),
            "collection_name": collection.name, "relevance": 1.0,
        })
        item["content_parts"].append(chunk.content)
    expanded: list[dict] = []
    remaining = max_characters
    for document_id in ranked_document_ids:
        item = grouped.get(document_id)
        if not item or remaining <= 0:
            continue
        content = "\n\n".join(item.pop("content_parts"))
        item["content"] = content[:remaining]
        item["truncated"] = len(content) > remaining
        remaining -= len(item["content"])
        expanded.append(item)
    return expanded


def _lexical_terms(question: str) -> set[str]:
    """Return useful, normalized terms for ranking whole internal documents."""
    return {
        term
        for term in re.findall(r"[a-z0-9]+", question.lower())
        if len(term) > 1 and term not in LEXICAL_STOP_WORDS
    }


def _document_lexical_score(question: str, document: KnowledgeDocument) -> tuple[int, int, float]:
    """Rank likely source documents without requiring an embedding index.

    The filename/category are strong signals while content frequency separates a
    roster containing hundreds of employee records from a document that mentions
    an employee only once.
    """
    terms = _lexical_terms(question)
    filename = document.original_filename.lower()
    category = (document.document_category or "").lower()
    content = (document.extracted_text or "").lower()
    matched_terms = sum(term in filename or term in category or term in content for term in terms)
    strong_matches = sum(term in filename or term in category for term in terms)
    frequency = sum(min(content.count(term), 100) for term in terms)
    return strong_matches, matched_terms, float(frequency)


MONTH_NUMBERS = {
    name.lower(): month
    for month, name in enumerate(
        ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"),
        start=1,
    )
}


def _parse_record_date(value: str) -> date | None:
    cleaned = value.strip().split(" 00:00:00", 1)[0]
    for pattern in (
        "%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y",
        "%d %B %Y", "%d %b %Y", "%d-%B-%Y", "%d-%b-%Y",
    ):
        try:
            return datetime.strptime(cleaned, pattern).date()
        except ValueError:
            continue
    return None


def _minus_years(value: date, years: int) -> date:
    try:
        return value.replace(year=value.year - years)
    except ValueError:
        return value.replace(year=value.year - years, day=28)


def apply_structured_employee_filter(question: str, chunks: list[dict], *, as_of: date | None = None) -> list[dict]:
    """Deterministically filter spreadsheet employee records for date/tenure queries."""
    lowered = " ".join(question.lower().split())
    if not re.search(r"\bemployees?\b|\bstaff\b", lowered):
        return chunks
    after_match = re.search(
        r"\bafter\s+(?:(?P<day>\d{1,2})[ /-])?(?P<month>january|february|march|april|may|june|july|august|september|october|november|december)(?:[ ,/-]+(?P<year>20\d{2}))?",
        lowered,
    )
    requested_year = re.search(r"\b(?:in|during|joined in)\s+(20\d{2})\b", lowered)
    tenure = re.search(r"\b(?:completed|complete|served|worked)\s+(?:at least\s+)?(\d+)\s+years?\b", lowered)
    if not after_match and not tenure:
        return chunks
    today = as_of or date.today()
    after_date: date | None = None
    if after_match:
        year = int(after_match.group("year") or (requested_year.group(1) if requested_year else today.year))
        month = MONTH_NUMBERS[after_match.group("month")]
        day = int(after_match.group("day") or 1)
        if not after_match.group("day"):
            day = calendar.monthrange(year, month)[1]
        after_date = date(year, month, day)
    tenure_cutoff = _minus_years(today, int(tenure.group(1))) if tenure else None
    for chunk in chunks:
        lines = (chunk.get("content") or "").splitlines()
        records: list[tuple[str, date]] = []
        for line in lines:
            if not line.lstrip().lower().startswith("record "):
                continue
            fields = _employee_record_fields(line)
            joining_value = _employee_joining_date(fields)
            joined = _parse_record_date(joining_value) if joining_value else None
            if joined:
                records.append((line, joined))
        if not records:
            continue
        matching = [
            line for line, joined in records
            if (after_date is None or joined > after_date)
            and (tenure_cutoff is None or joined <= tenure_cutoff)
            and (requested_year is None or joined.year == int(requested_year.group(1)))
        ]
        chunk["content"] = "\n".join(matching) if matching else "(No employee records matched all requested conditions.)"
        chunk["structured_filter"] = True
        chunk["source_record_count"] = len(records)
        chunk["matching_record_count"] = len(matching)
        chunk["filter_as_of"] = today.isoformat()
        chunk["after_date"] = after_date.isoformat() if after_date else None
        chunk["tenure_cutoff"] = tenure_cutoff.isoformat() if tenure_cutoff else None
        chunk["requested_year"] = int(requested_year.group(1)) if requested_year else None
    return chunks


def _normalized_field_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _employee_record_fields(line: str) -> dict[str, str]:
    content = re.sub(r"^\s*Record\s+\d+\s*:\s*", "", line, flags=re.IGNORECASE)
    fields: dict[str, str] = {}
    for part in content.split("|"):
        if ":" not in part:
            continue
        label, value = part.split(":", 1)
        normalized = _normalized_field_name(label)
        if normalized and value.strip():
            fields[normalized] = value.strip()
    return fields


def _first_employee_field(fields: dict[str, str], aliases: tuple[str, ...]) -> str:
    for alias in aliases:
        if value := fields.get(alias):
            return value
    return ""


def _employee_joining_date(fields: dict[str, str]) -> str:
    exact = _first_employee_field(fields, (
        "date of joining", "joining date", "join date", "date joined", "date of join", "joining dt", "doj",
    ))
    if exact:
        return exact
    for label, value in fields.items():
        if "date of joining" in label or "joining date" in label or re.search(r"\bdoj\b", label):
            return value
    return ""


def _employee_name(fields: dict[str, str]) -> str:
    exact = _first_employee_field(fields, (
        "employee name", "name of employee", "name of the employee", "emp name", "full name",
        "employee name as per aadhaar", "name as per aadhaar", "name",
    ))
    if exact:
        return exact
    for label, value in fields.items():
        if "employee" in label and "name" in label:
            return value
    return ""


def structured_employee_answer(chunks: list[dict]) -> str | None:
    """Render verified employee-filter results without asking a model to rewrite rows."""
    structured = [chunk for chunk in chunks if chunk.get("structured_filter")]
    if not structured:
        return None

    records: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for chunk in structured:
        content = chunk.get("content") or ""
        for line in content.splitlines():
            if not line.lstrip().lower().startswith("record "):
                continue
            fields = _employee_record_fields(line)
            employee_id = _first_employee_field(fields, (
                "employee id", "employee code", "emp id", "emp code", "employee no", "employee number", "id",
            ))
            name = _employee_name(fields)
            joining_date = _employee_joining_date(fields)
            designation = _first_employee_field(fields, ("designation", "job title", "role", "position"))
            department = _first_employee_field(fields, ("department", "dept", "division", "function"))
            if not employee_id and not name:
                continue
            identity = (employee_id.lower(), name.lower(), joining_date.lower())
            if identity in seen:
                continue
            seen.add(identity)
            records.append({
                "employee_id": employee_id,
                "name": name,
                "joining_date": joining_date,
                "designation": designation,
                "department": department,
            })

    metadata = structured[0]
    filter_parts = []
    if metadata.get("after_date"):
        filter_parts.append(f"joined after {metadata['after_date']}")
    if metadata.get("requested_year"):
        filter_parts.append(f"joining year {metadata['requested_year']}")
    if metadata.get("tenure_cutoff"):
        filter_parts.append(f"joined on or before {metadata['tenure_cutoff']} to satisfy tenure")
    if metadata.get("filter_as_of"):
        filter_parts.append(f"evaluated as of {metadata['filter_as_of']}")

    lines = ["Verified employee results"]
    if filter_parts:
        lines.append("Filters applied: " + "; ".join(filter_parts) + ".")
    lines.append("")
    if not records:
        lines.append("No employee records matched all requested conditions.")
        lines.append("")
        lines.append("Total matching employees: 0")
        return "\n".join(lines)

    columns = [
        ("#", "number"),
        ("Employee ID", "employee_id"),
        ("Employee", "name"),
        ("Joining Date", "joining_date"),
        ("Designation", "designation"),
        ("Department", "department"),
    ]
    visible_columns = [
        column for column in columns
        if column[1] == "number" or any(record[column[1]] for record in records)
    ]
    lines.append("| " + " | ".join(label for label, _ in visible_columns) + " |")
    lines.append("| " + " | ".join("---" for _ in visible_columns) + " |")
    for index, record in enumerate(records, start=1):
        values = []
        for _, key in visible_columns:
            value = str(index) if key == "number" else record[key] or "—"
            values.append(value.replace("|", "\\|").replace("\n", " "))
        lines.append("| " + " | ".join(values) + " |")
    lines.append("")
    lines.append(f"Total matching employees: {len(records)}")
    return "\n".join(lines)


async def retrieve_complete_documents(
    session: AsyncSession,
    user: User,
    question: str,
    collection_ids: list[UUID],
    *,
    max_documents: int = 20,
    max_characters: int = 350_000,
) -> list[dict]:
    """Return complete authorized documents for list/filter/aggregate questions.

    Exhaustive questions must not depend on top-k vector chunks: a low-scoring row
    near the end of a spreadsheet is still part of the answer. This path also
    works on the first query immediately after upload, before embeddings exist.
    """
    query = select(KnowledgeDocument, KnowledgeCollection).join(
        KnowledgeCollection, KnowledgeCollection.id == KnowledgeDocument.collection_id,
    ).where(
        KnowledgeDocument.organization_id == user.organization_id,
        KnowledgeDocument.status == "ready",
        KnowledgeCollection.status == "active",
    )
    access = await _access_filter(session, user)
    if access is not None:
        query = query.where(access)
    if collection_ids:
        query = query.where(KnowledgeDocument.collection_id.in_(collection_ids))
    rows = (await session.execute(query)).all()
    ranked = sorted(
        rows,
        key=lambda row: (_document_lexical_score(question, row[0]), row[0].created_at),
        reverse=True,
    )
    positive = [row for row in ranked if _document_lexical_score(question, row[0])[1] > 0]
    candidates = positive or ranked
    selected = candidates[:max_documents]
    results: list[dict] = []
    remaining = max_characters
    for document, collection in selected:
        if remaining <= 0:
            break
        content = document.extracted_text or ""
        excerpt = content[:remaining]
        results.append({
            "chunk_id": f"complete:{document.id}",
            "chunk_index": 0,
            "page": None,
            "content": excerpt,
            "document_id": str(document.id),
            "document_name": document.original_filename,
            "collection_id": str(collection.id),
            "collection_name": collection.name,
            "relevance": 1.0,
            "complete_document": len(excerpt) == len(content),
            "source_characters": len(content),
            "truncated": len(excerpt) != len(content),
        })
        remaining -= len(excerpt)
    included_documents = len(results)
    omitted_documents = max(0, len(candidates) - included_documents)
    for item in results:
        item["relevant_document_candidates"] = len(candidates)
        item["included_documents"] = included_documents
        item["omitted_documents"] = omitted_documents
        item["corpus_truncated"] = omitted_documents > 0 or bool(item["truncated"])
    return results
