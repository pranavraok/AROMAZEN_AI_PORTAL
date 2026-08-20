"""Add is_company_wide flag to knowledge documents."""

from alembic import op
import sqlalchemy as sa


revision = "0027_knowledge_doc_company_wide"
down_revision = "0026_asset_register_groups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("knowledge_documents", sa.Column("is_company_wide", sa.Boolean(), nullable=False, server_default="false"))


def downgrade() -> None:
    op.drop_column("knowledge_documents", "is_company_wide")
