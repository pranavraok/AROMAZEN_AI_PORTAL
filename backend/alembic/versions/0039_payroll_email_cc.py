"""Add CC recipients to payroll email drafts."""

from alembic import op
import sqlalchemy as sa


revision = "0039_payroll_email_cc"
down_revision = "0038_enforce_auto_ai_routing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "payroll_batches",
        sa.Column("cc_emails", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("payroll_batches", "cc_emails")
