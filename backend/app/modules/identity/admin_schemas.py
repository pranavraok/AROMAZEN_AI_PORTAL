from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class DepartmentResponse(BaseModel):
    id: str
    name: str
    slug: str


class CreateDepartmentRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)


class RoleResponse(BaseModel):
    id: str
    key: str
    name: str
    description: str | None
    permission_keys: list[str]


class AdminUserResponse(BaseModel):
    id: str
    full_name: str
    email: EmailStr
    phone_number: str | None
    status: str
    department: DepartmentResponse | None
    roles: list[RoleResponse]
    last_login_at: datetime | None
    created_at: datetime


class InviteUserRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=160)
    email: EmailStr
    phone_number: str | None = Field(default=None, min_length=7, max_length=32)
    department_id: str | None = None
    role_ids: list[str] = Field(min_length=1, max_length=4)


class InvitationResponse(BaseModel):
    user: AdminUserResponse
    invitation_token: str
    expires_at: datetime


class UpdateUserRequest(BaseModel):
    department_id: str | None = None
    role_ids: list[str] | None = Field(default=None, min_length=1, max_length=4)
    status: str | None = Field(default=None, pattern="^(active|disabled)$")


class AcceptInvitationRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=12, max_length=1024)


class AuditEventResponse(BaseModel):
    id: str
    action: str
    target_type: str
    target_id: str | None
    metadata: dict
    created_at: datetime
