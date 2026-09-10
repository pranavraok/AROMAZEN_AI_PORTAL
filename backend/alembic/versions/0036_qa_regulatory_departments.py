"""Add Quality Assurance and Regulatory departments and knowledge collections."""

from alembic import op


revision = "0036_qa_regulatory_departments"
down_revision = "0035_knowledge_external_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE departments
        SET name = 'Quality Assurance', slug = 'quality-assurance'
        WHERE slug IN ('qa', 'qa-qc', 'qa-and-qc', 'quality-assurance-quality-control')
          AND NOT EXISTS (
              SELECT 1 FROM departments canonical
              WHERE canonical.organization_id = departments.organization_id
                AND canonical.slug = 'quality-assurance'
          )
    """)
    for name, slug in (("Quality Assurance", "quality-assurance"), ("Regulatory", "regulatory")):
        op.execute(f"""
            INSERT INTO departments (id, organization_id, name, slug)
            SELECT gen_random_uuid(), o.id, '{name}', '{slug}'
            FROM organizations o
            WHERE NOT EXISTS (
                SELECT 1 FROM departments d
                WHERE d.organization_id = o.id AND d.slug = '{slug}'
            )
        """)
        op.execute(f"""
            INSERT INTO knowledge_collections
                (id, organization_id, name, slug, description, is_shared, status)
            SELECT gen_random_uuid(), o.id, '{name}', '{slug}',
                   'Knowledge base for the {name} department.', false, 'active'
            FROM organizations o
            WHERE NOT EXISTS (
                SELECT 1 FROM knowledge_collections c
                WHERE c.organization_id = o.id AND c.slug = '{slug}' AND c.status = 'active'
            )
        """)
        op.execute(f"""
            INSERT INTO collection_departments (collection_id, department_id)
            SELECT c.id, d.id
            FROM knowledge_collections c
            JOIN departments d ON d.organization_id = c.organization_id
            WHERE c.slug = '{slug}' AND c.status = 'active' AND d.slug = '{slug}'
            ON CONFLICT DO NOTHING
        """)


def downgrade() -> None:
    pass
