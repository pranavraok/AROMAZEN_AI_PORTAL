"""Add bonus slips to the automated slip generator."""

from alembic import op
import sqlalchemy as sa


revision = "0040_payroll_bonus_slips"
down_revision = "0039_payroll_email_cc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "payroll_batches",
        sa.Column("slip_type", sa.String(length=16), nullable=False, server_default="salary"),
    )
    op.create_index("ix_payroll_batches_slip_type", "payroll_batches", ["slip_type"])


def downgrade() -> None:
    op.drop_index("ix_payroll_batches_slip_type", table_name="payroll_batches")
    op.drop_column("payroll_batches", "slip_type")
