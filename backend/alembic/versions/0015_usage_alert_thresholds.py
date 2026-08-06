"""Add persistent AI usage alert thresholds."""

from alembic import op
import sqlalchemy as sa

revision = "0015_usage_alert_thresholds"
down_revision = "0014_ai_chat_history_attachments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("organization_settings", sa.Column("daily_ai_request_limit", sa.Integer(), nullable=False, server_default="100"))
    op.add_column("organization_settings", sa.Column("monthly_ai_request_limit", sa.Integer(), nullable=False, server_default="2000"))
    op.add_column("organization_settings", sa.Column("monthly_ai_cost_limit_usd", sa.Numeric(12, 2), nullable=False, server_default="250"))


def downgrade() -> None:
    op.drop_column("organization_settings", "monthly_ai_cost_limit_usd")
    op.drop_column("organization_settings", "monthly_ai_request_limit")
    op.drop_column("organization_settings", "daily_ai_request_limit")
