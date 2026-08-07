"""Allow HR admins to replace the active salary-slip PDF template."""

from alembic import op
import sqlalchemy as sa

revision = "0020_payroll_templates"
down_revision = "0019_dept_collection_structure"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payroll_templates",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("original_filename", sa.String(500), nullable=False),
        sa.Column("stored_filename", sa.String(500), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_payroll_templates_organization_id", "payroll_templates", ["organization_id"])
    op.create_index("ix_payroll_templates_is_active", "payroll_templates", ["is_active"])
    op.create_index("ix_payroll_templates_created_at", "payroll_templates", ["created_at"])
    op.add_column("payroll_batches", sa.Column("template_id", sa.Uuid(), nullable=True))
    op.create_foreign_key("fk_payroll_batches_template_id", "payroll_batches", "payroll_templates", ["template_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_payroll_batches_template_id", "payroll_batches", type_="foreignkey")
    op.drop_column("payroll_batches", "template_id")
    op.drop_table("payroll_templates")
