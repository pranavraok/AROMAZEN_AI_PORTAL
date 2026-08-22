"""Create the predefined portal template collection and consolidate template documents."""

from alembic import op
import sqlalchemy as sa


revision = "0030_portal_templates"
down_revision = "0029_backfill_dept_collections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO knowledge_collections
            (id, organization_id, name, slug, description, is_shared, status)
        SELECT
            gen_random_uuid(),
            o.id,
            'Portal Templates',
            'portal-templates',
            'System-managed source of truth for templates uploaded through the portal.',
            false,
            'active'
        FROM organizations o
        WHERE NOT EXISTS (
            SELECT 1 FROM knowledge_collections kc
            WHERE kc.organization_id = o.id AND kc.slug = 'portal-templates'
        )
    """)
    op.execute("""
        INSERT INTO collection_departments (collection_id, department_id)
        SELECT DISTINCT target.id, cd.department_id
        FROM knowledge_documents kd
        JOIN knowledge_collections source ON source.id = kd.collection_id
        JOIN knowledge_collections target
          ON target.organization_id = kd.organization_id
         AND target.slug = 'portal-templates'
        JOIN collection_departments cd ON cd.collection_id = source.id
        WHERE kd.document_category = 'salary_slip_template'
           OR kd.document_category LIKE 'hr_letter_template:%'
           OR (lower(kd.original_filename) LIKE '%.docx' AND (source.slug = 'r-d' OR source.name ILIKE '%R&D%'))
        ON CONFLICT DO NOTHING
    """)
    op.execute("""
        UPDATE knowledge_documents kd
        SET document_category = 'document_template'
        FROM knowledge_collections source
        WHERE source.id = kd.collection_id
          AND lower(kd.original_filename) LIKE '%.docx'
          AND (source.slug = 'r-d' OR source.name ILIKE '%R&D%')
          AND (kd.document_category IS NULL OR kd.document_category NOT LIKE 'hr_letter_template:%')
    """)
    op.execute("""
        UPDATE knowledge_documents kd
        SET collection_id = kc.id
        FROM knowledge_collections kc
        WHERE kc.organization_id = kd.organization_id
          AND kc.slug = 'portal-templates'
          AND (
              kd.document_category = 'salary_slip_template'
              OR kd.document_category LIKE 'hr_letter_template:%'
              OR kd.document_category = 'document_template'
          )
    """)
    op.execute("""
        INSERT INTO collection_departments (collection_id, department_id)
        SELECT kc.id, d.id
        FROM knowledge_collections kc
        JOIN departments d ON d.organization_id = kc.organization_id AND d.slug IN ('hr', 'r-d')
        WHERE kc.slug = 'portal-templates'
          AND NOT EXISTS (
              SELECT 1 FROM collection_departments cd
              WHERE cd.collection_id = kc.id AND cd.department_id = d.id
          )
    """)
    op.create_index(
        "uq_knowledge_collections_portal_templates_org",
        "knowledge_collections",
        ["organization_id"],
        unique=True,
        postgresql_where=sa.text("slug = 'portal-templates'"),
        sqlite_where=sa.text("slug = 'portal-templates'"),
    )


def downgrade() -> None:
    op.drop_index("uq_knowledge_collections_portal_templates_org", table_name="knowledge_collections")
