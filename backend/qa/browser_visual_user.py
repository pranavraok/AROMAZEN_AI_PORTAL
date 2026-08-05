"""Create or remove the tightly scoped temporary user used for local visual QA."""

import asyncio
import sys

from sqlalchemy import delete, select

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.modules.identity.models import Department, Role, User, user_roles


EMAIL = "qa-browser-rd@aromazen.com"
PASSWORD = "QAVisual2026!"


async def main() -> None:
    async with SessionLocal() as session:
        existing = await session.scalar(select(User).where(User.email == EMAIL))
        if sys.argv[1:] == ["delete"]:
            if existing:
                await session.delete(existing)
                await session.commit()
            print("removed")
            return

        if existing:
            existing.password_hash = hash_password(PASSWORD)
            existing.status = "active"
            user = existing
        else:
            department = await session.scalar(select(Department).where(Department.name == "R&D"))
            role = await session.scalar(select(Role).where(Role.key == "employee"))
            if not department or not role:
                raise RuntimeError("R&D department or employee role is missing")
            user = User(
                organization_id=department.organization_id,
                department_id=department.id,
                email=EMAIL,
                full_name="Temporary R&D Visual QA",
                password_hash=hash_password(PASSWORD),
                status="active",
            )
            session.add(user)
            await session.flush()
            await session.execute(user_roles.insert().values(user_id=user.id, role_id=role.id))
        await session.commit()
        print(EMAIL)


if __name__ == "__main__":
    asyncio.run(main())
