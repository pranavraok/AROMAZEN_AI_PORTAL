from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, decode_access_token, hash_refresh_token, new_refresh_token, verify_password
from app.db.session import get_db_session
from app.modules.identity.models import RefreshSession, User
from app.modules.identity.schemas import AuthResponse, CurrentUserResponse, LoginRequest
from app.modules.identity.service import create_refresh_session, permission_keys_for_user, role_names_for_user

router = APIRouter()
bearer_scheme = HTTPBearer(auto_error=False)


async def to_current_user_response(session: AsyncSession, user: User) -> CurrentUserResponse:
    return CurrentUserResponse(
        id=str(user.id), email=user.email, full_name=user.full_name, department_name=None,
        role_names=await role_names_for_user(session, user.id),
        permission_keys=await permission_keys_for_user(session, user.id), status=user.status,
    )


async def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme), session: AsyncSession = Depends(get_db_session)) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication is required.")
    try:
        payload = decode_access_token(credentials.credentials)
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired access token.") from error
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type.")
    user = await session.get(User, payload.get("sub"))
    if not user or user.status != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is not active.")
    return user


def set_refresh_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(key="refresh_token", value=token, max_age=settings.jwt_refresh_token_days * 24 * 60 * 60, httponly=True, secure=settings.cookie_secure, samesite="lax", path=f"{settings.api_v1_prefix}/auth")


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, response: Response, session: AsyncSession = Depends(get_db_session)) -> AuthResponse:
    user_query = select(User).where(User.email == payload.email.lower())
    user_query = user_query.where(User.phone_number == payload.phone_number.strip() if payload.phone_number else User.phone_number.is_(None))
    user = await session.scalar(user_query)
    if not user or user.status != "active" or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")
    roles = await role_names_for_user(session, user.id)
    refresh_token = new_refresh_token()
    await create_refresh_session(session, user.id, refresh_token)
    user.last_login_at = datetime.now(timezone.utc)
    await session.commit()
    set_refresh_cookie(response, refresh_token)
    return AuthResponse(access_token=create_access_token(str(user.id), str(user.organization_id), roles), user=await to_current_user_response(session, user))


@router.post("/refresh", response_model=AuthResponse)
async def refresh(request: Request, response: Response, session: AsyncSession = Depends(get_db_session)) -> AuthResponse:
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token is required.")
    refresh_session = await session.scalar(select(RefreshSession).where(RefreshSession.token_hash == hash_refresh_token(token), RefreshSession.revoked_at.is_(None)))
    if not refresh_session or refresh_session.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token is invalid or expired.")
    user = await session.get(User, refresh_session.user_id)
    if not user or user.status != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is not active.")
    refresh_session.revoked_at = datetime.now(timezone.utc)
    new_token = new_refresh_token()
    await create_refresh_session(session, user.id, new_token)
    await session.commit()
    roles = await role_names_for_user(session, user.id)
    set_refresh_cookie(response, new_token)
    return AuthResponse(access_token=create_access_token(str(user.id), str(user.organization_id), roles), user=await to_current_user_response(session, user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, session: AsyncSession = Depends(get_db_session)) -> Response:
    token = request.cookies.get("refresh_token")
    if token:
        refresh_session = await session.scalar(select(RefreshSession).where(RefreshSession.token_hash == hash_refresh_token(token), RefreshSession.revoked_at.is_(None)))
        if refresh_session:
            refresh_session.revoked_at = datetime.now(timezone.utc)
            await session.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie("refresh_token", path=f"{get_settings().api_v1_prefix}/auth")
    return response


@router.get("/me", response_model=CurrentUserResponse)
async def me(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_db_session)) -> CurrentUserResponse:
    return await to_current_user_response(session, user)
