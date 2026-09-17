from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


LeadStatus = Literal[
    "submitted", "clarification_required", "resubmitted", "accepted", "rejected"
]
LeadPriority = Literal["hot", "warm", "cold"]
SampleStatus = Literal[
    "recorded", "dispatched", "awaiting_feedback", "satisfied",
    "not_satisfied", "order_received", "closed",
]


class RequestModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class MarketingSampleItemRequest(RequestModel):
    fragrance_name: str = Field(min_length=2, max_length=300)
    fragrance_code: str | None = Field(default=None, max_length=120)
    application: str | None = Field(default=None, max_length=200)
    quantity: str | None = Field(default=None, max_length=160)
    cost: str | None = Field(default=None, max_length=120)


class LeadSampleRequest(RequestModel):
    serial_number: str | None = Field(default=None, max_length=80)
    sample_date: date
    remark: str | None = Field(default=None, max_length=5000)
    items: list[MarketingSampleItemRequest] = Field(min_length=1, max_length=50)


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
    sample: LeadSampleRequest | None = None

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


class MarketingSampleItemResponse(BaseModel):
    id: str
    fragrance_name: str
    fragrance_code: str | None
    application: str | None
    quantity: str | None
    cost: str | None
    position: int


class MarketingSampleResponse(BaseModel):
    id: str
    linked_lead_id: str | None
    serial_number: str | None
    sample_date: date
    company_name: str
    remark: str | None
    status: SampleStatus
    created_by_user_id: str | None
    created_by_name: str
    created_at: datetime
    updated_at: datetime
    items: list[MarketingSampleItemResponse]


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
    samples: list[MarketingSampleResponse]


class MarketingLeadListResponse(BaseModel):
    items: list[MarketingLeadResponse]
    counts: dict[str, int]


class CreateMarketingSampleRequest(RequestModel):
    linked_lead_id: UUID | None = None
    serial_number: str | None = Field(default=None, max_length=80)
    sample_date: date
    company_name: str = Field(min_length=2, max_length=240)
    remark: str | None = Field(default=None, max_length=5000)
    status: SampleStatus = "awaiting_feedback"
    items: list[MarketingSampleItemRequest] = Field(min_length=1, max_length=50)


class UpdateMarketingSampleRequest(RequestModel):
    status: SampleStatus
    remark: str | None = Field(default=None, max_length=5000)


class MarketingSampleListResponse(BaseModel):
    items: list[MarketingSampleResponse]
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


class MarketingAnalysisSummary(BaseModel):
    total_leads: int
    pending_review: int
    clarification_required: int
    accepted: int
    rejected: int
    decision_rate: float
    acceptance_rate: float
    average_response_hours: float | None
    total_samples: int
    sample_items: int
    awaiting_feedback: int
    satisfied: int
    orders_received: int
    sample_to_order_rate: float
    leads_today: int
    samples_today: int


class MarketingAnalysisEmployee(BaseModel):
    employee_id: str
    employee_name: str
    total_leads: int
    accepted: int
    rejected: int
    clarification_required: int
    pending: int
    decision_rate: float
    acceptance_rate: float
    average_response_hours: float | None
    sample_batches: int
    sample_items: int
    awaiting_feedback: int
    satisfied: int
    orders_received: int
    sample_to_order_rate: float
    last_activity_at: datetime | None


class MarketingAnalysisFeedItem(BaseModel):
    id: str
    kind: Literal["lead", "lead_activity", "sample"]
    title: str
    detail: str
    status: str
    actor_name: str
    employee_name: str
    occurred_at: datetime


class MarketingLiveAnalysis(BaseModel):
    generated_at: datetime
    range_days: int
    period_label: str
    summary: MarketingAnalysisSummary
    employees: list[MarketingAnalysisEmployee]
    regions: list[MarketingReportRow]
    lead_sources: list[MarketingBreakdownRow]
    product_interests: list[MarketingBreakdownRow]
    sample_applications: list[MarketingBreakdownRow]
    recent_activity: list[MarketingAnalysisFeedItem]
