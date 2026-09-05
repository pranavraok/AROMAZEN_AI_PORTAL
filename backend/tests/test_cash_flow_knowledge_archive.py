import io
import unittest
import uuid
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


class CashFlowStoragePolicyTests(unittest.IsolatedAsyncioTestCase):
    async def test_generation_keeps_snapshot_but_adds_nothing_to_knowledge_base(self):
        password = "AromaZen#Jul2026"
        protected = encrypted_pdf(password)
        session = FakeSession([None])
        user = SimpleNamespace(id=uuid.uuid4(), organization_id=uuid.uuid4())

        with patch(
            "app.modules.cash_flow.routes.ensure_access", new=AsyncMock()
        ), patch(
            "app.modules.cash_flow.routes.read_cash_flow", return_value=([("Collections", 1000.0)], [("Payments", 400.0)])
        ), patch(
            "app.modules.cash_flow.routes.read_bank", return_value=BankSummary("Bank", 100.0, 200.0, "Cr")
        ), patch(
            "app.modules.cash_flow.routes.read_assets", return_value=[]
        ), patch(
            "app.modules.cash_flow.routes.build_report", return_value=protected
        ):
            response = await generate(
                report_month="2026-07", pdf_password=password, include_previous_comparison=False,
                bob_statement=upload("bob.pdf"), axis_statement=upload("axis.pdf"), indusind_statement=upload("indusind.pdf"),
                cash_flow_excel=upload("cash-flow.xlsx"), fixed_assets_excel=None,
                user=user, session=session,
            )

        snapshot = next(item for item in session.added if isinstance(item, CashFlowReportSnapshot))
        audit = next(item for item in session.added if isinstance(item, AuditEvent))
        self.assertFalse(any(isinstance(item, KnowledgeDocument) for item in session.added))
        self.assertEqual(snapshot.report_month, "2026-07")
        self.assertTrue(audit.metadata_json["password_protected"])
        self.assertNotIn(password, repr(audit.metadata_json))
        self.assertNotIn("knowledge_document_id", audit.metadata_json)
        self.assertNotIn("knowledge_collection_id", audit.metadata_json)
        self.assertEqual(session.commits, 1)
        self.assertEqual(session.rollbacks, 0)
        self.assertEqual(response.media_type, "application/pdf")
        downloaded_bytes = b"".join([chunk async for chunk in response.body_iterator])
        reader = PdfReader(io.BytesIO(downloaded_bytes))
        self.assertTrue(reader.is_encrypted)
        self.assertEqual(reader.decrypt(password).name, "OWNER_PASSWORD")


if __name__ == "__main__":
    unittest.main()
