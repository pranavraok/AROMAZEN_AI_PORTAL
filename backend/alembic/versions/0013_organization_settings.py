"""Add persistent organization settings."""

from alembic import op
import sqlalchemy as sa

revision = "0013_organization_settings"
down_revision = "0012_super_admin_role_labels"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "organization_settings",
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("platform_name", sa.String(160), nullable=False, server_default="AROMAZEN AI"),
        sa.Column("theme", sa.String(20), nullable=False, server_default="dark"),
        sa.Column("default_ai_provider", sa.String(20), nullable=False, server_default="anthropic"),
        sa.Column("session_timeout_minutes", sa.Integer(), nullable=False, server_default="480"),
        sa.Column("timezone", sa.String(80), nullable=False, server_default="Asia/Calcutta"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("organization_settings")
