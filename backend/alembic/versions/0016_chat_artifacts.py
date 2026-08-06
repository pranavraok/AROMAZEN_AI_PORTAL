"""Persist rich chat artifacts such as usage graphs and email drafts."""

from alembic import op
import sqlalchemy as sa


revision = "0016_chat_artifacts"
down_revision = "0015_usage_alert_thresholds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_messages", sa.Column("artifacts_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")))


def downgrade() -> None:
    op.drop_column("ai_messages", "artifacts_json")
