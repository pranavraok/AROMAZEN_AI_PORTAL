"""Align departments and knowledge collections with the operating structure."""

from alembic import op


revision = "0019_dept_collection_structure"
down_revision = "0018_payroll_delivery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Preserve existing assignments while replacing legacy department labels.
    op.execute("UPDATE departments SET name = 'AI Labs', slug = 'ai-labs' WHERE slug = 'ai-lab'")
    op.execute("UPDATE departments SET name = 'Creation Labs', slug = 'creation-labs' WHERE slug = 'creation-lab'")
    op.execute("UPDATE departments SET name = 'Inventory', slug = 'inventory' WHERE slug = 'stores'")
    op.execute("UPDATE departments SET name = 'Human Resources', slug = 'human-resources' WHERE slug = 'accounts-hr'")

    # Every organization receives the complete ten-department structure.
    for name, slug in [
        ("AI Labs", "ai-labs"),
        ("Production", "production"),
        ("Creation Labs", "creation-labs"),
        ("R&D", "r-d"),
        ("Inventory", "inventory"),
        ("Sourcing", "sourcing"),
        ("Marketing", "marketing"),
        ("Accounts", "accounts"),
        ("Human Resources", "human-resources"),
        ("Graphics", "graphics"),
    ]:
        op.execute(
            f"""INSERT INTO departments (id, organization_id, name, slug)
            SELECT gen_random_uuid(), o.id, '{name}', '{slug}'
            FROM organizations o
            WHERE NOT EXISTS (
                SELECT 1 FROM departments d
                WHERE d.organization_id = o.id AND d.slug = '{slug}'
            )"""
        )

    # Keep the existing collection rows and documents, but give the active
    # Knowledge Base its seven canonical groups.
    op.execute("""UPDATE knowledge_documents d
        SET collection_id = hr.id
        FROM knowledge_collections shared, knowledge_collections hr
        WHERE d.collection_id = shared.id
          AND shared.organization_id = hr.organization_id
          AND shared.slug = 'shared-company-knowledge'
          AND hr.slug = 'hr-policies'""")
    op.execute("""UPDATE knowledge_collections
        SET name = 'AI Labs & Graphics', slug = 'ai-labs-graphics',
            description = 'AI research, automation, design systems, graphics, and approved visual resources.',
            is_shared = false, status = 'active'
        WHERE slug = 'shared-company-knowledge'""")
    op.execute("""UPDATE knowledge_collections
        SET name = 'Production, Inventory & Sourcing', slug = 'production-inventory-sourcing',
            description = 'Production procedures, inventory controls, sourcing references, batch documentation, and operational standards.',
            is_shared = false, status = 'active'
        WHERE slug = 'production-sops'""")
    op.execute("""UPDATE knowledge_collections
        SET name = 'R&D', slug = 'r-d',
            description = 'Research, formulation, trials, technical development, COA, SDS, and laboratory knowledge.',
            is_shared = false, status = 'active'
        WHERE slug = 'rnd-formulations'""")
    op.execute("""UPDATE knowledge_collections
        SET name = 'Marketing', slug = 'marketing',
            description = 'Campaigns, market research, approved content, and marketing resources.',
            is_shared = false, status = 'active'
        WHERE slug = 'marketing-assets'""")
    op.execute("""UPDATE knowledge_collections
        SET name = 'Human Resources', slug = 'human-resources',
            description = 'Employee records, HR policies, payroll references, compliance, and people operations.',
            is_shared = false, status = 'active'
        WHERE slug = 'hr-policies'""")

    for name, slug, description in [
        ("Creation Labs", "creation-labs", "Fragrance concepts, creation briefs, evaluations, trials, and approved creative laboratory knowledge."),
        ("Accounts", "accounts", "Finance, accounting, billing, taxation, reporting, and approved commercial records."),
    ]:
        escaped_description = description.replace("'", "''")
        op.execute(
            f"""INSERT INTO knowledge_collections
                (id, organization_id, name, slug, description, is_shared, status)
            SELECT gen_random_uuid(), o.id, '{name}', '{slug}', '{escaped_description}', false, 'active'
            FROM organizations o
            WHERE NOT EXISTS (
                SELECT 1 FROM knowledge_collections c
                WHERE c.organization_id = o.id AND c.slug = '{slug}'
            )"""
        )

    canonical_collection_slugs = (
        "'ai-labs-graphics', 'production-inventory-sourcing', 'creation-labs', "
        "'r-d', 'marketing', 'accounts', 'human-resources'"
    )
    op.execute(
        f"""DELETE FROM collection_departments cd
        USING knowledge_collections c
        WHERE cd.collection_id = c.id AND c.slug IN ({canonical_collection_slugs})"""
    )

    mappings = {
        "ai-labs-graphics": ("ai-labs", "graphics"),
        "production-inventory-sourcing": ("production", "inventory", "sourcing"),
        "creation-labs": ("creation-labs",),
        "r-d": ("r-d",),
        "marketing": ("marketing",),
        "accounts": ("accounts",),
        "human-resources": ("human-resources",),
    }
    for collection_slug, department_slugs in mappings.items():
        slug_list = ", ".join(f"'{slug}'" for slug in department_slugs)
        op.execute(
            f"""INSERT INTO collection_departments (collection_id, department_id)
            SELECT c.id, d.id
            FROM knowledge_collections c
            JOIN departments d ON d.organization_id = c.organization_id
            WHERE c.slug = '{collection_slug}' AND d.slug IN ({slug_list})
            ON CONFLICT DO NOTHING"""
        )


def downgrade() -> None:
    # This is an organization data migration; reversing it could orphan new
    # department assignments and documents created after deployment.
    pass
