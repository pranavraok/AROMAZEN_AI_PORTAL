"""Add expiry and reminder metadata to knowledge documents."""

from alembic import op
import sqlalchemy as sa

revision = "0022_knowledge_reminders"
down_revision = "0021_payroll_compact_workflow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("knowledge_documents", sa.Column("document_category", sa.String(80), nullable=True))
    op.add_column("knowledge_documents", sa.Column("expiry_date", sa.DateTime(timezone=True), nullable=True))
    op.add_column("knowledge_documents", sa.Column("reminder_days_before", sa.Integer(), nullable=False, server_default="30"))
    op.add_column("knowledge_documents", sa.Column("reminder_owner", sa.String(160), nullable=True))
    op.create_index("ix_knowledge_documents_document_category", "knowledge_documents", ["document_category"])
    op.create_index("ix_knowledge_documents_expiry_date", "knowledge_documents", ["expiry_date"])


def downgrade() -> None:
    op.drop_index("ix_knowledge_documents_expiry_date", table_name="knowledge_documents")
    op.drop_index("ix_knowledge_documents_document_category", table_name="knowledge_documents")
    op.drop_column("knowledge_documents", "reminder_owner")
    op.drop_column("knowledge_documents", "reminder_days_before")
    op.drop_column("knowledge_documents", "expiry_date")
    op.drop_column("knowledge_documents", "document_category")
