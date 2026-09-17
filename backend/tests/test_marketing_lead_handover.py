import io
from datetime import date, datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from openpyxl import load_workbook
from pydantic import ValidationError
from pypdf import PdfReader

from app.modules.marketing_leads.excel import build_merchandising_sample_requests_workbook
from app.modules.marketing_leads.pdf import build_marketing_employee_report
from app.modules.marketing_leads.routes import (
    _analysis_period,
    _breakdown,
    _can_view_marketing_report,
    _lead_access_scope,
    _month_bounds,
    _performance_rows,
    _rate,
)
from app.modules.marketing_leads.schemas import (
    CreateMarketingLeadRequest,
    CreateMarketingSampleRequest,
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


def test_customer_sample_uses_workbook_fields_with_only_core_values_required() -> None:
    sample = CreateMarketingSampleRequest(
        sample_date="2026-09-17",
        company_name="Cedar & Sage",
        items=[{"fragrance_name": "Sandal Wood Mysore"}],
    )
    assert sample.serial_number is None
    assert sample.items[0].fragrance_code is None
    assert sample.items[0].application is None
    assert sample.items[0].quantity is None
    assert sample.items[0].cost is None
    assert sample.remark is None


def test_lead_can_include_multiple_sample_rows_for_merchandising() -> None:
    lead = CreateMarketingLeadRequest(
        company_name="Cedar & Sage",
        contact_person="Anita Rao",
        phone_number="9999999999",
        region="South",
        product_interest="Fine fragrance",
        lead_source="Field visit",
        requirement="Needs fragrance samples for candle trials.",
        sample={
            "serial_number": "S-104",
            "sample_date": "2026-09-17",
            "remark": "Trial dispatch",
            "items": [
                {"fragrance_name": "Sandal Wood", "fragrance_code": "FP 13355", "application": "Candle"},
                {"fragrance_name": "White Oud", "quantity": "25 ml", "cost": "150"},
            ],
        },
    )
    assert lead.sample is not None
    assert len(lead.sample.items) == 2
    assert lead.sample.items[0].application == "Candle"


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


def test_department_roles_receive_distinct_lead_scopes() -> None:
    assert _lead_access_scope({"department_admin"}, "marketing") == "department"
    assert _lead_access_scope({"employee"}, "marketing") == "own"
    assert _lead_access_scope({"department_admin"}, "merchandising") == "department"
    assert _lead_access_scope({"employee"}, "merchandising") == "active_queue"


def test_marketing_report_is_for_marketing_admin_and_top_admin_only() -> None:
    assert _can_view_marketing_report({"department_admin"}, "marketing") is True
    assert _can_view_marketing_report({"employee"}, "marketing") is False
    assert _can_view_marketing_report({"department_admin"}, "merchandising") is False
    assert _can_view_marketing_report({"super_admin"}, None) is True


def test_live_analysis_uses_supported_ranges_and_safe_rates() -> None:
    assert _analysis_period(0)[1] == "All time"
    assert _analysis_period(30)[1] == "Last 30 days"
    assert _rate(3, 4) == 75.0
    assert _rate(0, 0) == 0


def test_employee_pdf_contains_summary_and_activity_tables() -> None:
    now = datetime(2026, 9, 17, 10, 30, tzinfo=timezone.utc)
    content = build_marketing_employee_report(
        organization_name="AROMAZEN INDIA",
        employee={
            "employee_name": "Asha Rao",
            "total_leads": 3,
            "accepted": 2,
            "rejected": 0,
            "pending": 1,
            "clarification_required": 0,
            "decision_rate": 66.7,
            "acceptance_rate": 100.0,
            "average_response_hours": 4.5,
            "sample_batches": 1,
            "sample_items": 2,
            "orders_received": 1,
            "awaiting_feedback": 0,
            "satisfied": 0,
            "sample_to_order_rate": 100.0,
            "last_activity_at": now,
        },
        period_label="Last 30 days",
        generated_at=now,
        leads=[{
            "submitted_at": now,
            "company_name": "Cedar & Sage",
            "region": "South",
            "product_interest": "Fine fragrance",
            "lead_source": "Field visit",
            "status": "accepted",
        }],
        samples=[{
            "sample_date": date(2026, 9, 17),
            "company_name": "Cedar & Sage",
            "status": "order_received",
            "items": [{"fragrance_name": "White Oud", "application": "Candle"}],
        }],
    )
    reader = PdfReader(io.BytesIO(content))
    report_text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert content.startswith(b"%PDF")
    assert "Employee Performance Report" in report_text
    assert "Cedar & Sage" in report_text
    assert "Customer sample follow-through" in report_text


def test_merchandising_sample_request_export_is_filterable_and_complete() -> None:
    generated_at = datetime(2026, 9, 17, 10, 30, tzinfo=timezone.utc)
    content = build_merchandising_sample_requests_workbook([{
        "lead_id": "lead-1",
        "sample_id": "sample-1",
        "sample_reference": "S-104",
        "sample_date": date(2026, 9, 17),
        "lead_submitted_at": generated_at,
        "company_name": "Cedar & Sage",
        "contact_person": "Anita Rao",
        "phone_number": "9999999999",
        "email": "anita@example.com",
        "country": "India",
        "region": "South",
        "product_interest": "Fine fragrance",
        "expected_quantity": "100 kg",
        "lead_source": "Field visit",
        "priority": "hot",
        "marketing_employee": "Asha Rao",
        "lead_status": "accepted",
        "merchandising_response_at": generated_at,
        "handled_by": "Maya Shah",
        "fragrance_name": "White Oud",
        "fragrance_code": "FP 104",
        "application": "Candle",
        "sample_quantity": "25 ml",
        "sample_cost": "150",
        "sample_status": "recorded",
        "sample_remark": "Trial dispatch",
        "requirement": "Needs a premium oud sample.",
        "lead_notes": "Priority customer",
    }], generated_at=generated_at)
    workbook = load_workbook(io.BytesIO(content), data_only=False)
    sheet = workbook["Sample Requests"]
    assert sheet["A1"].value == "Merchandising Sample Requests"
    assert sheet["D4"].value == "Company / customer"
    assert sheet["R5"].value == "White Oud"
    assert sheet.freeze_panes == "A5"
    assert sheet.auto_filter.ref == "A4:Z5"
    assert sheet.sheet_view.showGridLines is False
    workbook.close()
