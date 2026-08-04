"""Map every department to the right shared knowledge collection."""

from alembic import op

revision = "0009_dept_knowledge_map"
down_revision = "0008_knowledge_governance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""UPDATE knowledge_collections SET description = 'Company-wide policies, approved references, templates, and shared resources for every department.' WHERE slug = 'shared-company-knowledge'""")
    op.execute("""UPDATE knowledge_collections SET description = 'Production procedures, stores controls, sourcing references, batch documentation, and operational standards.' WHERE slug = 'production-sops'""")
    op.execute("""UPDATE knowledge_collections SET description = 'AI Lab, Creation Lab, and R&D research, formulation, innovation, and technical development knowledge.' WHERE slug = 'rnd-formulations'""")
    op.execute("""UPDATE knowledge_collections SET description = 'Accounts, HR, employee, compliance, and people-policy knowledge.' WHERE slug = 'hr-policies'""")
    op.execute("""UPDATE knowledge_collections SET description = 'Marketing campaigns, approved brand content, graphics, and visual assets.' WHERE slug = 'marketing-assets'""")
    op.execute("""INSERT INTO collection_departments (collection_id, department_id)
        SELECT c.id, d.id FROM knowledge_collections c JOIN departments d ON d.organization_id = c.organization_id
        WHERE c.slug = 'production-sops' AND d.slug IN ('production', 'stores', 'sourcing') ON CONFLICT DO NOTHING""")
    op.execute("""INSERT INTO collection_departments (collection_id, department_id)
        SELECT c.id, d.id FROM knowledge_collections c JOIN departments d ON d.organization_id = c.organization_id
        WHERE c.slug = 'rnd-formulations' AND d.slug IN ('ai-lab', 'creation-lab', 'r-d') ON CONFLICT DO NOTHING""")
    op.execute("""INSERT INTO collection_departments (collection_id, department_id)
        SELECT c.id, d.id FROM knowledge_collections c JOIN departments d ON d.organization_id = c.organization_id
        WHERE c.slug = 'hr-policies' AND d.slug = 'accounts-hr' ON CONFLICT DO NOTHING""")
    op.execute("""INSERT INTO collection_departments (collection_id, department_id)
        SELECT c.id, d.id FROM knowledge_collections c JOIN departments d ON d.organization_id = c.organization_id
        WHERE c.slug = 'marketing-assets' AND d.slug IN ('marketing', 'graphics') ON CONFLICT DO NOTHING""")


def downgrade() -> None:
    pass
