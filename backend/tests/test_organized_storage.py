import unittest
import uuid
from pathlib import PurePosixPath

from app.modules.knowledge.storage import organized_storage_name, safe_storage_segment


class OrganizedStorageTests(unittest.TestCase):
    def test_name_is_readable_versioned_and_collision_safe(self) -> None:
        organization_id = uuid.UUID("11111111-1111-1111-1111-111111111111")
        document_id = uuid.UUID("abcdef12-3456-7890-abcd-ef1234567890")

        stored = organized_storage_name(
            "templates",
            organization_id,
            "Appointment Letter (Approved) FINAL.docx",
            category="HR Letters/Appointment",
            identifier=document_id,
            version=3,
        )

        self.assertEqual(
            stored,
            "templates/11111111-1111-1111-1111-111111111111/hr-letters/appointment/"
            "appointment-letter-approved-final--v003--abcdef123456.docx",
        )
        self.assertNotIn("\\", stored)
        self.assertFalse(PurePosixPath(stored).is_absolute())

    def test_unsafe_and_unicode_segments_are_normalized(self) -> None:
        self.assertEqual(safe_storage_segment(" ../R&D / Policies "), "r-d-policies")
        self.assertEqual(safe_storage_segment("Résumé 2026"), "resume-2026")


if __name__ == "__main__":
    unittest.main()
