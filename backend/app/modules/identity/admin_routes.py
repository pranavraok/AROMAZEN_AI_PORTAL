from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, hash_refresh_token, new_refresh_token
from app.db.session import get_db_session
from app.modules.identity.admin_schemas import (
    AcceptInvitationRequest, AdminUserResponse, AuditEventResponse, CreateDepartmentRequest,
    DepartmentResponse, InvitationResponse, InviteUserRequest, RoleResponse, UpdateUserRequest,
)
from app.modules.identity.authorization import require_permissions
from app.modules.identity.models import AuditEvent, Department, Invitation, Permission, Role, User, role_permissions, user_roles

router = APIRouter()


async def serialize_role(session: AsyncSession, role: Role) -> RoleResponse:
    permissions = await session.scalars(select(Permission.key).join(role_permissions, Permission.id == role_permissions.c.permission_id).where(role_permissions.c.role_id == role.id))
    return RoleResponse(id=str(role.id), key=role.key, name=role.name, description=role.description, permission_keys=list(permissions))


async def serialize_user(session: AsyncSession, user: User) -> AdminUserResponse:
    department = await session.get(Department, user.department_id) if user.department_id else None
    roles = list(await session.scalars(select(Role).join(user_roles, Role.id == user_roles.c.role_id).where(user_roles.c.user_id == user.id)))
    return AdminUserResponse(
        id=str(user.id), full_name=user.full_name, email=user.email, phone_number=user.phone_number, status=user.status,
        department=DepartmentResponse(id=str(department.id), name=department.name, slug=department.slug) if department else None,
        roles=[await serialize_role(session, role) for role in roles], last_login_at=user.last_login_at, created_at=user.created_at,
    )


def slugify(value: str) -> str:
    return "-".join("".join(character.lower() if character.isalnum() else " " for character in value).split())


async def roles_for_request(session: AsyncSession, organization_id, role_ids: list[str]) -> list[Role]:
    roles = list(await session.scalars(select(Role).where(Role.organization_id == organization_id, Role.id.in_(role_ids))))
    if len(roles) != len(set(role_ids)):
        raise HTTPException(status_code=422, detail="One or more selected roles are invalid.")
    return roles


@router.get("/departments", response_model=list[DepartmentResponse])
async def list_departments(user: User = Depends(require_permissions("users.manage")), session: AsyncSession = Depends(get_db_session)) -> list[DepartmentResponse]:
    departments = await session.scalars(select(Department).where(Department.organization_id == user.organization_id).order_by(Department.name))
    return [DepartmentResponse(id=str(item.id), name=item.name, slug=item.slug) for item in departments]


@router.post("/departments", response_model=DepartmentResponse, status_code=status.HTTP_201_CREATED)
async def create_department(payload: CreateDepartmentRequest, user: User = Depends(require_permissions("users.manage")), session: AsyncSession = Depends(get_db_session)) -> DepartmentResponse:
    slug = slugify(payload.name)
    if not slug:
        raise HTTPException(status_code=422, detail="Department name must contain letters or numbers.")
    exists = await session.scalar(select(Department.id).where(Department.organization_id == user.organization_id, Department.slug == slug))
    if exists:
        raise HTTPException(status_code=409, detail="A department with this name already exists.")
    department = Department(organization_id=user.organization_id, name=payload.name.strip(), slug=slug)
    session.add(department)
    session.add(AuditEvent(organization_id=user.organization_id, actor_user_id=user.id, action="identity.department_created", target_type="department", metadata_json={"name": department.name}))
    await session.commit()
    return DepartmentResponse(id=str(department.id), name=department.name, slug=department.slug)


@router.get("/roles", response_model=list[RoleResponse])
async def list_roles(user: User = Depends(require_permissions("users.manage")), session: AsyncSession = Depends(get_db_session)) -> list[RoleResponse]:
    roles = await session.scalars(select(Role).where(Role.organization_id == user.organization_id).order_by(Role.name))
    return [await serialize_role(session, role) for role in roles]


@router.get("/users", response_model=list[AdminUserResponse])
async def list_users(user: User = Depends(require_permissions("users.manage")), session: AsyncSession = Depends(get_db_session)) -> list[AdminUserResponse]:
    users = await session.scalars(select(User).where(User.organization_id == user.organization_id).order_by(User.created_at.desc()))
    return [await serialize_user(session, item) for item in users]


