"""Persist user notifications and read state."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0032_portal_notifications"
down_revision = "0031_department_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portal_notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=60), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("severity", sa.String(length=24), nullable=False, server_default="info"),
        sa.Column("href", sa.String(length=500), nullable=True),
        sa.Column("dedupe_key", sa.String(length=500), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "dedupe_key", name="uq_portal_notifications_user_dedupe"),
    )
    op.create_index("ix_portal_notifications_organization_id", "portal_notifications", ["organization_id"])
    op.create_index("ix_portal_notifications_user_id", "portal_notifications", ["user_id"])
    op.create_index("ix_portal_notifications_kind", "portal_notifications", ["kind"])
    op.create_index("ix_portal_notifications_read_at", "portal_notifications", ["read_at"])
    op.create_index("ix_portal_notifications_created_at", "portal_notifications", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_portal_notifications_created_at", table_name="portal_notifications")
    op.drop_index("ix_portal_notifications_read_at", table_name="portal_notifications")
    op.drop_index("ix_portal_notifications_kind", table_name="portal_notifications")
    op.drop_index("ix_portal_notifications_user_id", table_name="portal_notifications")
    op.drop_index("ix_portal_notifications_organization_id", table_name="portal_notifications")
    op.drop_table("portal_notifications")
