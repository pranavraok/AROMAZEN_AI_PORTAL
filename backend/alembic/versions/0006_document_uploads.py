"""Add locally stored knowledge documents."""

from alembic import op
import sqlalchemy as sa

revision = "0006_document_uploads"
down_revision = "0005_knowledge_collections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("knowledge_documents", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False), sa.Column("collection_id", sa.Uuid(), sa.ForeignKey("knowledge_collections.id", ondelete="CASCADE"), nullable=False), sa.Column("uploaded_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True), sa.Column("original_filename", sa.String(500), nullable=False), sa.Column("stored_filename", sa.String(500), nullable=False, unique=True), sa.Column("mime_type", sa.String(160), nullable=True), sa.Column("size_bytes", sa.BigInteger(), nullable=False), sa.Column("version", sa.Integer(), nullable=False, server_default="1"), sa.Column("status", sa.String(32), nullable=False, server_default="uploaded"), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")))
    op.create_index("ix_knowledge_documents_organization_id", "knowledge_documents", ["organization_id"])
    op.create_index("ix_knowledge_documents_collection_id", "knowledge_documents", ["collection_id"])
    op.create_index("ix_knowledge_documents_status", "knowledge_documents", ["status"])


def downgrade() -> None:
    op.drop_table("knowledge_documents")
