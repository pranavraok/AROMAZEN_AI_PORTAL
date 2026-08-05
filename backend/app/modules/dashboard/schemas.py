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


class DashboardOverview(BaseModel):
    role_key: str
    role_label: str
    scope: str
    scope_label: str
    capabilities: list[str]
    metrics: list[DashboardMetric]
    department_usage: list[DashboardDepartmentUsage]
    recent_documents: list[DashboardDocument]
    recent_activity: list[DashboardActivity]
    refreshed_at: datetime
