"""Add private AI chat attachments and persisted web sources."""

from alembic import op
import sqlalchemy as sa

revision = "0014_ai_chat_history_attachments"
down_revision = "0013_organization_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_messages", sa.Column("web_sources_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")))
    op.create_table(
        "ai_chat_attachments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), sa.ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=True),
        sa.Column("message_id", sa.Uuid(), sa.ForeignKey("ai_messages.id", ondelete="CASCADE"), nullable=True),
        sa.Column("kind", sa.String(24), nullable=False, server_default="upload"),
        sa.Column("original_filename", sa.String(500), nullable=False),
        sa.Column("stored_filename", sa.String(500), nullable=False, unique=True),
        sa.Column("mime_type", sa.String(160), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="ready"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    for column in ("organization_id", "user_id", "conversation_id", "message_id", "status", "created_at"):
        op.create_index(f"ix_ai_chat_attachments_{column}", "ai_chat_attachments", [column])


def downgrade() -> None:
    op.drop_table("ai_chat_attachments")
    op.drop_column("ai_messages", "web_sources_json")
