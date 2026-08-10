"""Add IT asset inventory, maintenance and disposal tracking."""

from alembic import op
import sqlalchemy as sa

revision = "0023_it_asset_management"
down_revision = "0022_knowledge_reminders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "it_assets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_key", sa.String(500), nullable=False),
        sa.Column("source_sn", sa.String(80)),
        sa.Column("employee", sa.String(240)),
        sa.Column("physical_location", sa.String(240)),
        sa.Column("department_name", sa.String(240)),
        sa.Column("home_office", sa.String(160)),
        sa.Column("category", sa.String(160)),
        sa.Column("brand", sa.String(160)),
        sa.Column("model", sa.String(240)),
        sa.Column("serial_imei", sa.String(240)),
        sa.Column("sim_no", sa.String(160)),
        sa.Column("ups", sa.String(240)),
        sa.Column("label_no", sa.String(160)),
        sa.Column("invoice_date", sa.Date()),
        sa.Column("invoice_date_raw", sa.String(160)),
        sa.Column("invoice_no", sa.String(240)),
        sa.Column("supplier_name", sa.String(240)),
        sa.Column("price", sa.Numeric(14, 2)),
        sa.Column("price_raw", sa.String(160)),
        sa.Column("warranty", sa.String(160)),
        sa.Column("status", sa.String(60), nullable=False, server_default="Active"),
        sa.Column("condition", sa.String(40), nullable=False, server_default="Good"),
        sa.Column("notes", sa.Text()),
        sa.Column("last_maintenance_date", sa.Date()),
        sa.Column("next_maintenance_date", sa.Date()),
        sa.Column("maintenance_interval_months", sa.Integer()),
        sa.Column("maintenance_reminder_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("maintenance_owner", sa.String(160)),
        sa.Column("maintenance_notes", sa.Text()),
        sa.Column("scrap_reason", sa.Text()),
        sa.Column("scrap_date", sa.Date()),
        sa.Column("scrap_value", sa.Numeric(14, 2)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("organization_id", "asset_key", name="uq_it_assets_org_key"),
    )
    op.create_index("ix_it_assets_organization_id", "it_assets", ["organization_id"])
    op.create_index("ix_it_assets_category", "it_assets", ["category"])
    op.create_index("ix_it_assets_label_no", "it_assets", ["label_no"])
    op.create_index("ix_it_assets_status", "it_assets", ["status"])
    op.create_index("ix_it_assets_next_maintenance_date", "it_assets", ["next_maintenance_date"])
    op.create_table(
        "asset_maintenance_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_id", sa.Uuid(), sa.ForeignKey("it_assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("vendor", sa.String(240)),
        sa.Column("cost", sa.Numeric(14, 2)),
        sa.Column("notes", sa.Text()),
        sa.Column("next_due_date", sa.Date()),
        sa.Column("created_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_asset_maintenance_events_organization_id", "asset_maintenance_events", ["organization_id"])
    op.create_index("ix_asset_maintenance_events_asset_id", "asset_maintenance_events", ["asset_id"])


def downgrade() -> None:
    op.drop_table("asset_maintenance_events")
    op.drop_table("it_assets")

