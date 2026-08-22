import hashlib
import logging
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings
from app.core.security import create_access_token, decode_access_token, hash_password, hash_refresh_token, new_refresh_token, verify_password
from app.db.session import get_db_session
from app.modules.identity.models import Department, Organization, PasswordResetOTP, RefreshSession, User
from app.modules.identity.schemas import AuthResponse, CurrentUserResponse, ForgotPasswordRequest, LoginRequest, ResetPasswordRequest, VerifyOTPRequest
from app.modules.identity.service import create_refresh_session, permission_keys_for_user, role_names_for_user
from app.modules.settings.service import organization_settings

logger = logging.getLogger(__name__)

router = APIRouter()
bearer_scheme = HTTPBearer(auto_error=False)


async def to_current_user_response(session: AsyncSession, user: User) -> CurrentUserResponse:
    department = await session.get(Department, user.department_id) if user.department_id else None
    organization = await session.get(Organization, user.organization_id)
    preferences = await organization_settings(session, user.organization_id)
    return CurrentUserResponse(
        id=str(user.id), email=user.email, full_name=user.full_name, department_name=department.name if department else None,
        role_names=await role_names_for_user(session, user.id),
        permission_keys=await permission_keys_for_user(session, user.id), status=user.status,
        organization_name=organization.name, platform_name=preferences.platform_name, theme=preferences.theme,
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
async def login(payload: LoginRequest, request: Request, response: Response, session: AsyncSession = Depends(get_db_session)) -> AuthResponse:
    settings = get_settings()
    identifier = hashlib.sha256(payload.email.lower().encode("utf-8")).hexdigest()
    rate_key = f"auth:login:{identifier}"
    attempts = await request.app.state.redis.incr(rate_key)
    if attempts == 1:
        await request.app.state.redis.expire(rate_key, 60)
    if attempts > settings.login_rate_limit_per_minute:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please wait one minute and try again.",
        )
    user_query = select(User).where(User.email == payload.email.lower())
    user_query = user_query.where(User.phone_number == payload.phone_number.strip() if payload.phone_number else User.phone_number.is_(None))
    user = await session.scalar(user_query)
    if not user or user.status != "active" or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")
    roles = await role_names_for_user(session, user.id)
    organization_preferences = await organization_settings(session, user.organization_id)
    refresh_token = new_refresh_token()
    await create_refresh_session(session, user.id, refresh_token)
    user.last_login_at = datetime.now(timezone.utc)
    await session.commit()
    set_refresh_cookie(response, refresh_token)
    return AuthResponse(access_token=create_access_token(str(user.id), str(user.organization_id), roles, organization_preferences.session_timeout_minutes), user=await to_current_user_response(session, user))


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
    roles = await role_names_for_user(session, user.id)
    organization_preferences = await organization_settings(session, user.organization_id)
    await session.commit()
    set_refresh_cookie(response, new_token)
    return AuthResponse(access_token=create_access_token(str(user.id), str(user.organization_id), roles, organization_preferences.session_timeout_minutes), user=await to_current_user_response(session, user))


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


# ── Forgot / Reset Password ────────────────────────────────────────────────

OTP_TTL_MINUTES = 10
MAX_OTP_ATTEMPTS = 5
OTP_LENGTH = 6


def _generate_otp() -> str:
    return ''.join(secrets.choice('0123456789') for _ in range(OTP_LENGTH))


def _send_otp_email(to_email: str, otp_code: str) -> None:
    """Send OTP via Zoho SMTP."""
    settings = get_settings()
    username = settings.zoho_smtp_username
    password = settings.zoho_smtp_password
    from_email = settings.zoho_from_email or username
    if not username or not password or not from_email:
        raise RuntimeError("zoho_not_configured")
    message = EmailMessage()
    message["From"] = formataddr((settings.zoho_from_name, from_email))
    message["To"] = to_email
    message["Subject"] = "AROMAZEN AI PORTAL – Password Reset OTP"
    message.set_content(
        f"Hello,\n\n"
        f"We received a request to reset the password for your Aromazen AI Portal account.\n\n"
        f"Please use the following One-Time Password (OTP) to verify your identity:\n\n"
        f"    {otp_code}\n\n"
        f"This OTP is valid for {OTP_TTL_MINUTES} minutes. "
        f"If you did not request a password reset, please ignore this email — your account remains secure.\n\n"
        f"Best regards,\n"
        f"AROMAZEN AI PORTAL"
    )
    message.add_alternative(
        f"""
        <html>
        <body style="font-family: Arial, sans-serif; color: #333; max-width: 500px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
                <h2 style="color: #2d6a4f;">AROMAZEN AI PORTAL</h2>
            </div>
            <p>Hello,</p>
            <p>We received a request to reset the password for your <strong>Aromazen AI Portal</strong> account.</p>
            <p>Please use the following One-Time Password (OTP) to verify your identity:</p>
            <div style="text-align: center; margin: 30px 0;">
                <span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2d6a4f; background: #f0f7f4; padding: 16px 32px; border-radius: 8px; border: 1px solid #d0e8dd;">{otp_code}</span>
            </div>
            <p style="color: #666; font-size: 14px;">This OTP is valid for <strong>{OTP_TTL_MINUTES} minutes</strong>.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
            <p style="font-size: 13px; color: #999;">If you did not request a password reset, please ignore this email — your account remains secure.</p>
            <p style="font-size: 13px; color: #999;">Best regards,<br><strong>AROMAZEN AI PORTAL</strong></p>
        </body>
        </html>
        """,
        subtype="html",
    )
    security = settings.zoho_smtp_security.strip().lower()
    smtp_cls = smtplib.SMTP_SSL if security == "ssl" else smtplib.SMTP
    with smtp_cls(settings.zoho_smtp_host, settings.zoho_smtp_port, timeout=30) as smtp:
        smtp.ehlo()
        if security == "starttls":
            smtp.starttls()
            smtp.ehlo()
        smtp.login(username, password)
        smtp.send_message(message, from_addr=from_email, to_addrs=[to_email])


