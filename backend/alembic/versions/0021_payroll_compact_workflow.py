"""Add editable payroll email copy and duplicate-recipient warnings."""

from alembic import op
import sqlalchemy as sa

revision = "0021_payroll_compact_workflow"
down_revision = "0020_payroll_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payroll_batches", sa.Column("email_subject", sa.String(240), nullable=False, server_default="AROMAZEN Salary Slip - {month}"))
    op.add_column("payroll_batches", sa.Column("email_body", sa.Text(), nullable=False, server_default=""))
    op.add_column("payroll_batches", sa.Column("duplicate_email_count", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("payroll_batches", "duplicate_email_count")
    op.drop_column("payroll_batches", "email_body")
    op.drop_column("payroll_batches", "email_subject")
