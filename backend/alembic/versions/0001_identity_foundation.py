"""Create identity and audit foundation tables."""

from alembic import op
import sqlalchemy as sa

revision = "0001_identity_foundation"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table("organizations", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("name", sa.String(160), nullable=False, unique=True), sa.Column("slug", sa.String(160), nullable=False, unique=True), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False))
    op.create_table("departments", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False), sa.Column("name", sa.String(160), nullable=False), sa.Column("slug", sa.String(160), nullable=False))
    op.create_table("roles", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True), sa.Column("key", sa.String(100), nullable=False, unique=True), sa.Column("name", sa.String(100), nullable=False), sa.Column("description", sa.String(320), nullable=True))
    op.create_table("permissions", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("key", sa.String(160), nullable=False, unique=True), sa.Column("name", sa.String(160), nullable=False))
    op.create_table("users", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False), sa.Column("department_id", sa.Uuid(), sa.ForeignKey("departments.id", ondelete="SET NULL"), nullable=True), sa.Column("email", sa.String(320), nullable=False, unique=True), sa.Column("full_name", sa.String(160), nullable=False), sa.Column("password_hash", sa.Text(), nullable=False), sa.Column("status", sa.String(32), nullable=False), sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False))
    op.create_table("user_roles", sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True), sa.Column("role_id", sa.Uuid(), sa.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True))
    op.create_table("role_permissions", sa.Column("role_id", sa.Uuid(), sa.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True), sa.Column("permission_id", sa.Uuid(), sa.ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True))
    op.create_table("refresh_sessions", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False), sa.Column("token_hash", sa.String(64), nullable=False, unique=True), sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False), sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False))
    op.create_table("audit_events", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False), sa.Column("actor_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True), sa.Column("action", sa.String(160), nullable=False), sa.Column("target_type", sa.String(100), nullable=False), sa.Column("target_id", sa.String(160), nullable=True), sa.Column("metadata_json", sa.JSON(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False))
    op.create_index("ix_departments_organization_id", "departments", ["organization_id"])
    op.create_index("ix_users_organization_id", "users", ["organization_id"])
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_refresh_sessions_user_id", "refresh_sessions", ["user_id"])
    op.create_index("ix_refresh_sessions_token_hash", "refresh_sessions", ["token_hash"])
    op.create_index("ix_audit_events_organization_id", "audit_events", ["organization_id"])


def downgrade() -> None:
    for table in ("audit_events", "refresh_sessions", "role_permissions", "user_roles", "users", "permissions", "roles", "departments", "organizations"):
        op.drop_table(table)
