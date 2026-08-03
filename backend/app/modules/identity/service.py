from datetime import datetime, timedelta, timezone

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password, hash_refresh_token
from app.modules.identity.models import AuditEvent, Organization, Permission, RefreshSession, Role, User, role_permissions, user_roles

DEFAULT_PERMISSIONS = [
    ("platform.manage", "Manage platform"),
    ("users.manage", "Manage users"),
    ("roles.manage", "Manage roles"),
    ("knowledge.read", "Read knowledge"),
    ("knowledge.write", "Manage knowledge"),
    ("ai.workspace.use", "Use AI workspace"),
    ("usage.read", "Read usage"),
]
DEFAULT_ROLES = [
    ("owner", "Owner", "Full platform control"),
    ("super_admin", "Super Admin", "Organization administration"),
    ("department_admin", "Department Admin", "Department administration"),
    ("employee", "Employee", "Standard employee access"),
]


async def role_names_for_user(session: AsyncSession, user_id) -> list[str]:
    result = await session.scalars(select(Role.name).join(user_roles, Role.id == user_roles.c.role_id).where(user_roles.c.user_id == user_id))
    return list(result)


async def permission_keys_for_user(session: AsyncSession, user_id) -> list[str]:
    result = await session.scalars(
        select(Permission.key)
        .join(role_permissions, Permission.id == role_permissions.c.permission_id)
        .join(user_roles, user_roles.c.role_id == role_permissions.c.role_id)
        .where(user_roles.c.user_id == user_id)
        .distinct()
    )
    return list(result)


async def create_refresh_session(session: AsyncSession, user_id, raw_token: str) -> RefreshSession:
    settings = get_settings()
    refresh_session = RefreshSession(user_id=user_id, token_hash=hash_refresh_token(raw_token), expires_at=datetime.now(timezone.utc) + timedelta(days=settings.jwt_refresh_token_days))
    session.add(refresh_session)
    return refresh_session


async def bootstrap_owner(session: AsyncSession) -> None:
    settings = get_settings()
    if not settings.bootstrap_owner_email or not settings.bootstrap_owner_password:
        return

    existing_owner = await session.scalar(select(User.id).limit(1))
    if existing_owner:
        return

    organization = Organization(name="AROMAZEN INDIA", slug="aromazen-india")
    session.add(organization)
    await session.flush()

    permissions = [Permission(key=key, name=name) for key, name in DEFAULT_PERMISSIONS]
    session.add_all(permissions)
    await session.flush()
    owner_role = None
    for key, name, description in DEFAULT_ROLES:
        role = Role(organization_id=organization.id, key=key, name=name, description=description)
        session.add(role)
        await session.flush()
        if key == "owner":
            owner_role = role
            await session.execute(insert(role_permissions), [{"role_id": role.id, "permission_id": permission.id} for permission in permissions])

    owner = User(organization_id=organization.id, email=settings.bootstrap_owner_email.lower(), full_name=settings.bootstrap_owner_name, password_hash=hash_password(settings.bootstrap_owner_password), status="active")
    session.add(owner)
    await session.flush()
    await session.execute(insert(user_roles).values(user_id=owner.id, role_id=owner_role.id))
    session.add(AuditEvent(organization_id=organization.id, actor_user_id=owner.id, action="identity.owner_bootstrapped", target_type="user", target_id=str(owner.id), metadata_json={"email": owner.email}))
    await session.commit()
