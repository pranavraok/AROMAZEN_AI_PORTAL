from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=1024)
    remember_me: bool = False


class CurrentUserResponse(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    department_name: str | None = None
    role_names: list[str]
    permission_keys: list[str]
    status: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: CurrentUserResponse
