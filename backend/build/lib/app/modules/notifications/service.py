from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.identity.models import (
    KnowledgeCollection,
    KnowledgeDocument,
    PortalNotification,
    User,
    collection_departments,
)
from app.modules.identity.service import permission_keys_for_user, role_keys_for_user


async def create_knowledge_upload_notifications(
    session: AsyncSession,
    *,
    document: KnowledgeDocument,
    collection: KnowledgeCollection,
    actor: User,
) -> int:
    """Notify every active user who can read the uploaded document's collection."""
    department_ids = set(await session.scalars(
        select(collection_departments.c.department_id).where(
            collection_departments.c.collection_id == collection.id
        )
    ))
    recipients = list(await session.scalars(
        select(User).where(
            User.organization_id == actor.organization_id,
            User.status == "active",
        )
    ))
    created = 0
    for recipient in recipients:
        permissions = set(await permission_keys_for_user(session, recipient.id))
        if "knowledge.read" not in permissions:
            continue
        roles = await role_keys_for_user(session, recipient.id)
        has_collection_access = (
            bool(roles.intersection({"owner", "super_admin"}))
            or collection.is_shared
            or recipient.department_id in department_ids
        )
        if not has_collection_access:
            continue
        dedupe_key = f"knowledge-document:{document.id}"
        result = await session.execute(pg_insert(PortalNotification).values(
            organization_id=actor.organization_id,
            user_id=recipient.id,
            kind="knowledge_document_added",
            title="New knowledge document added",
            message=f"{actor.full_name} added {document.original_filename} to {collection.name}.",
            severity="info",
            href=f"/knowledge/{collection.slug}",
            dedupe_key=dedupe_key,
        ).on_conflict_do_nothing(
            constraint="uq_portal_notifications_user_dedupe"
        ))
        created += result.rowcount or 0
    return created


async def sync_live_notifications(
    session: AsyncSession,
    *,
    user: User,
    alerts: Iterable[dict],
) -> None:
    """Persist calculated alerts without resetting an existing read state."""
    alerts = list(alerts)
    for alert in alerts:
        dedupe_key = f"live:{alert['id']}"
        statement = pg_insert(PortalNotification).values(
            organization_id=user.organization_id,
            user_id=user.id,
            dedupe_key=dedupe_key,
            kind=alert.get("kind", "usage"),
            title=alert["title"],
            message=alert["message"],
            severity=alert.get("severity", "warning"),
            href=alert.get("href"),
        )
        await session.execute(statement.on_conflict_do_update(
            constraint="uq_portal_notifications_user_dedupe",
            set_={
                "kind": statement.excluded.kind,
                "title": statement.excluded.title,
                "message": statement.excluded.message,
                "severity": statement.excluded.severity,
                "href": statement.excluded.href,
            },
        ))


def notification_response(item: PortalNotification) -> dict:
    return {
        "id": str(item.id),
        "kind": item.kind,
        "title": item.title,
        "message": item.message,
        "severity": item.severity,
        "href": item.href,
        "is_read": item.read_at is not None,
        "read_at": item.read_at.isoformat() if item.read_at else None,
        "created_at": item.created_at.isoformat(),
    }
