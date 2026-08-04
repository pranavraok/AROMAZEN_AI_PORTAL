"""Allow shared email identities when a unique phone is supplied."""

from alembic import op
import sqlalchemy as sa

revision = "0003_shared_email_phone_identity"
down_revision = "0002_user_administration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone_number", sa.String(32), nullable=True))
    op.drop_constraint("users_email_key", "users", type_="unique")
    op.create_index("ix_users_phone_number", "users", ["phone_number"], unique=True)
    op.create_unique_constraint("uq_users_organization_email_phone", "users", ["organization_id", "email", "phone_number"])
    op.execute("CREATE UNIQUE INDEX uq_users_org_email_without_phone ON users (organization_id, email) WHERE phone_number IS NULL")


def downgrade() -> None:
    op.drop_constraint("uq_users_organization_email_phone", "users", type_="unique")
    op.drop_index("ix_users_phone_number", table_name="users")
    op.execute("DROP INDEX IF EXISTS uq_users_org_email_without_phone")
    op.create_unique_constraint("users_email_key", "users", ["email"])
    op.drop_column("users", "phone_number")
