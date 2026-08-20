import io
import tempfile
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import UploadFile
from pypdf import PdfReader, PdfWriter

from app.modules.cash_flow.routes import generate
from app.modules.cash_flow.service import BankSummary
from app.modules.identity.models import AuditEvent, CashFlowReportSnapshot, KnowledgeDocument


def encrypted_pdf(password: str) -> bytes:
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    writer.encrypt(password)
    writer.write(output)
    return output.getvalue()


def upload(name: str) -> UploadFile:
    return UploadFile(filename=name, file=io.BytesIO(b"test-content"))


class FakeSession:
    def __init__(self, scalar_results):
        self.scalar_results = iter(scalar_results)
        self.added = []
        self.commits = 0
        self.rollbacks = 0

    async def scalar(self, _query):
        return next(self.scalar_results)

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        for item in self.added:
            if getattr(item, "id", None) is None:
                item.id = uuid.uuid4()

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


class CashFlowKnowledgeArchiveTests(unittest.IsolatedAsyncioTestCase):
    async def test_generation_archives_only_the_encrypted_pdf_and_snapshot(self):
        password = "AromaZen#Jul2026"
        protected = encrypted_pdf(password)
        collection = SimpleNamespace(id=uuid.uuid4(), updated_at=None)
        session = FakeSession([collection, None, None])
        user = SimpleNamespace(id=uuid.uuid4(), organization_id=uuid.uuid4())

        with tempfile.TemporaryDirectory() as storage, patch(
            "app.modules.cash_flow.routes.ensure_access", new=AsyncMock()
        ), patch(
            "app.modules.cash_flow.routes.read_cash_flow", return_value=([("Collections", 1000.0)], [("Payments", 400.0)])
        ), patch(
            "app.modules.cash_flow.routes.read_bank", return_value=BankSummary("Bank", 100.0, 200.0, "Cr")
        ), patch(
            "app.modules.cash_flow.routes.read_assets", return_value=[]
        ), patch(
            "app.modules.cash_flow.routes.build_report", return_value=protected
        ), patch(
            "app.modules.cash_flow.routes.get_settings", return_value=SimpleNamespace(upload_storage_path=storage)
        ):
            response = await generate(
                report_month="2026-07", pdf_password=password, include_previous_comparison=False,
                bob_statement=upload("bob.pdf"), axis_statement=upload("axis.pdf"), indusind_statement=upload("indusind.pdf"),
                cash_flow_excel=upload("cash-flow.xlsx"), fixed_assets_excel=None,
                user=user, session=session,
            )
            archived_during_generation = next(item for item in session.added if isinstance(item, KnowledgeDocument))
            archived_path = Path(storage) / archived_during_generation.stored_filename
            self.assertTrue(archived_path.is_file())
            archived_bytes = archived_path.read_bytes()

        archived = next(item for item in session.added if isinstance(item, KnowledgeDocument))
        snapshot = next(item for item in session.added if isinstance(item, CashFlowReportSnapshot))
        audit = next(item for item in session.added if isinstance(item, AuditEvent))
        self.assertEqual(archived.collection_id, collection.id)
        self.assertEqual(archived.document_category, "cash_flow_report")
        self.assertEqual(archived.status, "ready")
        self.assertIsNone(archived.extracted_text)
        self.assertEqual(snapshot.report_month, "2026-07")
        self.assertTrue(audit.metadata_json["password_protected"])
        self.assertNotIn(password, repr(archived.__dict__))
        self.assertNotIn(password, repr(audit.metadata_json))
        self.assertEqual(session.commits, 1)
        self.assertEqual(session.rollbacks, 0)
        self.assertEqual(response.media_type, "application/pdf")
        reader = PdfReader(io.BytesIO(archived_bytes))
        self.assertTrue(reader.is_encrypted)
        self.assertEqual(reader.decrypt(password).name, "OWNER_PASSWORD")


if __name__ == "__main__":
    unittest.main()
