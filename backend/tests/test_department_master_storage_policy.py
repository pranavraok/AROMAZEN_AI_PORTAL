import tempfile
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.modules.identity.models import KnowledgeDocument
from app.modules.knowledge.department_uploads import (
    DepartmentUpload,
    is_master_template_upload,
    purge_transient_workflow_kb_documents,
    replace_department_master_templates,
)


class FakeTemplateSession:
    def __init__(self, document: KnowledgeDocument):
        self.document = document
        self.added = []
        self.commits = 0

    async def scalar(self, _query):
        return self.document

    async def execute(self, _query):
        return None

    async def flush(self):
        return None

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        return None

    def add(self, item):
        self.added.append(item)

    async def delete(self, _item):
        return None


class FakePurgeSession:
    def __init__(self, documents):
        self.documents = documents
        self.deleted = []
        self.commits = 0

    async def scalars(self, _query):
        return self.documents

    async def delete(self, item):
        self.deleted.append(item)

    async def commit(self):
        self.commits += 1


class DepartmentMasterStoragePolicyTests(unittest.IsolatedAsyncioTestCase):
    def test_only_master_template_categories_are_allowed(self):
        self.assertTrue(is_master_template_upload(DepartmentUpload("qa-coa-master", b"x", "coa.docx", document_category="document_template")))
        self.assertTrue(is_master_template_upload(DepartmentUpload("regulatory-template:sds", b"x", "sds.docx", document_category="regulatory_template:sds")))
        self.assertTrue(is_master_template_upload(DepartmentUpload("hr-letter-template:offer", b"x", "offer.docx", document_category="hr_letter_template:offer")))
        self.assertTrue(is_master_template_upload(DepartmentUpload("salary-slip-template:master", b"x", "salary.pdf", document_category="salary_slip_template")))
        self.assertFalse(is_master_template_upload(DepartmentUpload("regulatory-workflow:1:excel", b"x", "input.xlsx")))
        self.assertFalse(is_master_template_upload(DepartmentUpload("cash-flow:monthly-data", b"x", "cash.xlsx")))

    async def test_processing_input_is_rejected_before_database_or_storage_access(self):
        session = AsyncMock()
        with self.assertRaisesRegex(ValueError, "Only master templates"):
            await replace_department_master_templates(
                session,
                SimpleNamespace(organization_id=uuid.uuid4()),
                "regulatory",
                [DepartmentUpload("regulatory-workflow:1:excel", b"source", "input.xlsx")],
            )
        session.scalar.assert_not_awaited()

    async def test_revised_master_reuses_slot_and_removes_old_file(self):
        organization_id = uuid.uuid4()
        collection_id = uuid.uuid4()
        document = KnowledgeDocument(
            id=uuid.uuid4(),
            organization_id=organization_id,
            collection_id=collection_id,
            uploaded_by_user_id=None,
            original_filename="old.docx",
            stored_filename="old.docx",
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size_bytes=3,
            version=1,
            status="ready",
            document_category="document_template",
            source_key="qa-coa-master",
        )
        session = FakeTemplateSession(document)
        collection = SimpleNamespace(id=collection_id, slug="quality-assurance", updated_at=None)
        user = SimpleNamespace(id=uuid.uuid4(), organization_id=organization_id)

        with tempfile.TemporaryDirectory() as storage:
            old_path = Path(storage) / "old.docx"
            old_path.write_bytes(b"old")
            with patch(
                "app.modules.knowledge.department_uploads.department_knowledge_collection",
                new=AsyncMock(return_value=collection),
            ), patch(
                "app.modules.knowledge.department_uploads.get_settings",
                return_value=SimpleNamespace(upload_storage_path=storage),
            ), patch(
                "app.modules.knowledge.department_uploads.extract_text",
                return_value="mapped master",
            ):
                result = await replace_department_master_templates(
                    session,
                    user,
                    "quality-assurance",
                    [DepartmentUpload("qa-coa-master", b"new", "new.docx", document_category="document_template")],
                )

            self.assertEqual(result, [document])
            self.assertEqual(document.version, 2)
            self.assertEqual(document.original_filename, "new.docx")
            self.assertEqual((Path(storage) / document.stored_filename).read_bytes(), b"new")
            self.assertFalse(old_path.exists())
            self.assertEqual(session.commits, 1)

    async def test_legacy_workflow_kb_files_are_purged_from_database_and_disk(self):
        organization_id = uuid.uuid4()
        collection_id = uuid.uuid4()
        document = KnowledgeDocument(
            id=uuid.uuid4(),
            organization_id=organization_id,
            collection_id=collection_id,
            uploaded_by_user_id=None,
            original_filename="formula.xlsx",
            stored_filename="legacy/formula.xlsx",
            mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size_bytes=6,
            version=1,
            status="ready",
            document_category="department_upload",
            source_key="regulatory-workflow:123:excel",
        )
        session = FakePurgeSession([document])

        with tempfile.TemporaryDirectory() as storage:
            path = Path(storage) / document.stored_filename
            path.parent.mkdir(parents=True)
            path.write_bytes(b"legacy")
            with patch(
                "app.modules.knowledge.department_uploads.get_settings",
                return_value=SimpleNamespace(upload_storage_path=storage),
            ):
                count = await purge_transient_workflow_kb_documents(session)

            self.assertEqual(count, 1)
            self.assertEqual(session.deleted, [document])
            self.assertEqual(session.commits, 1)
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
