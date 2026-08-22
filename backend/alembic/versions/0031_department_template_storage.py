"""Keep portal templates inside their automatically-created department KB collections."""

from alembic import op


revision = "0031_department_templates"
down_revision = "0030_portal_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_knowledge_collections_portal_templates_org")
    # R&D DOCX files were already treated as generator templates; classify them explicitly.
    op.execute("""
        UPDATE knowledge_documents kd
        SET document_category = 'document_template'
        FROM knowledge_collections kc
        WHERE kc.id = kd.collection_id
          AND lower(kd.original_filename) LIKE '%.docx'
          AND (kc.slug = 'r-d' OR kc.name ILIKE '%R&D%')
          AND (kd.document_category IS NULL OR kd.document_category NOT LIKE 'hr_letter_template:%')
    """)

    # Correct databases that briefly received a standalone Portal Templates collection.
    op.execute("""
        UPDATE knowledge_documents kd
        SET collection_id = target.id
        FROM knowledge_collections legacy,
             knowledge_collections target
             JOIN collection_departments cd ON cd.collection_id = target.id
             JOIN departments d ON d.id = cd.department_id
        WHERE kd.collection_id = legacy.id
          AND legacy.organization_id = kd.organization_id
          AND legacy.slug = 'portal-templates'
          AND target.organization_id = kd.organization_id
          AND target.status = 'active'
          AND target.slug != 'portal-templates'
          AND d.slug IN ('hr', 'human-resources')
          AND (kd.document_category = 'salary_slip_template' OR kd.document_category LIKE 'hr_letter_template:%')
    """)
    op.execute("""
        UPDATE knowledge_documents kd
        SET collection_id = target.id
        FROM knowledge_collections legacy,
             knowledge_collections target
             JOIN collection_departments cd ON cd.collection_id = target.id
             JOIN departments d ON d.id = cd.department_id
        WHERE kd.collection_id = legacy.id
          AND legacy.organization_id = kd.organization_id
          AND legacy.slug = 'portal-templates'
          AND target.organization_id = kd.organization_id
          AND target.status = 'active'
          AND target.slug != 'portal-templates'
          AND d.slug = 'r-d'
          AND kd.document_category = 'document_template'
    """)
    # Preserve any uncategorized files from that short-lived collection in HR (or R&D as fallback).
    op.execute("""
        UPDATE knowledge_documents kd
        SET collection_id = target.id
        FROM knowledge_collections legacy,
             knowledge_collections target
             JOIN collection_departments cd ON cd.collection_id = target.id
             JOIN departments d ON d.id = cd.department_id
        WHERE kd.collection_id = legacy.id
          AND legacy.slug = 'portal-templates'
          AND target.organization_id = kd.organization_id
          AND target.status = 'active'
          AND target.slug != 'portal-templates'
          AND d.slug IN ('hr', 'human-resources')
    """)
    op.execute("""
        UPDATE knowledge_documents kd
        SET collection_id = target.id
        FROM knowledge_collections legacy,
             knowledge_collections target
             JOIN collection_departments cd ON cd.collection_id = target.id
             JOIN departments d ON d.id = cd.department_id
        WHERE kd.collection_id = legacy.id
          AND legacy.slug = 'portal-templates'
          AND target.organization_id = kd.organization_id
          AND target.status = 'active'
          AND target.slug != 'portal-templates'
          AND d.slug = 'r-d'
    """)
    op.execute("""
        DELETE FROM knowledge_collections kc
        WHERE kc.slug = 'portal-templates'
          AND NOT EXISTS (
              SELECT 1 FROM knowledge_documents kd WHERE kd.collection_id = kc.id
          )
    """)


def downgrade() -> None:
    pass
