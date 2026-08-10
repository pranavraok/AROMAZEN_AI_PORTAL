import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ITAsset(Base):
    __tablename__ = "it_assets"
    __table_args__ = (UniqueConstraint("organization_id", "asset_key", name="uq_it_assets_org_key"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    asset_key: Mapped[str] = mapped_column(String(500))
    source_sn: Mapped[str | None] = mapped_column(String(80), nullable=True)
    employee: Mapped[str | None] = mapped_column(String(240), nullable=True)
    physical_location: Mapped[str | None] = mapped_column(String(240), nullable=True)
    department_name: Mapped[str | None] = mapped_column(String(240), nullable=True)
    home_office: Mapped[str | None] = mapped_column(String(160), nullable=True)
    category: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    brand: Mapped[str | None] = mapped_column(String(160), nullable=True)
    model: Mapped[str | None] = mapped_column(String(240), nullable=True)
    serial_imei: Mapped[str | None] = mapped_column(String(240), nullable=True)
    sim_no: Mapped[str | None] = mapped_column(String(160), nullable=True)
    ups: Mapped[str | None] = mapped_column(String(240), nullable=True)
    label_no: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    invoice_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    invoice_date_raw: Mapped[str | None] = mapped_column(String(160), nullable=True)
    invoice_no: Mapped[str | None] = mapped_column(String(240), nullable=True)
    supplier_name: Mapped[str | None] = mapped_column(String(240), nullable=True)
    price: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    price_raw: Mapped[str | None] = mapped_column(String(160), nullable=True)
    warranty: Mapped[str | None] = mapped_column(String(160), nullable=True)

    status: Mapped[str] = mapped_column(String(60), default="Active", index=True)
    condition: Mapped[str] = mapped_column(String(40), default="Good")
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    last_maintenance_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    next_maintenance_date: Mapped[date | None] = mapped_column(Date(), nullable=True, index=True)
    maintenance_interval_months: Mapped[int | None] = mapped_column(nullable=True)
    maintenance_reminder_days: Mapped[int] = mapped_column(default=30)
    maintenance_owner: Mapped[str | None] = mapped_column(String(160), nullable=True)
    maintenance_notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    scrap_reason: Mapped[str | None] = mapped_column(Text(), nullable=True)
    scrap_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    scrap_value: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AssetMaintenanceEvent(Base):
    __tablename__ = "asset_maintenance_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    asset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("it_assets.id", ondelete="CASCADE"), index=True)
    service_date: Mapped[date] = mapped_column(Date())
    vendor: Mapped[str | None] = mapped_column(String(240), nullable=True)
    cost: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    next_due_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

