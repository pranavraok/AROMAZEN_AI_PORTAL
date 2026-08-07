"""Persist salary-slip batches and per-employee delivery status."""

from alembic import op
import sqlalchemy as sa

revision = "0018_payroll_delivery"
down_revision = "0017_top_admin_full_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payroll_batches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("payroll_month", sa.String(7), nullable=False),
        sa.Column("original_filename", sa.String(500), nullable=False),
        sa.Column("stored_filename", sa.String(500), nullable=False, unique=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("total_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sent_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("sending_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    for column in ("organization_id", "payroll_month", "status", "created_at"):
        op.create_index(f"ix_payroll_batches_{column}", "payroll_batches", [column])
    op.create_table(
        "payroll_recipients",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("batch_id", sa.Uuid(), sa.ForeignKey("payroll_batches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("employee_name", sa.String(160), nullable=False),
        sa.Column("employee_code", sa.String(80), nullable=False),
        sa.Column("personal_email", sa.String(320), nullable=False),
        sa.Column("birth_year", sa.Integer(), nullable=False),
        sa.Column("details_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("pdf_stored_filename", sa.String(500), nullable=False, unique=True),
        sa.Column("pdf_original_filename", sa.String(500), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.String(1000), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("batch_id", "row_number", name="uq_payroll_recipient_batch_row"),
    )
    for column in ("batch_id", "organization_id", "personal_email", "status", "created_at"):
        op.create_index(f"ix_payroll_recipients_{column}", "payroll_recipients", [column])


def downgrade() -> None:
    op.drop_table("payroll_recipients")
    op.drop_table("payroll_batches")
