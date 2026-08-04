"""Store locally extracted document text and processing status."""

from alembic import op
import sqlalchemy as sa

revision = "0007_document_extraction"
down_revision = "0006_document_uploads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("knowledge_documents", sa.Column("extracted_text", sa.Text(), nullable=True))
    op.add_column("knowledge_documents", sa.Column("extracted_characters", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("knowledge_documents", sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("knowledge_documents", "processed_at")
    op.drop_column("knowledge_documents", "extracted_characters")
    op.drop_column("knowledge_documents", "extracted_text")
