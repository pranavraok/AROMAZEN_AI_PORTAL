from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


LeadStatus = Literal[
    "submitted", "clarification_required", "resubmitted", "accepted", "rejected"
]
LeadPriority = Literal["hot", "warm", "cold"]


class RequestModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class CreateMarketingLeadRequest(RequestModel):
    company_name: str = Field(min_length=2, max_length=240)
    contact_person: str = Field(min_length=2, max_length=160)
    phone_number: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    country: str = Field(default="", max_length=120)
    region: str = Field(min_length=2, max_length=160)
    product_interest: str = Field(min_length=2, max_length=300)
    expected_quantity: str | None = Field(default=None, max_length=160)
    lead_source: str = Field(min_length=2, max_length=120)
    priority: LeadPriority = "warm"
    requirement: str = Field(min_length=5, max_length=5000)
    notes: str | None = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def require_contact_method(self):
        if not (self.phone_number and self.phone_number.strip()) and self.email is None:
            raise ValueError("Add at least a phone number or email address.")
        return self


class LeadDecisionRequest(RequestModel):
    action: Literal["accept", "reject", "question"]
    message: str | None = Field(default=None, max_length=3000)

    @model_validator(mode="after")
    def require_explanation(self):
        if self.action in {"reject", "question"} and not (self.message and self.message.strip()):
            raise ValueError("Add a reason or question before sending this response.")
        return self


class LeadReplyRequest(RequestModel):
    message: str = Field(min_length=2, max_length=3000)


class MarketingLeadActivityResponse(BaseModel):
    id: str
    action: str
    message: str | None
    actor_name: str
    actor_department: str | None
    created_at: datetime


class MarketingLeadResponse(BaseModel):
    id: str
    company_name: str
    contact_person: str
    phone_number: str | None
    email: str | None
    country: str
    region: str
    product_interest: str
    expected_quantity: str | None
    lead_source: str
    priority: LeadPriority
    requirement: str
    notes: str | None
    status: LeadStatus
    created_by_user_id: str | None
    created_by_name: str
    decision_reason: str | None
    decided_by_name: str | None
    first_merchandising_response_at: datetime | None
    decided_at: datetime | None
    submitted_at: datetime
    updated_at: datetime
    activities: list[MarketingLeadActivityResponse]


class MarketingLeadListResponse(BaseModel):
    items: list[MarketingLeadResponse]
    counts: dict[str, int]


class MarketingReportRow(BaseModel):
    label: str
    total: int
    accepted: int
    rejected: int
    clarification_required: int
    pending: int
    acceptance_rate: float


class MarketingBreakdownRow(BaseModel):
    label: str
    count: int


class MarketingMonthlyReport(BaseModel):
    month: str
    total: int
    accepted: int
    rejected: int
    clarification_required: int
    pending: int
    acceptance_rate: float
    average_response_hours: float | None
    employees: list[MarketingReportRow]
    regions: list[MarketingReportRow]
    lead_sources: list[MarketingBreakdownRow]
    product_interests: list[MarketingBreakdownRow]
    rejection_reasons: list[MarketingBreakdownRow]
