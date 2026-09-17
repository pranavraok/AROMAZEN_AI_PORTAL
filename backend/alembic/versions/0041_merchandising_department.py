"""Add the Merchandising department and knowledge collection."""

from alembic import op


revision = "0041_merchandising_department"
down_revision = "0040_payroll_bonus_slips"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO departments (id, organization_id, name, slug)
        SELECT gen_random_uuid(), o.id, 'Merchandising', 'merchandising'
        FROM organizations o
        WHERE NOT EXISTS (
            SELECT 1 FROM departments d
            WHERE d.organization_id = o.id AND d.slug = 'merchandising'
        )
    """)
    op.execute("""
        INSERT INTO knowledge_collections
            (id, organization_id, name, slug, description, is_shared, status)
        SELECT gen_random_uuid(), o.id, 'Merchandising', 'merchandising',
               'Knowledge base for Merchandising export document masters.', false, 'active'
        FROM organizations o
        WHERE NOT EXISTS (
            SELECT 1 FROM knowledge_collections c
            WHERE c.organization_id = o.id AND c.slug = 'merchandising' AND c.status = 'active'
        )
    """)
    op.execute("""
        INSERT INTO collection_departments (collection_id, department_id)
        SELECT c.id, d.id
        FROM knowledge_collections c
        JOIN departments d ON d.organization_id = c.organization_id
        WHERE c.slug = 'merchandising' AND c.status = 'active' AND d.slug = 'merchandising'
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    pass

