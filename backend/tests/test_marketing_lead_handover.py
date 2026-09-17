from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.modules.marketing_leads.routes import _breakdown, _month_bounds, _performance_rows
from app.modules.marketing_leads.schemas import (
    CreateMarketingLeadRequest,
    LeadDecisionRequest,
)


def test_lead_requires_at_least_one_contact_method() -> None:
    with pytest.raises(ValidationError, match="phone number or email"):
        CreateMarketingLeadRequest(
            company_name="Cedar & Sage",
            contact_person="Anita Rao",
            region="South",
            product_interest="Fine fragrance",
            lead_source="Field visit",
            requirement="Needs a sandalwood fragrance sample.",
        )


def test_question_and_rejection_require_meaningful_text() -> None:
    with pytest.raises(ValidationError, match="reason or question"):
        LeadDecisionRequest(action="question", message="   ")
    assert LeadDecisionRequest(action="accept").action == "accept"


def test_month_bounds_roll_december_into_next_year() -> None:
    start, end = _month_bounds("2026-12")
    assert start.isoformat() == "2026-12-01T00:00:00+00:00"
    assert end.isoformat() == "2027-01-01T00:00:00+00:00"


def test_performance_report_uses_completed_decisions_for_acceptance_rate() -> None:
    employee_id = uuid4()
    leads = [
        SimpleNamespace(created_by_user_id=employee_id, status="accepted"),
        SimpleNamespace(created_by_user_id=employee_id, status="rejected"),
        SimpleNamespace(created_by_user_id=employee_id, status="submitted"),
    ]
    row = _performance_rows(leads, labels={employee_id: "Asha"})[0]
    assert row.total == 3
    assert row.pending == 1
    assert row.acceptance_rate == 50.0


def test_breakdown_groups_repeated_and_missing_values() -> None:
    rows = _breakdown(["Referral", "Referral", None])
    assert [(row.label, row.count) for row in rows] == [
        ("Referral", 2),
        ("Not specified", 1),
    ]
