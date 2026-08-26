"""Focused filesystem and replacement QA for departmental Knowledge Base uploads."""

import asyncio
import tempfile
import sys
import types
import uuid
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy.types import String, TypeDecorator


class FakeVector(TypeDecorator):
    impl = String
    cache_ok = True

    def __init__(self, _dimensions: int):
        super().__init__()


pgvector = types.ModuleType("pgvector")
pgvector_sqlalchemy = types.ModuleType("pgvector.sqlalchemy")
pgvector_sqlalchemy.Vector = FakeVector
sys.modules.setdefault("pgvector", pgvector)
sys.modules.setdefault("pgvector.sqlalchemy", pgvector_sqlalchemy)


class FakeExtractionError(Exception):
    pass


extraction = types.ModuleType("app.modules.knowledge.extraction")
extraction.ExtractionError = FakeExtractionError
extraction.extract_text = lambda *_args: ""
sys.modules.setdefault("app.modules.knowledge.extraction", extraction)

from app.modules.identity.models import KnowledgeDocument
from app.modules.knowledge import department_uploads as uploads


class FakeSession:
    def __init__(self, existing: KnowledgeDocument | None = None, fail_commit: bool = False):
        self.existing = existing
        self.fail_commit = fail_commit
        self.rolled_back = False

    async def scalar(self, _query):
        return self.existing

    async def scalars(self, _query):
        return []

    def add(self, value):
        if isinstance(value, KnowledgeDocument):
            self.existing = value

    async def flush(self):
        if self.existing and self.existing.id is None:
            self.existing.id = uuid.uuid4()

    async def execute(self, _query):
        return None

    async def delete(self, _value):
        return None

    async def commit(self):
        if self.fail_commit:
            raise RuntimeError("commit failed")

    async def rollback(self):
        self.rolled_back = True


async def main() -> None:
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        collection = SimpleNamespace(id=uuid.uuid4(), slug="inventory", updated_at=None)
        user = SimpleNamespace(id=uuid.uuid4(), organization_id=uuid.uuid4())
        uploads.get_settings = lambda: SimpleNamespace(upload_storage_path=str(root))
        uploads.department_knowledge_collection = lambda *_args: asyncio.sleep(0, result=collection)
        uploads.extract_text = lambda *_args: "Asset ID: A-1"

        session = FakeSession()
        first = (await uploads.replace_department_uploads(session, user, "inventory", [
            uploads.DepartmentUpload("assets:register", b"first", "assets.xlsx"),
        ]))[0]
        first_path = root / first.stored_filename
        assert first.version == 1 and first_path.is_file()

        second = (await uploads.replace_department_uploads(session, user, "inventory", [
            uploads.DepartmentUpload("assets:register", b"second", "renamed-assets.xlsx"),
        ]))[0]
        second_path = root / second.stored_filename
        assert second.id == first.id and second.version == 2
        assert second_path.read_bytes() == b"second" and not first_path.exists()

        other_collection = SimpleNamespace(id=uuid.uuid4(), slug="accounts", updated_at=None)
        uploads.department_knowledge_collection = lambda *_args: asyncio.sleep(0, result=other_collection)
        isolated = (await uploads.replace_department_uploads(FakeSession(), user, "accounts", [
            uploads.DepartmentUpload("assets:register", b"accounts", "assets.xlsx"),
        ]))[0]
        assert isolated.id != second.id and isolated.collection_id == other_collection.id

    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        collection = SimpleNamespace(id=uuid.uuid4(), slug="inventory", updated_at=None)
        user = SimpleNamespace(id=uuid.uuid4(), organization_id=uuid.uuid4())
        uploads.get_settings = lambda: SimpleNamespace(upload_storage_path=str(root))
        uploads.department_knowledge_collection = lambda *_args: asyncio.sleep(0, result=collection)
        uploads.extract_text = lambda *_args: "data"
        failing = FakeSession(fail_commit=True)
        try:
            await uploads.replace_department_uploads(failing, user, "inventory", [
                uploads.DepartmentUpload("assets:register", b"uncommitted", "assets.xlsx"),
            ])
        except RuntimeError:
            pass
        else:
            raise AssertionError("Expected the simulated commit to fail.")
        assert failing.rolled_back and not any(path.is_file() for path in root.rglob("*"))

    print("department_uploads_qa=passed")


if __name__ == "__main__":
    asyncio.run(main())
