from unittest.mock import MagicMock, patch

from app.core.email_access import EmailMailbox
from app.core.hr_email_signature import HR_SIGNATURE_TEXT
from app.modules.identity.admin_routes import (
    _invitation_message_body,
    _normalized_cc,
    _send_invitation_email,
)


def test_invitation_body_replaces_link_placeholder() -> None:
    url = "https://ai.aromazenind.com/accept-invitation/secure-token"

    plain, html = _invitation_message_body(
        "Dear Employee,\n\nActivate here:\n{{invitation_link}}",
        url,
    )

    assert "{{invitation_link}}" not in plain
    assert url in plain
    assert f'href="{url}"' in html
    assert "Activate your account" in html


def test_invitation_body_appends_link_when_placeholder_is_removed() -> None:
    url = "https://ai.aromazenind.com/accept-invitation/secure-token"

    plain, _ = _invitation_message_body("Welcome to the portal.", url)

    assert plain.endswith(f"Activate your account: {url}")


def test_invitation_cc_removes_primary_and_duplicates() -> None:
    assert _normalized_cc(
        "employee@example.com",
        ["Employee@example.com", "hr@example.com", "HR@example.com", "manager@example.com"],
    ) == ["hr@example.com", "manager@example.com"]


def test_invitation_email_uses_hr_signature_and_cc() -> None:
    mailbox = EmailMailbox(
        key="human-resources",
        department_slug="human-resources",
        email="hr@aromazenind.com",
        username="hr@aromazenind.com",
        password="app-password",
        from_name="AROMAZEN HR",
        host="smtp.zoho.in",
        port=587,
        security="starttls",
    )
    smtp_client = MagicMock()
    smtp = smtp_client.return_value.__enter__.return_value

    with patch("app.modules.identity.admin_routes.smtplib.SMTP", smtp_client):
        _send_invitation_email(
            mailbox,
            "employee@example.com",
            ["manager@example.com"],
            "Invitation to join AROMAZEN AI",
            "Please activate your account.",
            "Please activate your account.",
        )

    sent_message = smtp.send_message.call_args.args[0]
    plain = sent_message.get_body(preferencelist=("plain",)).get_content()
    html = sent_message.get_body(preferencelist=("html",)).get_content()
    assert sent_message["To"] == "employee@example.com"
    assert sent_message["Cc"] == "manager@example.com"
    assert sent_message["Subject"] == "Invitation to join AROMAZEN AI"
    assert HR_SIGNATURE_TEXT in plain
    assert "hr@aromazenind.com" in html
    smtp.starttls.assert_called_once()
    smtp.send_message.assert_called_once()
