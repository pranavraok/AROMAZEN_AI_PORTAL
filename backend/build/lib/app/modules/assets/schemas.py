import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


AssetStatus = Literal["Active", "Spare", "Under maintenance", "Repair needed", "Recovery required", "Lost", "Scrap proposed", "Approved for scrap", "Scrapped", "Disposed"]
AssetCondition = Literal["Good", "Fair", "Poor", "Damaged", "Obsolete"]
AssetGroup = Literal["IT", "General"]


class AssetPayload(BaseModel):
    asset_group: AssetGroup = "General"
    source_register: str | None = None
    employee: str | None = None
    physical_location: str | None = None
    department_name: str | None = None
    home_office: str | None = None
    category: str | None = None
    brand: str | None = None
    model: str | None = None
    serial_imei: str | None = None
    sim_no: str | None = None
    ups: str | None = None
    label_no: str | None = None
    invoice_date: date | None = None
    invoice_no: str | None = None
    supplier_name: str | None = None
    price: float | None = Field(default=None, ge=0)
    warranty: str | None = None
    custom_fields: dict[str, str] = Field(default_factory=dict)
    status: AssetStatus = "Active"
    condition: AssetCondition = "Good"
    notes: str | None = None
    last_maintenance_date: date | None = None
    next_maintenance_date: date | None = None
    maintenance_interval_months: int | None = Field(default=None, ge=1, le=120)
    maintenance_reminder_days: int = Field(default=30, ge=0, le=365)
    notification_enabled: bool = True
    maintenance_owner: str | None = None
    maintenance_notes: str | None = None
    scrap_reason: str | None = None
    scrap_date: date | None = None
    scrap_value: float | None = Field(default=None, ge=0)


class AssetUpdatePayload(BaseModel):
    asset_group: AssetGroup | None = None
    source_register: str | None = None
    employee: str | None = None
    physical_location: str | None = None
    department_name: str | None = None
    home_office: str | None = None
    category: str | None = None
    brand: str | None = None
    model: str | None = None
    serial_imei: str | None = None
    sim_no: str | None = None
    ups: str | None = None
    label_no: str | None = None
    invoice_date: date | None = None
    invoice_no: str | None = None
    supplier_name: str | None = None
    price: float | None = Field(default=None, ge=0)
    warranty: str | None = None
    custom_fields: dict[str, str] | None = None
    status: AssetStatus | None = None
    condition: AssetCondition | None = None
    notes: str | None = None
    last_maintenance_date: date | None = None
    next_maintenance_date: date | None = None
    maintenance_interval_months: int | None = Field(default=None, ge=1, le=120)
    maintenance_reminder_days: int | None = Field(default=None, ge=0, le=365)
    notification_enabled: bool | None = None
    maintenance_owner: str | None = None
    maintenance_notes: str | None = None
    scrap_reason: str | None = None
    scrap_date: date | None = None
    scrap_value: float | None = Field(default=None, ge=0)


class AssetRead(AssetPayload):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    source_sn: str | None
    maintenance_state: Literal["overdue", "due", "scheduled", "not_scheduled"]
    maintenance_days_remaining: int | None
    created_at: datetime
    updated_at: datetime


class AssetSummary(BaseModel):
    total: int
    active: int
    spare: int
    maintenance_due: int
    maintenance_overdue: int
    repair_needed: int
    recovery_required: int
    scrap_queue: int
    scrapped_or_disposed: int
    total_value: float


class AssetListResponse(BaseModel):
    items: list[AssetRead]
    summary: AssetSummary
    categories: list[str]
    locations: list[str]
    departments: list[str]
    registers: list[str]
    group_counts: dict[str, int]


class MaintenancePayload(BaseModel):
    service_date: date
    vendor: str | None = None
    cost: float | None = Field(default=None, ge=0)
    notes: str | None = None
    next_due_date: date | None = None


class MaintenanceRead(MaintenancePayload):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    asset_id: uuid.UUID
    created_at: datetime


class AssetNotificationSettingsPayload(BaseModel):
    default_notification_enabled: bool = True
    default_reminder_days: int = Field(default=30, ge=0, le=365)
    default_maintenance_interval_months: int | None = Field(default=None, ge=1, le=120)
    notify_inventory_admin: bool = True
    notify_hr_admin: bool = True
    notify_accounts_admin: bool = True
    notify_admins: bool = True
    apply_to_current_assets: bool = False


class AssetNotificationSettingsRead(AssetNotificationSettingsPayload):
    apply_to_current_assets: bool = False
    updated_at: datetime | None = None
