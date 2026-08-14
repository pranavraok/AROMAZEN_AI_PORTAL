"""Split asset inventory into IT and General registers.

Revision ID: 0026_asset_register_groups
Revises: 0025_unified_asset_inventory
"""

from alembic import op
import sqlalchemy as sa


revision = "0026_asset_register_groups"
down_revision = "0025_unified_asset_inventory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "it_assets",
        sa.Column("asset_group", sa.String(length=40), nullable=False, server_default="General"),
    )
    op.execute(
        "UPDATE it_assets SET asset_group = 'IT' "
        "WHERE lower(coalesce(source_register, '')) LIKE 'it assets org%'"
    )
    op.create_index("ix_it_assets_asset_group", "it_assets", ["asset_group"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_it_assets_asset_group", table_name="it_assets")
    op.drop_column("it_assets", "asset_group")
