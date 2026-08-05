"""Add R&D template-based document generation history."""

from alembic import op
import sqlalchemy as sa

revision = "0011_document_generator"
down_revision = "0010_ai_workspace"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "document_generations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("department_id", sa.Uuid(), sa.ForeignKey("departments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("template_document_id", sa.Uuid(), sa.ForeignKey("knowledge_documents.id", ondelete="SET NULL"), nullable=True),
        sa.Column("document_type", sa.String(20), nullable=False),
        sa.Column("input_mode", sa.String(20), nullable=False),
        sa.Column("output_stored_filename", sa.String(500), nullable=False, unique=True),
        sa.Column("output_original_filename", sa.String(500), nullable=False),
        sa.Column("warnings_json", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    for column in ("organization_id", "user_id", "department_id", "status", "created_at"):
        op.create_index(f"ix_document_generations_{column}", "document_generations", [column])


def downgrade() -> None:
    op.drop_table("document_generations")
