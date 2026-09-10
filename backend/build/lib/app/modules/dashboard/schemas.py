from datetime import datetime

from pydantic import BaseModel


class DashboardMetric(BaseModel):
    key: str
    label: str
    value: float
    format: str = "number"


class DashboardDepartmentUsage(BaseModel):
    department: str
    requests: int
    cost: float


class DashboardDocument(BaseModel):
    id: str
    name: str
    collection: str
    uploader: str
    status: str
    version: int
    created_at: datetime


class DashboardActivity(BaseModel):
    id: str
    actor: str
    action: str
    department: str
    created_at: datetime


class HRActionItem(BaseModel):
    key: str
    title: str
    description: str
    href: str
    tone: str = "default"
    count: int | None = None


class HRActionCenter(BaseModel):
    due_reminders: int
    overdue_documents: int
    rule_documents: int
    open_payroll_batches: int
    items: list[HRActionItem]


class DashboardOverview(BaseModel):
    currency: str
    usd_to_inr_rate: float
    exchange_rate_source: str
    exchange_rate_updated_at: datetime
    role_key: str
    role_label: str
    scope: str
    scope_label: str
    capabilities: list[str]
    metrics: list[DashboardMetric]
    department_usage: list[DashboardDepartmentUsage]
    recent_documents: list[DashboardDocument]
    recent_activity: list[DashboardActivity]
    hr_action_center: HRActionCenter | None = None
    refreshed_at: datetime
