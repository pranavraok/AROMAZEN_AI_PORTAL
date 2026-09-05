"""Enforce automatic AI provider routing."""

from alembic import op
import sqlalchemy as sa

revision = "0038_enforce_auto_ai_routing"
down_revision = "0037_regulatory_workflows"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE organization_settings SET default_ai_provider = 'auto'")
    op.alter_column(
        "organization_settings",
        "default_ai_provider",
        existing_type=sa.String(20),
        server_default="auto",
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "organization_settings",
        "default_ai_provider",
        existing_type=sa.String(20),
        server_default="anthropic",
        existing_nullable=False,
    )
