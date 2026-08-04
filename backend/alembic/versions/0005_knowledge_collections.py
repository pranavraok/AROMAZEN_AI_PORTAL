"""Create department-scoped knowledge collections."""

from alembic import op
import sqlalchemy as sa

revision = "0005_knowledge_collections"
down_revision = "0004_role_permission_matrix"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("knowledge_collections", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False), sa.Column("name", sa.String(160), nullable=False), sa.Column("slug", sa.String(160), nullable=False), sa.Column("description", sa.String(500), nullable=True), sa.Column("is_shared", sa.Boolean(), nullable=False, server_default=sa.false()), sa.Column("created_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")))
    op.create_index("ix_knowledge_collections_organization_id", "knowledge_collections", ["organization_id"])
    op.create_unique_constraint("uq_knowledge_collections_org_slug", "knowledge_collections", ["organization_id", "slug"])
    op.create_table("collection_departments", sa.Column("collection_id", sa.Uuid(), sa.ForeignKey("knowledge_collections.id", ondelete="CASCADE"), primary_key=True), sa.Column("department_id", sa.Uuid(), sa.ForeignKey("departments.id", ondelete="CASCADE"), primary_key=True))
    op.execute("""INSERT INTO knowledge_collections (id, organization_id, name, slug, description, is_shared)
        SELECT gen_random_uuid(), o.id, 'Shared Company Knowledge', 'shared-company-knowledge', 'Company-wide policies, approved references, and shared resources.', true FROM organizations o
        ON CONFLICT (organization_id, slug) DO NOTHING""")
    for name, slug, description, departments in [
        ("Production SOPs", "production-sops", "Production standard operating procedures and batch documentation.", ["production"]),
        ("R&D Formulations", "rnd-formulations", "Research, formulation, and technical development knowledge.", ["r-d"]),
        ("HR Policies", "hr-policies", "Human resources, accounts, and people policies.", ["accounts-hr"]),
        ("Marketing Assets", "marketing-assets", "Approved marketing content and visual brand assets.", ["marketing", "graphics"]),
    ]:
        op.execute(f"""INSERT INTO knowledge_collections (id, organization_id, name, slug, description, is_shared)
            SELECT gen_random_uuid(), o.id, '{name}', '{slug}', '{description}', false FROM organizations o
            ON CONFLICT (organization_id, slug) DO NOTHING""")
        for department_slug in departments:
            op.execute(f"""INSERT INTO collection_departments (collection_id, department_id)
                SELECT c.id, d.id FROM knowledge_collections c JOIN departments d ON d.organization_id = c.organization_id
                WHERE c.slug = '{slug}' AND d.slug = '{department_slug}' ON CONFLICT DO NOTHING""")


def downgrade() -> None:
    op.drop_table("collection_departments")
    op.drop_table("knowledge_collections")
