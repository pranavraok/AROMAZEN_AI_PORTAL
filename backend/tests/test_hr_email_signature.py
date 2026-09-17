from email.message import EmailMessage

from app.core.hr_email_signature import HR_SIGNATURE_TEXT, apply_hr_email_signature


def test_hr_signature_is_exact_and_includes_inline_logo() -> None:
    message = EmailMessage()
    apply_hr_email_signature(message, "Dear Employee,\n\nPlease find the requested document attached.")

    plain = message.get_body(preferencelist=("plain",)).get_content()
    html = message.get_body(preferencelist=("html",)).get_content()

    assert plain.rstrip().endswith(HR_SIGNATURE_TEXT)
    assert plain.count("With Regards") == 1
    assert "Swathi Nayak" in html
    assert "hr@aromazenind.com" in html
    assert "info@aromazenind.com" in html
    assert "29AAWCA9353R1ZB" in html
    assert 'src="cid:aromazen-hr-logo"' in html


def test_existing_hr_signature_is_not_duplicated() -> None:
    message = EmailMessage()
    apply_hr_email_signature(message, f"Hello\n\n{HR_SIGNATURE_TEXT}")

    plain = message.get_body(preferencelist=("plain",)).get_content()
    assert plain.count("With Regards") == 1
    assert plain.count("Swathi Nayak") == 1
