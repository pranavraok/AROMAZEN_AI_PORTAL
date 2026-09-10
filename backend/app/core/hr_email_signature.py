from email.message import EmailMessage
from html import escape
from pathlib import Path


LOGO_PATH = Path(__file__).resolve().parents[1] / "assets" / "hr_letters" / "aromazen-logo.png"
LOGO_CONTENT_ID = "aromazen-hr-logo"

HR_SIGNATURE_TEXT = """With Regards

Swathi Nayak
HR Executive
PH:9380885540
Mail Id: hr@aromazenind.com


AROMAZEN PRIVATE LIMITED
Ground floor, B105 B106
Industrial area, Baikampady
Mangalore, Dakshina Kannada
Karnataka- 575011
📞 0824-2408350
📧 info@aromazenind.com
GSTIN: 29AAWCA9353R1ZB"""

_LEGACY_SIGNOFFS = (
    "\n\nRegards,\nHuman Resources",
    "\n\nRegards,\nHR Department\nAROMAZEN PVT LTD",
)


def _without_legacy_signoff(body: str) -> str:
    cleaned = body.strip()
    for signoff in _LEGACY_SIGNOFFS:
        if cleaned.endswith(signoff):
            return cleaned[: -len(signoff)].rstrip()
    return cleaned


def apply_hr_email_signature(message: EmailMessage, body: str) -> None:
    content = _without_legacy_signoff(body)
    message.set_content(f"{content}\n\n{HR_SIGNATURE_TEXT}")

    body_html = "<br>".join(escape(content).splitlines())
    signature_html = f"""
      <div style="margin-top:24px;font-family:Arial,sans-serif;font-size:13px;line-height:1.45;color:#111111">
        <div>With Regards</div>
        <div style="margin-top:16px"><strong>Swathi Nayak</strong><br>HR Executive<br>PH:9380885540<br>Mail Id: <a href="mailto:hr@aromazenind.com" style="color:#1155cc">hr@aromazenind.com</a></div>
        <div style="margin-top:20px"><strong>AROMAZEN PRIVATE LIMITED</strong><br>Ground floor, B105 B106<br>Industrial area, Baikampady<br>Mangalore, Dakshina Kannada<br>Karnataka- 575011<br>&#128222; <a href="tel:08242408350" style="color:#1155cc">0824-2408350</a><br>&#128231; <a href="mailto:info@aromazenind.com" style="color:#1155cc">info@aromazenind.com</a><br>GSTIN: 29AAWCA9353R1ZB</div>
        <img src="cid:{LOGO_CONTENT_ID}" width="110" alt="AROMAZEN PRIVATE LIMITED" style="display:block;width:110px;height:auto;margin-top:14px;border:0">
      </div>
    """
    message.add_alternative(
        f'<html><body><div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#111111">{body_html}</div>{signature_html}</body></html>',
        subtype="html",
    )

    html_part = message.get_payload()[-1]
    html_part.add_related(
        LOGO_PATH.read_bytes(),
        maintype="image",
        subtype="png",
        cid=f"<{LOGO_CONTENT_ID}>",
        filename="aromazen-logo.png",
        disposition="inline",
    )
