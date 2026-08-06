"""Controlled QA for persisted usage graphs and Zoho email draft actions."""

import asyncio
import json
import uuid

import httpx
from sqlalchemy import delete, select

from app.core.security import create_access_token
from app.db.session import SessionLocal
from app.main import app
from app.modules.ai import routes
from app.modules.ai.providers import ProviderEvent
from app.modules.identity.models import AIUsageEvent, Role, User, user_roles


class FakeEmailRouter:
    def __init__(self, *_args, **_kwargs):
        pass

    async def stream(self, *_args, **_kwargs):
        yield ProviderEvent("meta", "qa", "email-draft")
        yield ProviderEvent("delta", "qa", "email-draft", text=json.dumps({
            "to": ["recipient@example.com"], "cc": [], "bcc": [],
            "subject": "R&D trial update", "body": "Hello,\n\nThe R&D trial is ready for review.\n\nRegards,\nAROMAZEN INDIA",
        }))
        yield ProviderEvent("usage", "qa", "email-draft", input_tokens=20, output_tokens=30)


async def main() -> None:
    original_router = routes.AIProviderRouter
    original_rate_limit = routes._rate_limit
    test_user_id = None
    try:
        async with SessionLocal() as session:
            owner = await session.scalar(select(User).join(user_roles, user_roles.c.user_id == User.id).join(Role, Role.id == user_roles.c.role_id).where(Role.key == "owner", User.status == "active").limit(1))
            owner_role = await session.scalar(select(Role).where(Role.organization_id == owner.organization_id, Role.key == "owner"))
            user = User(organization_id=owner.organization_id, email=f"qa-actions-{uuid.uuid4().hex}@example.com", full_name="Temporary Chat Actions QA", password_hash="not-used", status="active")
            session.add(user)
            await session.flush()
            await session.execute(user_roles.insert().values(user_id=user.id, role_id=owner_role.id))
            await session.commit()
            test_user_id = user.id
            token = create_access_token(str(user.id), str(user.organization_id), ["owner"])

        async def no_rate_limit(*_args, **_kwargs):
            return None
        routes._rate_limit = no_rate_limit
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://qa") as client:
            headers = {"Authorization": f"Bearer {token}"}
            usage = await client.post("/api/v1/workspace/messages/stream", headers=headers, json={"content": "Show overall API usage till now in a graph", "collection_ids": []})
            assert usage.status_code == 200 and "event: usage_chart" in usage.text and "event: done" in usage.text
            conversation_id = json.loads(next(line[5:] for line in usage.text.splitlines() if line.startswith("data:") and "conversation_id" in line))["conversation_id"]

            routes.AIProviderRouter = FakeEmailRouter
            email = await client.post("/api/v1/workspace/messages/stream", headers=headers, json={"content": "Send an email to recipient@example.com about the R&D trial", "conversation_id": conversation_id, "collection_ids": [], "mode": "email"})
            assert email.status_code == 200 and "event: email_draft" in email.text and "recipient@example.com" in email.text
            history = await client.get(f"/api/v1/workspace/conversations/{conversation_id}/messages", headers=headers)
            history.raise_for_status()
            artifacts = [item.get("artifacts", {}) for item in history.json()]
            assert any("usage" in item for item in artifacts) and any("email" in item for item in artifacts)
            print("chat_actions_qa=passed")
    finally:
        routes.AIProviderRouter = original_router
        routes._rate_limit = original_rate_limit
        if test_user_id:
            async with SessionLocal() as session:
                await session.execute(delete(AIUsageEvent).where(AIUsageEvent.user_id == test_user_id))
                user = await session.get(User, test_user_id)
                if user:
                    await session.delete(user)
                    await session.commit()


if __name__ == "__main__":
    asyncio.run(main())
