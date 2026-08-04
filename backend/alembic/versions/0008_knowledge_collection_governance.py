"""Add collection lifecycle management."""

from alembic import op
import sqlalchemy as sa

revision = "0008_knowledge_governance"
down_revision = "0007_document_extraction"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("knowledge_collections", sa.Column("status", sa.String(32), nullable=False, server_default="active"))
    op.add_column("knowledge_collections", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_knowledge_collections_status", "knowledge_collections", ["status"])


def downgrade() -> None:
    op.drop_index("ix_knowledge_collections_status", table_name="knowledge_collections")
    op.drop_column("knowledge_collections", "archived_at")
    op.drop_column("knowledge_collections", "status")
