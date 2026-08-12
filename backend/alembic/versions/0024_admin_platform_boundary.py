"""Reserve platform controls for the Super Admin."""

from alembic import op


revision = "0024_admin_platform_boundary"
down_revision = "0023_it_asset_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
        SET description = 'Full organization administration; platform controls remain with the Super Admin'
        WHERE key = 'super_admin'
    """)


def downgrade() -> None:
    op.execute("""
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        CROSS JOIN permissions p
        WHERE r.key = 'super_admin'
          AND p.key = 'platform.manage'
        ON CONFLICT DO NOTHING
    """)
    op.execute("""
        UPDATE roles
        SET description = 'Full organization administration with protected Super Admin safeguards'
        WHERE key = 'super_admin'
    """)
