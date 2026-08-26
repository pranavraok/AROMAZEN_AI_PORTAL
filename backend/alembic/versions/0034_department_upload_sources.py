"""Track replaceable departmental upload sources in Knowledge Base documents."""

import sqlalchemy as sa
from alembic import op


revision = "0034_department_upload_sources"
down_revision = "0033_password_reset_otps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("knowledge_documents", sa.Column("source_key", sa.String(160), nullable=True))
    op.create_index("ix_knowledge_documents_source_key", "knowledge_documents", ["source_key"])
    op.create_unique_constraint(
        "uq_knowledge_document_collection_source",
        "knowledge_documents",
        ["organization_id", "collection_id", "source_key"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_knowledge_document_collection_source", "knowledge_documents", type_="unique")
    op.drop_index("ix_knowledge_documents_source_key", table_name="knowledge_documents")
    op.drop_column("knowledge_documents", "source_key")
