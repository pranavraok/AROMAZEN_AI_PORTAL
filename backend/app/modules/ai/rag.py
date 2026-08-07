import re
import time
from dataclasses import dataclass
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


async def ensure_permitted_documents_indexed(session: AsyncSession, user: User, collection_ids: list[UUID]) -> int:
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
    documents = list(await session.scalars(query.order_by(KnowledgeDocument.created_at).limit(20)))
    total = 0
    for document in documents:
        total += await index_document(session, document, user)
    if documents:
        await session.commit()
    return total


async def retrieve_chunks(session: AsyncSession, user: User, question: str, collection_ids: list[UUID]) -> tuple[list[dict], int]:
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
    rows = (await session.execute(query.order_by(distance).limit(settings.ai_retrieval_limit))).all()
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