@router.post("/users/invitations", response_model=InvitationResponse, status_code=status.HTTP_201_CREATED)
async def invite_user(payload: InviteUserRequest, actor: User = Depends(require_permissions("users.manage")), session: AsyncSession = Depends(get_db_session)) -> InvitationResponse:
    email = payload.email.lower()
    phone_number = payload.phone_number.strip() if payload.phone_number else None
    matching_email = await session.scalar(select(User).where(User.organization_id == actor.organization_id, User.email == email, User.phone_number == phone_number if phone_number else User.phone_number.is_(None)))
    if matching_email:
        raise HTTPException(status_code=409, detail="An account with this email and phone combination already exists.")
    if not phone_number and await session.scalar(select(User.id).where(User.organization_id == actor.organization_id, User.email == email)):
        raise HTTPException(status_code=422, detail="This email is already used. Add the employee's unique phone number to create a separate account.")
    if phone_number and await session.scalar(select(User.id).where(User.phone_number == phone_number)):
        raise HTTPException(status_code=409, detail="This phone number is already assigned to another account.")
    if payload.department_id:
        department = await session.get(Department, payload.department_id)
        if not department or department.organization_id != actor.organization_id:
            raise HTTPException(status_code=422, detail="Selected department is invalid.")
    roles = await roles_for_request(session, actor.organization_id, payload.role_ids)
    new_user = User(organization_id=actor.organization_id, department_id=payload.department_id, full_name=payload.full_name.strip(), email=email, phone_number=phone_number, password_hash=hash_password(new_refresh_token()), status="invited")
    session.add(new_user)
    await session.flush()
    await session.execute(user_roles.insert(), [{"user_id": new_user.id, "role_id": role.id} for role in roles])
    raw_token = new_refresh_token()
    invitation = Invitation(organization_id=actor.organization_id, user_id=new_user.id, token_hash=hash_refresh_token(raw_token), expires_at=datetime.now(timezone.utc) + timedelta(days=7))
    session.add(invitation)
    session.add(AuditEvent(organization_id=actor.organization_id, actor_user_id=actor.id, action="identity.user_invited", target_type="user", target_id=str(new_user.id), metadata_json={"email": new_user.email, "role_ids": payload.role_ids}))
    await session.commit()
    return InvitationResponse(user=await serialize_user(session, new_user), invitation_token=raw_token, expires_at=invitation.expires_at)


@router.patch("/users/{user_id}", response_model=AdminUserResponse)
async def update_user(user_id: str, payload: UpdateUserRequest, actor: User = Depends(require_permissions("users.manage")), session: AsyncSession = Depends(get_db_session)) -> AdminUserResponse:
    target = await session.get(User, user_id)
    if not target or target.organization_id != actor.organization_id:
        raise HTTPException(status_code=404, detail="User not found.")
    if target.id == actor.id and payload.status == "disabled":
        raise HTTPException(status_code=422, detail="You cannot disable your own account.")
    if payload.department_id is not None:
        department = await session.get(Department, payload.department_id)
        if not department or department.organization_id != actor.organization_id:
            raise HTTPException(status_code=422, detail="Selected department is invalid.")
        target.department_id = department.id
    if payload.role_ids is not None:
        roles = await roles_for_request(session, actor.organization_id, payload.role_ids)
        await session.execute(delete(user_roles).where(user_roles.c.user_id == target.id))
        await session.execute(user_roles.insert(), [{"user_id": target.id, "role_id": role.id} for role in roles])
    if payload.status is not None:
        target.status = payload.status
    session.add(AuditEvent(organization_id=actor.organization_id, actor_user_id=actor.id, action="identity.user_updated", target_type="user", target_id=str(target.id), metadata_json=payload.model_dump(exclude_none=True)))
    await session.commit()
    return await serialize_user(session, target)


@router.post("/invitations/{token}/accept", status_code=status.HTTP_204_NO_CONTENT)
async def accept_invitation(token: str, payload: AcceptInvitationRequest, session: AsyncSession = Depends(get_db_session)) -> None:
    invitation = await session.scalar(select(Invitation).where(Invitation.token_hash == hash_refresh_token(token), Invitation.accepted_at.is_(None)))
    if not invitation or invitation.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=404, detail="Invitation is invalid or expired.")
    user = await session.get(User, invitation.user_id)
    if not user or user.status != "invited":
        raise HTTPException(status_code=409, detail="Invitation cannot be accepted.")
    user.full_name = payload.full_name.strip()
    user.password_hash = hash_password(payload.password)
    user.status = "active"
    invitation.accepted_at = datetime.now(timezone.utc)
    session.add(AuditEvent(organization_id=invitation.organization_id, actor_user_id=user.id, action="identity.invitation_accepted", target_type="user", target_id=str(user.id), metadata_json={"email": user.email}))
    await session.commit()


@router.get("/audit-events", response_model=list[AuditEventResponse])
async def list_audit_events(user: User = Depends(require_permissions("users.manage")), session: AsyncSession = Depends(get_db_session)) -> list[AuditEventResponse]:
    events = await session.scalars(select(AuditEvent).where(AuditEvent.organization_id == user.organization_id).order_by(AuditEvent.created_at.desc()).limit(100))
    return [AuditEventResponse(id=str(item.id), action=item.action, target_type=item.target_type, target_id=item.target_id, metadata=item.metadata_json, created_at=item.created_at) for item in events]
