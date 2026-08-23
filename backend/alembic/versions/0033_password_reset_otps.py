"""Add password_reset_otps table for forgot-password flow."""

from alembic import op
import sqlalchemy as sa


revision = "0033_password_reset_otps"
down_revision = "0032_portal_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_reset_otps",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), index=True),
        sa.Column("email", sa.String(320), index=True),
        sa.Column("otp_code", sa.String(6)),
        sa.Column("attempts", sa.Integer(), server_default="0"),
        sa.Column("verified", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("expires_at", sa.DateTime(timezone=True), index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("password_reset_otps")
