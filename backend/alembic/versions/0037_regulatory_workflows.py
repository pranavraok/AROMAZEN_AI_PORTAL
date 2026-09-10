"""Add Regulatory Affairs approval workflows and ingredient master."""

from alembic import op
import sqlalchemy as sa

revision = "0037_regulatory_workflows"
down_revision = "0036_qa_regulatory_departments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "regulatory_workflows",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("approved_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("product_name", sa.String(300), nullable=False, server_default=""),
        sa.Column("product_code", sa.String(160), nullable=False, server_default=""),
        sa.Column("market", sa.String(40), nullable=False, server_default="other"),
        sa.Column("status", sa.String(32), nullable=False, server_default="review"),
        sa.Column("source_files_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("sds_fields_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("ingredients_json", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("generated_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_regulatory_workflows_organization_id", "regulatory_workflows", ["organization_id"])
    op.create_index("ix_regulatory_workflows_status", "regulatory_workflows", ["status"])
    op.create_index("ix_regulatory_workflows_created_at", "regulatory_workflows", ["created_at"])
    op.create_table(
        "regulatory_ingredient_master",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("normalized_name", sa.String(300), nullable=False),
        sa.Column("display_name", sa.String(300), nullable=False),
        sa.Column("data_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("sources_json", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("approved_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "normalized_name", name="uq_regulatory_ingredient_org_name"),
    )
    op.create_index("ix_regulatory_ingredient_master_organization_id", "regulatory_ingredient_master", ["organization_id"])


def downgrade() -> None:
    op.drop_table("regulatory_ingredient_master")
    op.drop_table("regulatory_workflows")
