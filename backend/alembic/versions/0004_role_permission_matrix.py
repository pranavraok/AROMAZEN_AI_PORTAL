"""Apply the operational default RBAC matrix."""

from alembic import op

revision = "0004_role_permission_matrix"
down_revision = "0003_shared_email_phone_identity"
branch_labels = None
depends_on = None


PERMISSIONS = [
    ("departments.manage", "Manage departments"),
    ("audit.read", "Read audit log"),
    ("settings.manage", "Manage organization settings"),
]
ROLE_PERMISSIONS = {
    "owner": ["platform.manage", "users.manage", "roles.manage", "knowledge.read", "knowledge.write", "ai.workspace.use", "usage.read", "departments.manage", "audit.read", "settings.manage"],
    "super_admin": ["users.manage", "roles.manage", "knowledge.read", "knowledge.write", "ai.workspace.use", "usage.read", "departments.manage", "audit.read", "settings.manage"],
    "department_admin": ["users.manage", "knowledge.read", "knowledge.write", "ai.workspace.use", "audit.read"],
    "employee": ["knowledge.read", "ai.workspace.use"],
}


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    for key, name in PERMISSIONS:
        op.execute(f"INSERT INTO permissions (id, key, name) VALUES (gen_random_uuid(), '{key}', '{name}') ON CONFLICT (key) DO NOTHING")
    for role_key, permission_keys in ROLE_PERMISSIONS.items():
        for permission_key in permission_keys:
            op.execute(f"""INSERT INTO role_permissions (role_id, permission_id)
                SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
                WHERE r.key = '{role_key}' AND p.key = '{permission_key}'
                ON CONFLICT DO NOTHING""")


def downgrade() -> None:
    pass
