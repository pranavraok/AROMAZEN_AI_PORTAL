"""Store an optional external editor link for Knowledge Base templates."""

import sqlalchemy as sa
from alembic import op


revision = "0035_knowledge_external_url"
down_revision = "0034_department_upload_sources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("knowledge_documents", sa.Column("external_edit_url", sa.String(1000), nullable=True))


def downgrade() -> None:
    op.drop_column("knowledge_documents", "external_edit_url")
