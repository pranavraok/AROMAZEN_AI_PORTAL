from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.modules.identity.models import Department, User
from app.modules.identity.routes import get_current_user
from app.modules.identity.service import permission_keys_for_user, role_keys_for_user


def require_permissions(*required_permissions: str) -> Callable:
    """Dependency for API routes that require every listed permission."""

    async def dependency(
        user: User = Depends(get_current_user),
        session: AsyncSession = Depends(get_db_session),
    ) -> User:
        granted_permissions = set(await permission_keys_for_user(session, user.id))
        if not set(required_permissions).issubset(granted_permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action.",
            )
        return user

    return dependency


def require_department(department_slug: str) -> Callable:
    """Restrict a module to one department, while allowing platform admins."""

    async def dependency(
        user: User = Depends(get_current_user),
        session: AsyncSession = Depends(get_db_session),
    ) -> User:
        role_keys = await role_keys_for_user(session, user.id)
        if role_keys.intersection({"owner", "super_admin"}):
            return user

        department = await session.get(Department, user.department_id) if user.department_id else None
        if not department or department.slug != department_slug:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This tool is restricted to another department.",
            )
        return user

    return dependency
