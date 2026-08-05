"""Present the legacy owner role as Super Admin and the organization role as Admin."""

from alembic import op

revision = "0012_super_admin_role_labels"
down_revision = "0011_document_generator"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE roles SET name = 'Super Admin', description = 'Full platform control and highest-level administration' WHERE key = 'owner'")
    op.execute("UPDATE roles SET name = 'Admin', description = 'Organization administration without Super Admin authority' WHERE key = 'super_admin'")


def downgrade() -> None:
    op.execute("UPDATE roles SET name = 'Owner', description = 'Full platform control' WHERE key = 'owner'")
    op.execute("UPDATE roles SET name = 'Super Admin', description = 'Organization administration' WHERE key = 'super_admin'")
