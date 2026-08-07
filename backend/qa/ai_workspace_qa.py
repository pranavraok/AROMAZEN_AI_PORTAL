"""Controlled local QA for the AI workspace. Uses fake provider output; never sends documents externally."""

import asyncio
import json
import statistics
import time
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import jwt
from fastapi import HTTPException
from redis.asyncio import Redis
from sqlalchemy import delete, select, text

from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.session import SessionLocal
from app.main import app
from app.modules.ai import rag, routes
from app.modules.ai.providers import AIProviderRouter, EmbeddingResult, ProviderError, ProviderEvent
from app.modules.identity.models import (
    AIConversation,
    AIUsageEvent,
    KnowledgeChunk,
    KnowledgeCollection,
    KnowledgeDocument,
    Role,
    User,
    collection_departments,
    role_permissions,
    user_roles,
)


class FakeEmbeddings:
    def __init__(self, *args, **kwargs):
        pass

    async def create(self, texts: list[str]) -> EmbeddingResult:
        return EmbeddingResult(vectors=[[0.01] * 1536 for _ in texts], input_tokens=sum(max(1, len(text) // 4) for text in texts))


class FakeRouter:
    async def stream(self, system: str, prompt: str, question: str):
        yield ProviderEvent("meta", "qa", "mock-stream")
        for text in ("Safe ", "mock ", "answer."):
            await asyncio.sleep(0.015)
            yield ProviderEvent("delta", "qa", "mock-stream", text=text)
        yield ProviderEvent("usage", "qa", "mock-stream", input_tokens=20, output_tokens=4)


class Always429:
    name = "qa-primary"
    model = "rate-limited"
    calls = 0

    async def stream(self, system: str, prompt: str):
        self.calls += 1
        if False:
            yield ProviderEvent("delta", self.name, self.model)
        raise ProviderError(self.name, "http_429", "simulated", retryable=True)


class FallbackSuccess:
    name = "qa-fallback"
    model = "fallback"

    async def stream(self, system: str, prompt: str):
        yield ProviderEvent("meta", self.name, self.model)
        yield ProviderEvent("delta", self.name, self.model, text="fallback-ok")
        yield ProviderEvent("usage", self.name, self.model, input_tokens=1, output_tokens=1)


class AlwaysTimeout(Always429):
    name = "qa-timeout"
    model = "timed-out"

    async def stream(self, system: str, prompt: str):
        self.calls += 1
        if False:
            yield ProviderEvent("delta", self.name, self.model)
        raise ProviderError(self.name, "network_timeout", "simulated", retryable=True)


async def main() -> None:
    settings = get_settings()
    original_router = routes.AIProviderRouter
    original_embeddings = rag.OpenAIEmbeddings
    original_rate_limit = routes._rate_limit
    collection_id = None
    test_user_id = None
    conversation_ids: list[uuid.UUID] = []
    redis = Redis.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
    try:
        async with SessionLocal() as session:
            owner = await session.scalar(select(User).join(user_roles, user_roles.c.user_id == User.id).join(Role, Role.id == user_roles.c.role_id).where(Role.key == "owner", User.status == "active").limit(1))
            owner_role = await session.scalar(select(Role).where(Role.key == "owner"))
            test_user = User(
                organization_id=owner.organization_id,
                department_id=None,
                email=f"qa-load-{uuid.uuid4().hex}@example.invalid",
                phone_number=None,
                full_name="Temporary QA Load User",
                password_hash="not-used",
                status="active",
            )
            session.add(test_user)
            await session.flush()
            await session.execute(user_roles.insert().values(user_id=test_user.id, role_id=owner_role.id))
            test_user_id = test_user.id
            collection = KnowledgeCollection(
                organization_id=owner.organization_id,
                name="QA Synthetic Empty Collection",
                slug="qa-synthetic-" + uuid.uuid4().hex,
                description="Temporary non-confidential load-test fixture.",
                is_shared=True,
                status="active",
                created_by_user_id=owner.id,
            )
            session.add(collection)
            await session.flush()
            document = KnowledgeDocument(
                organization_id=owner.organization_id,
                collection_id=collection.id,
                uploaded_by_user_id=owner.id,
                original_filename="qa-synthetic-long-document.docx",
                stored_filename="qa-synthetic-" + uuid.uuid4().hex + ".docx",
                mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                size_bytes=100_000,
                version=1,
                status="ready",
                extracted_text="Synthetic non-confidential load-test content.",
                extracted_characters=240_000,
            )
            session.add(document)
            await session.flush()
            for chunk_index in range(200):
                session.add(KnowledgeChunk(
                    organization_id=owner.organization_id,
                    collection_id=collection.id,
                    document_id=document.id,
                    chunk_index=chunk_index,
                    page_number=(chunk_index // 4) + 1,
                    content=f"Synthetic safe chunk {chunk_index}. Fictional simultaneous-search test content only.",
                    embedding_model=rag._index_model_name(settings.openai_embedding_model),
                    embedding=[0.01] * 1536,
                ))
            await session.commit()
            collection_id = collection.id
            owner_token = create_access_token(str(test_user.id), str(test_user.organization_id), ["Owner"])

        routes.AIProviderRouter = FakeRouter
        rag.OpenAIEmbeddings = FakeEmbeddings

        async def no_rate_limit(request, user):
            return None

        routes._rate_limit = no_rate_limit
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://qa") as client:
            async def one_request(index: int) -> tuple[float, bool, str | None]:
                started = time.perf_counter()
                response = await client.post(
                    "/api/v1/workspace/messages/stream",
                    headers={"Authorization": f"Bearer {owner_token}"},
                    json={"content": f"QA concurrent request {index}", "collection_ids": [str(collection_id)]},
                )
                elapsed = (time.perf_counter() - started) * 1000
                conversation = None
                done = False
                citations = 0
                for block in response.text.split("\n\n"):
                    if "data:" not in block:
                        continue
                    data = json.loads(next(line[5:].strip() for line in block.splitlines() if line.startswith("data:")))
                    if block.startswith("event: start"):
                        conversation = data.get("conversation_id")
                    if block.startswith("event: done"):
                        done = True
                    if block.startswith("event: citations"):
                        citations = len(data.get("citations") or [])
                return elapsed, response.status_code == 200 and done and citations == settings.ai_retrieval_limit, conversation

            results = await asyncio.gather(*(one_request(index) for index in range(25)))
            latencies = [result[0] for result in results]
            conversation_ids = [uuid.UUID(result[2]) for result in results if result[2]]
            sorted_latencies = sorted(latencies)
            p50 = statistics.median(sorted_latencies)
            p95 = sorted_latencies[max(0, int(len(sorted_latencies) * 0.95) - 1)]
            failures = sum(not result[1] for result in results)
            print(f"CONCURRENCY_USERS=25")
            print(f"CONCURRENCY_P50_MS={p50:.1f}")
            print(f"CONCURRENCY_P95_MS={p95:.1f}")
            print(f"CONCURRENCY_FAILURES={failures}")

            expired_payload = {
                "sub": str(test_user.id), "org": str(test_user.organization_id), "roles": ["Owner"],
                "iat": datetime.now(timezone.utc) - timedelta(minutes=20),
                "exp": datetime.now(timezone.utc) - timedelta(minutes=5), "type": "access",
            }
            expired = jwt.encode(expired_payload, settings.jwt_secret_key, algorithm="HS256")
            expired_response = await client.post("/api/v1/workspace/messages/stream", headers={"Authorization": f"Bearer {expired}"}, json={"content": "QA expired", "collection_ids": []})
            print(f"EXPIRED_SESSION_STATUS={expired_response.status_code}")

            async with SessionLocal() as session:
                blocked_ids = (await session.execute(text("""
                    select u.id as user_id, c.id as collection_id
                    from users u
                    join knowledge_collections c on c.organization_id=u.organization_id and c.is_shared=false and c.status='active'
                    where u.status='active' and u.department_id is not null
                      and exists (
                        select 1 from user_roles ur join roles r on r.id=ur.role_id
                        join role_permissions rp on rp.role_id=r.id
                        join permissions p on p.id=rp.permission_id
                        where ur.user_id=u.id and p.key='ai.workspace.use'
                      )
                      and not exists (
                        select 1 from user_roles ur join roles r on r.id=ur.role_id
                        where ur.user_id=u.id and r.key in ('owner','super_admin')
                      )
                      and not exists (
                        select 1 from collection_departments cd
                        where cd.collection_id=c.id and cd.department_id=u.department_id
                      )
                    limit 1
                """))).mappings().first()
                blocked_user = await session.get(User, blocked_ids["user_id"]) if blocked_ids else None
                restricted = await session.get(KnowledgeCollection, blocked_ids["collection_id"]) if blocked_ids else None
            if blocked_user and restricted:
                blocked_token = create_access_token(str(blocked_user.id), str(blocked_user.organization_id), ["Employee"])
                denied = await client.post("/api/v1/workspace/messages/stream", headers={"Authorization": f"Bearer {blocked_token}"}, json={"content": "QA denied", "collection_ids": [str(restricted.id)]})
                print(f"AI_CROSS_DEPARTMENT_STATUS={denied.status_code}")
            else:
                print("AI_CROSS_DEPARTMENT_STATUS=skipped")

        routes._rate_limit = original_rate_limit
        await redis.delete(f"ai:rate:{test_user.id}")
        dummy_request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(redis=redis)))
        limited = None
        for _ in range(settings.ai_rate_limit_per_minute + 1):
            try:
                await routes._rate_limit(dummy_request, test_user)
            except HTTPException as error:
                limited = error.status_code
        print(f"RATE_LIMIT_STATUS={limited}")
        await redis.delete(f"ai:rate:{test_user.id}")

        failing = Always429()
        fallback = FallbackSuccess()
        router = AIProviderRouter(settings)
        router._providers = lambda question: [failing, fallback]
        events = [event async for event in router.stream("system", "prompt", "question")]
        print(f"SIMULATED_429_RETRIES={failing.calls}")
        print(f"SIMULATED_FALLBACK_OK={any(event.kind == 'delta' and event.text == 'fallback-ok' for event in events)}")
        timed_out = AlwaysTimeout()
        router._providers = lambda question: [timed_out, fallback]
        timeout_events = [event async for event in router.stream("system", "prompt", "question")]
        print(f"SIMULATED_TIMEOUT_RETRIES={timed_out.calls}")
        print(f"SIMULATED_TIMEOUT_FALLBACK_OK={any(event.kind == 'delta' and event.text == 'fallback-ok' for event in timeout_events)}")
    finally:
        routes.AIProviderRouter = original_router
        rag.OpenAIEmbeddings = original_embeddings
        routes._rate_limit = original_rate_limit
        await redis.aclose()
        async with SessionLocal() as session:
            if test_user_id:
                await session.execute(delete(AIUsageEvent).where(AIUsageEvent.user_id == test_user_id))
                await session.execute(delete(User).where(User.id == test_user_id))
            if collection_id:
                await session.execute(delete(KnowledgeCollection).where(KnowledgeCollection.id == collection_id))
            await session.commit()
        print("QA_TEMPORARY_DATA_REMOVED=yes")


if __name__ == "__main__":
    asyncio.run(main())
