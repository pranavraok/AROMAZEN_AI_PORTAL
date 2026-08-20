"""Store monthly cash-flow summaries for comparisons.

Revision ID: 0027_cash_flow_report_snapshots
Revises: 0026_asset_register_groups
"""

from alembic import op
import sqlalchemy as sa


revision = "0027_cash_flow_report_snapshots"
down_revision = "0026_asset_register_groups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cash_flow_report_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("report_month", sa.String(length=7), nullable=False),
        sa.Column("receipts_json", sa.JSON(), nullable=False),
        sa.Column("payments_json", sa.JSON(), nullable=False),
        sa.Column("banks_json", sa.JSON(), nullable=False),
        sa.Column("total_receipts", sa.Numeric(18, 2), nullable=False),
        sa.Column("total_payments", sa.Numeric(18, 2), nullable=False),
        sa.Column("net_movement", sa.Numeric(18, 2), nullable=False),
        sa.Column("assets_included", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "report_month", name="uq_cash_flow_snapshot_org_month"),
    )
    op.create_index("ix_cash_flow_report_snapshots_organization_id", "cash_flow_report_snapshots", ["organization_id"])
    op.create_index("ix_cash_flow_report_snapshots_report_month", "cash_flow_report_snapshots", ["report_month"])
    op.create_index("ix_cash_flow_report_snapshots_created_at", "cash_flow_report_snapshots", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_cash_flow_report_snapshots_created_at", table_name="cash_flow_report_snapshots")
    op.drop_index("ix_cash_flow_report_snapshots_report_month", table_name="cash_flow_report_snapshots")
    op.drop_index("ix_cash_flow_report_snapshots_organization_id", table_name="cash_flow_report_snapshots")
    op.drop_table("cash_flow_report_snapshots")
