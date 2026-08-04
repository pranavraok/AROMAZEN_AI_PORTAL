"""Add permission-scoped vector RAG, chat history, and AI usage tracking."""

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "0010_ai_workspace"
down_revision = "0009_dept_knowledge_map"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "ai_conversations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False, server_default="New conversation"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ai_conversations_organization_id", "ai_conversations", ["organization_id"])
    op.create_index("ix_ai_conversations_user_id", "ai_conversations", ["user_id"])
    op.create_index("ix_ai_conversations_created_at", "ai_conversations", ["created_at"])
    op.create_table(
        "ai_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("conversation_id", sa.Uuid(), sa.ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("citations_json", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("provider", sa.String(40), nullable=True),
        sa.Column("model", sa.String(160), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ai_messages_conversation_id", "ai_messages", ["conversation_id"])
    op.create_index("ix_ai_messages_user_id", "ai_messages", ["user_id"])
    op.create_index("ix_ai_messages_created_at", "ai_messages", ["created_at"])
    op.create_table(
        "knowledge_chunks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("collection_id", sa.Uuid(), sa.ForeignKey("knowledge_collections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("document_id", sa.Uuid(), sa.ForeignKey("knowledge_documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("embedding_model", sa.String(160), nullable=False),
        sa.Column("embedding", Vector(1536), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("document_id", "chunk_index", name="uq_knowledge_chunk_document_index"),
    )
    op.create_index("ix_knowledge_chunks_organization_id", "knowledge_chunks", ["organization_id"])
    op.create_index("ix_knowledge_chunks_collection_id", "knowledge_chunks", ["collection_id"])
    op.create_index("ix_knowledge_chunks_document_id", "knowledge_chunks", ["document_id"])
    op.create_index("ix_knowledge_chunks_embedding_hnsw", "knowledge_chunks", ["embedding"], postgresql_using="hnsw", postgresql_ops={"embedding": "vector_cosine_ops"})
    op.create_table(
        "ai_usage_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("department_id", sa.Uuid(), sa.ForeignKey("departments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("conversation_id", sa.Uuid(), sa.ForeignKey("ai_conversations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("operation", sa.String(40), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("model", sa.String(160), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(32), nullable=False, server_default="completed"),
        sa.Column("error_code", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    for column in ("organization_id", "user_id", "department_id", "provider", "model", "status", "created_at"):
        op.create_index(f"ix_ai_usage_events_{column}", "ai_usage_events", [column])


def downgrade() -> None:
    op.drop_table("ai_usage_events")
    op.drop_index("ix_knowledge_chunks_embedding_hnsw", table_name="knowledge_chunks")
    op.drop_table("knowledge_chunks")
    op.drop_table("ai_messages")
    op.drop_table("ai_conversations")
