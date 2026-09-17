"""Add Marketing to Merchandising lead handover workflow."""

from alembic import op
import sqlalchemy as sa

revision = "0042_marketing_lead_handover"
down_revision = "0041_merchandising_department"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "marketing_leads",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("company_name", sa.String(240), nullable=False),
        sa.Column("contact_person", sa.String(160), nullable=False),
        sa.Column("phone_number", sa.String(40), nullable=True),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("country", sa.String(120), nullable=False, server_default=""),
        sa.Column("region", sa.String(160), nullable=False),
        sa.Column("product_interest", sa.String(300), nullable=False),
        sa.Column("expected_quantity", sa.String(160), nullable=True),
        sa.Column("lead_source", sa.String(120), nullable=False),
        sa.Column("priority", sa.String(20), nullable=False, server_default="warm"),
        sa.Column("requirement", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(40), nullable=False, server_default="submitted"),
        sa.Column("decided_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("decision_reason", sa.Text(), nullable=True),
        sa.Column("first_merchandising_response_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('submitted','clarification_required','resubmitted','accepted','rejected')", name="ck_marketing_leads_status"),
        sa.CheckConstraint("priority IN ('hot','warm','cold')", name="ck_marketing_leads_priority"),
    )
    for column in ("organization_id", "created_by_user_id", "region", "product_interest", "lead_source", "priority", "status", "submitted_at"):
        op.create_index(f"ix_marketing_leads_{column}", "marketing_leads", [column])

    op.create_table(
        "marketing_lead_activities",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("lead_id", sa.Uuid(), sa.ForeignKey("marketing_leads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    for column in ("organization_id", "lead_id", "action", "created_at"):
        op.create_index(f"ix_marketing_lead_activities_{column}", "marketing_lead_activities", [column])


def downgrade() -> None:
    op.drop_table("marketing_lead_activities")
    op.drop_table("marketing_leads")
