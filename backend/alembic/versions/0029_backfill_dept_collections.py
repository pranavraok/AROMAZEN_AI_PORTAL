"""Backfill knowledge collections for departments that lack one."""

from alembic import op


revision = "0029_backfill_dept_collections"
down_revision = "0028_knowledge_doc_company_wide"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # For every department that has no linked collection, create one.
    op.execute("""
        INSERT INTO knowledge_collections
            (id, organization_id, name, slug, description, is_shared, status)
        SELECT
            gen_random_uuid(),
            d.organization_id,
            d.name,
            d.slug,
            'Knowledge base for the ' || d.name || ' department.',
            false,
            'active'
        FROM departments d
        WHERE NOT EXISTS (
            SELECT 1
            FROM collection_departments cd
            JOIN knowledge_collections kc ON kc.id = cd.collection_id
            WHERE cd.department_id = d.id
              AND kc.status = 'active'
        )
    """)

    # Link each newly created collection to its department.
    op.execute("""
        INSERT INTO collection_departments (collection_id, department_id)
        SELECT kc.id, d.id
        FROM knowledge_collections kc
        JOIN departments d
          ON d.organization_id = kc.organization_id
          AND d.slug = kc.slug
        WHERE kc.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM collection_departments cd
            WHERE cd.collection_id = kc.id AND cd.department_id = d.id
          )
    """)


def downgrade() -> None:
    pass
