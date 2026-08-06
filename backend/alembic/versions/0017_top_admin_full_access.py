"""Grant the complete permission set to Super Admin and Admin roles."""

from alembic import op


revision = "0017_top_admin_full_access"
down_revision = "0016_chat_artifacts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        CROSS JOIN permissions p
        WHERE r.key IN ('owner', 'super_admin')
        ON CONFLICT DO NOTHING
    """)
    op.execute("""
        UPDATE roles
        SET description = 'Full organization administration with protected Super Admin safeguards'
        WHERE key = 'super_admin'
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM role_permissions rp
        USING roles r, permissions p
        WHERE rp.role_id = r.id
          AND rp.permission_id = p.id
          AND r.key = 'super_admin'
          AND p.key = 'platform.manage'
    """)
    op.execute("""
        UPDATE roles
        SET description = 'Organization administration without Super Admin authority'
        WHERE key = 'super_admin'
    """)
