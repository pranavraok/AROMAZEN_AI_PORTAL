"""Add Marketing customer sample register."""

from alembic import op
import sqlalchemy as sa


revision = "0043_marketing_customer_samples"
down_revision = "0042_marketing_lead_handover"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "marketing_sample_batches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("linked_lead_id", sa.Uuid(), sa.ForeignKey("marketing_leads.id", ondelete="SET NULL"), nullable=True),
        sa.Column("serial_number", sa.String(80), nullable=True),
        sa.Column("sample_date", sa.Date(), nullable=False),
        sa.Column("company_name", sa.String(240), nullable=False),
        sa.Column("remark", sa.Text(), nullable=True),
        sa.Column("status", sa.String(40), nullable=False, server_default="awaiting_feedback"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "status IN ('recorded','dispatched','awaiting_feedback','satisfied','not_satisfied','order_received','closed')",
            name="ck_marketing_sample_batches_status",
        ),
    )
    for column in (
        "organization_id", "created_by_user_id", "linked_lead_id", "serial_number",
        "sample_date", "company_name", "status", "created_at",
    ):
        op.create_index(
            f"ix_marketing_sample_batches_{column}", "marketing_sample_batches", [column]
        )

    op.create_table(
        "marketing_sample_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("batch_id", sa.Uuid(), sa.ForeignKey("marketing_sample_batches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fragrance_name", sa.String(300), nullable=False),
        sa.Column("fragrance_code", sa.String(120), nullable=True),
        sa.Column("application", sa.String(200), nullable=True),
        sa.Column("quantity", sa.String(160), nullable=True),
        sa.Column("cost", sa.String(120), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    for column in (
        "organization_id", "batch_id", "fragrance_name", "fragrance_code", "application",
    ):
        op.create_index(
            f"ix_marketing_sample_items_{column}", "marketing_sample_items", [column]
        )


def downgrade() -> None:
    op.drop_table("marketing_sample_items")
    op.drop_table("marketing_sample_batches")
