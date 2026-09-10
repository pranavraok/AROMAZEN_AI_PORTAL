import json
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.config import Settings
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.modules.identity.models import User


EMAIL_NOT_SET_DETAIL = "Email is not set yet for this logged-in user."
ADMIN_ROLE_KEYS = {"owner", "super_admin", "admin"}
DEPARTMENT_ALIASES = {"hr": "human-resources", "human-resources": "human-resources"}


@dataclass(frozen=True)
class EmailMailbox:
    key: str
    department_slug: str
    email: str
    username: str
    password: str
    from_name: str
    host: str
    port: int
    security: str

    def public_payload(self) -> dict[str, str]:
        return {
            "key": self.key,
            "department_slug": self.department_slug,
            "department_name": "Human Resources" if self.department_slug == "human-resources" else self.department_slug.replace("-", " ").title(),
            "email": self.email,
        }


def _settings(settings: "Settings | None") -> "Settings":
    if settings is not None:
        return settings
    from app.core.config import get_settings

    return get_settings()


def _department_slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return DEPARTMENT_ALIASES.get(normalized, normalized)


def _mailbox_from_values(key: str, values: dict, config: "Settings") -> EmailMailbox | None:
    username = str(values.get("username") or values.get("email") or "").strip().lower()
    password = str(values.get("password") or "").strip()
    email = str(values.get("from_email") or values.get("email") or username).strip().lower()
    department_slug = _department_slug(str(values.get("department_slug") or key))
    security = str(values.get("security") or config.zoho_smtp_security).strip().lower()
    if not username or not password or not email or not department_slug or security not in {"ssl", "starttls"}:
        return None
    try:
        port = int(values.get("port") or config.zoho_smtp_port)
    except (TypeError, ValueError):
        return None
    return EmailMailbox(
        key=department_slug,
        department_slug=department_slug,
        email=email,
        username=username,
        password=password,
        from_name=str(values.get("from_name") or config.zoho_from_name).strip() or config.zoho_from_name,
        host=str(values.get("host") or config.zoho_smtp_host).strip(),
        port=port,
        security=security,
    )


def configured_mailboxes(settings: "Settings | None" = None) -> list[EmailMailbox]:
    """Return legacy Zoho SMTP plus future department mailboxes, keyed by department."""
    config = _settings(settings)
    mailboxes: dict[str, EmailMailbox] = {}
    if config.zoho_smtp_username and config.zoho_smtp_password:
        local_part = config.zoho_smtp_username.split("@", 1)[0]
        legacy = _mailbox_from_values(local_part, {
            "username": config.zoho_smtp_username,
            "password": config.zoho_smtp_password,
            "from_email": config.zoho_from_email,
            "from_name": config.zoho_from_name,
        }, config)
        if legacy:
            mailboxes[legacy.key] = legacy
    if getattr(config, "zoho_department_accounts_json", None):
        try:
            parsed = json.loads(config.zoho_department_accounts_json)
        except (TypeError, json.JSONDecodeError):
            parsed = {}
        if isinstance(parsed, dict):
            for key, values in parsed.items():
                if isinstance(values, dict):
                    mailbox = _mailbox_from_values(str(key), values, config)
                    if mailbox:
                        mailboxes[mailbox.key] = mailbox
    return sorted(mailboxes.values(), key=lambda mailbox: (mailbox.department_slug, mailbox.email))


def mailboxes_for_identity(
    mailboxes: list[EmailMailbox],
    user_email: str,
    department_slug: str | None,
    role_keys: set[str],
) -> list[EmailMailbox]:
    if role_keys.intersection(ADMIN_ROLE_KEYS):
        return mailboxes
    normalized_department = _department_slug(department_slug or "")
    normalized_email = user_email.strip().lower()
    return [mailbox for mailbox in mailboxes if mailbox.department_slug == normalized_department and mailbox.username == normalized_email]


async def mailboxes_available_for_user(session: "AsyncSession", user: "User", settings: "Settings | None" = None) -> list[EmailMailbox]:
    from app.modules.identity.models import Department
    from app.modules.identity.service import role_keys_for_user

    mailboxes = configured_mailboxes(settings)
    roles = await role_keys_for_user(session, user.id)
    department = await session.get(Department, user.department_id) if user.department_id else None
    return mailboxes_for_identity(mailboxes, user.email, department.slug if department else None, roles)


async def resolve_mailbox_for_user(
    session: "AsyncSession",
    user: "User",
    requested_key: str | None = None,
    target_department_slug: str | None = None,
    settings: "Settings | None" = None,
) -> EmailMailbox | None:
    available = await mailboxes_available_for_user(session, user, settings)
    desired = _department_slug(target_department_slug or requested_key or "")
    if desired:
        return next((mailbox for mailbox in available if mailbox.key == desired), None)
    return available[0] if len(available) == 1 else None
