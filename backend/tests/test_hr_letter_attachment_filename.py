import unittest

from app.modules.hr_letters.routes import SendLetterRequest, _letter_attachment_filename


def _request(template_key: str, employee_name: str) -> SendLetterRequest:
    return SendLetterRequest(
        template_key=template_key,
        unit_number=1,
        fields={"employee_name": employee_name},
        recipient_email="employee@example.com",
        subject="Letter",
        message="Please find the letter attached.",
    )


class LetterAttachmentFilenameTests(unittest.TestCase):
    def test_offer_letter_attachment_uses_requested_employee_filename(self) -> None:
        self.assertEqual(
            _letter_attachment_filename(_request("offer", "Pranav Rao")),
            "Offer Letter -Pranav Rao.pdf",
        )

    def test_offer_letter_attachment_removes_unsafe_filename_characters(self) -> None:
        self.assertEqual(
            _letter_attachment_filename(_request("offer", 'Pranav/Rao: HR')),
            "Offer Letter -Pranav-Rao- HR.pdf",
        )

    def test_other_letter_attachment_names_are_unchanged(self) -> None:
        self.assertEqual(
            _letter_attachment_filename(_request("appointment", "Pranav Rao")),
            "appointment-unit-1-Pranav-Rao.pdf",
        )


if __name__ == "__main__":
    unittest.main()
