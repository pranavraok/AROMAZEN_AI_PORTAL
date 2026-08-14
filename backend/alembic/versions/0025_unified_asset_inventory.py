"""Unify equipment registers and add configurable asset notifications."""

from alembic import op
import sqlalchemy as sa


revision = "0025_unified_asset_inventory"
down_revision = "0024_admin_platform_boundary"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("it_assets", sa.Column("source_register", sa.String(240)))
    op.add_column("it_assets", sa.Column("custom_fields", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")))
    op.add_column("it_assets", sa.Column("notification_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.create_index("ix_it_assets_source_register", "it_assets", ["source_register"])
    op.create_table(
        "asset_notification_settings",
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("default_notification_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("default_reminder_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("default_maintenance_interval_months", sa.Integer()),
        sa.Column("notify_inventory_admin", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notify_hr_admin", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notify_accounts_admin", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notify_admins", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("asset_notification_settings")
    op.drop_index("ix_it_assets_source_register", table_name="it_assets")
    op.drop_column("it_assets", "notification_enabled")
    op.drop_column("it_assets", "custom_fields")
    op.drop_column("it_assets", "source_register")