@router.post("/forgot-password")
async def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """Generate an OTP and email it to the user."""
    # Always return success to avoid user enumeration
    user = await session.scalar(select(User).where(User.email == payload.email.lower(), User.status == "active"))
    if not user:
        return {"detail": "If an account exists with that email, an OTP has been sent."}

    # Rate-limit: max 3 OTP requests per email in 10 minutes
    rate_key = f"auth:forgot:{hashlib.sha256(payload.email.lower().encode()).hexdigest()}"
    count = await request.app.state.redis.incr(rate_key)
    if count == 1:
        await request.app.state.redis.expire(rate_key, OTP_TTL_MINUTES * 60)
    if count > 3:
        return {"detail": "If an account exists with that email, an OTP has been sent."}

    # Invalidate any previous unverified OTPs for this email
    old_otps = list(await session.scalars(
        select(PasswordResetOTP).where(
            PasswordResetOTP.email == payload.email.lower(),
            PasswordResetOTP.verified == False,
            PasswordResetOTP.expires_at > datetime.now(timezone.utc),
        )
    ))
    for otp in old_otps:
        otp.expires_at = datetime.now(timezone.utc)  # expire immediately

    otp_code = _generate_otp()
    otp_record = PasswordResetOTP(
        user_id=user.id,
        email=payload.email.lower(),
        otp_code=otp_code,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES),
    )
    session.add(otp_record)
    await session.commit()

    try:
        await run_in_threadpool(_send_otp_email, payload.email.lower(), otp_code)
    except Exception as exc:
        logger.exception("forgot_password.smtp_failed", email=payload.email)
        raise HTTPException(status_code=502, detail="Failed to send OTP email. Please try again later.") from exc

    return {"detail": "If an account exists with that email, an OTP has been sent."}


@router.post("/verify-otp")
async def verify_otp(
    payload: VerifyOTPRequest,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """Verify the OTP code. Returns a success flag."""
    otp_record = await session.scalar(
        select(PasswordResetOTP).where(
            PasswordResetOTP.email == payload.email.lower(),
            PasswordResetOTP.verified == False,
            PasswordResetOTP.expires_at > datetime.now(timezone.utc),
        ).order_by(PasswordResetOTP.created_at.desc())
    )
    if not otp_record:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP. Please request a new one.")

    # Rate-limit: max 10 verify attempts per OTP record
    if otp_record.attempts >= MAX_OTP_ATTEMPTS:
        otp_record.expires_at = datetime.now(timezone.utc)
        await session.commit()
        raise HTTPException(status_code=429, detail="Too many attempts. Please request a new OTP.")

    otp_record.attempts += 1
    if otp_record.otp_code != payload.otp_code:
        await session.commit()
        raise HTTPException(status_code=400, detail="Incorrect OTP. Please try again.")

    otp_record.verified = True
    await session.commit()
    return {"detail": "OTP verified successfully."}


@router.post("/reset-password")
async def reset_password(
    payload: ResetPasswordRequest,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """Reset the user's password after OTP verification."""
    otp_record = await session.scalar(
        select(PasswordResetOTP).where(
            PasswordResetOTP.email == payload.email.lower(),
            PasswordResetOTP.otp_code == payload.otp_code,
            PasswordResetOTP.verified == True,
            PasswordResetOTP.expires_at > datetime.now(timezone.utc),
        ).order_by(PasswordResetOTP.created_at.desc())
    )
    if not otp_record:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP. Please start over.")

    user = await session.get(User, otp_record.user_id)
    if not user or user.status != "active":
        raise HTTPException(status_code=400, detail="User account is not active.")

    user.password_hash = hash_password(payload.new_password)
    otp_record.expires_at = datetime.now(timezone.utc)  # invalidate used OTP
    await session.commit()

    return {"detail": "Password has been reset successfully. You can now log in with your new password."}
