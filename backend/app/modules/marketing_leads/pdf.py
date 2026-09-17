from __future__ import annotations

import io
from datetime import datetime
from html import escape
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    KeepTogether,
    LongTable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


INK = colors.HexColor("#172B2A")
TEAL = colors.HexColor("#2E5845")
PALE_TEAL = colors.HexColor("#EAF2EE")
SAND = colors.HexColor("#F5F1E9")
MUTED = colors.HexColor("#687876")
LINE = colors.HexColor("#DCE5E1")
WHITE = colors.white


def _text(value: Any, fallback: str = "-") -> str:
    if value is None or value == "":
        return fallback
    return escape(str(value))


def _date(value: Any) -> str:
    if isinstance(value, datetime):
        return value.strftime("%d %b %Y, %I:%M %p")
    if hasattr(value, "strftime"):
        return value.strftime("%d %b %Y")
    return _text(value)


def _status(value: Any) -> str:
    return str(value or "Not specified").replace("_", " ").title()


def build_marketing_employee_report(
    *,
    organization_name: str,
    employee: dict[str, Any],
    period_label: str,
    generated_at: datetime,
    leads: list[dict[str, Any]],
    samples: list[dict[str, Any]],
    logo_path: Path | None = None,
) -> bytes:
    """Build a structured employee Marketing report suitable for direct download."""
    output = io.BytesIO()
    document = SimpleDocTemplate(
        output,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=19 * mm,
        bottomMargin=18 * mm,
        title=f"Marketing Performance Report - {employee['employee_name']}",
        author=organization_name,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ReportTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=INK,
        spaceAfter=3,
    )
    eyebrow_style = ParagraphStyle(
        "Eyebrow",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=TEAL,
        spaceAfter=4,
    )
    body_style = ParagraphStyle(
        "Body",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.4,
        leading=12,
        textColor=INK,
    )
    small_style = ParagraphStyle(
        "Small",
        parent=body_style,
        fontSize=7.3,
        leading=9.5,
        textColor=MUTED,
    )
    section_style = ParagraphStyle(
        "Section",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=11.5,
        leading=14,
        textColor=INK,
        spaceBefore=12,
        spaceAfter=7,
    )
    metric_label_style = ParagraphStyle(
        "MetricLabel",
        parent=small_style,
        alignment=TA_CENTER,
        textColor=MUTED,
    )
    metric_value_style = ParagraphStyle(
        "MetricValue",
        parent=body_style,
        alignment=TA_CENTER,
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=17,
        textColor=TEAL,
    )
    table_header_style = ParagraphStyle(
        "TableHeader",
        parent=small_style,
        fontName="Helvetica-Bold",
        textColor=WHITE,
    )
    table_cell_style = ParagraphStyle(
        "TableCell",
        parent=small_style,
        textColor=INK,
    )

    story: list[Any] = []
    logo = None
    if logo_path and logo_path.exists():
        logo = Image(str(logo_path), width=34 * mm, height=12 * mm, kind="proportional")
    heading = [
        Paragraph("MARKETING ANALYSIS", eyebrow_style),
        Paragraph("Employee Performance Report", title_style),
        Paragraph(
            f"<b>{_text(employee['employee_name'])}</b> | {_text(period_label)}",
            body_style,
        ),
    ]
    header_table = Table(
        [[logo or Paragraph(f"<b>{_text(organization_name)}</b>", body_style), heading]],
        colWidths=[39 * mm, 132 * mm],
    )
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.extend([header_table, Spacer(1, 7 * mm)])

    metric_rows = [
        [
            ("Leads submitted", employee["total_leads"]),
            ("Accepted", employee["accepted"]),
            ("Decision rate", f"{employee['decision_rate']:.1f}%"),
            ("Acceptance rate", f"{employee['acceptance_rate']:.1f}%"),
        ],
        [
            ("Sample entries", employee["sample_batches"]),
            ("Sample items", employee["sample_items"]),
            ("Orders received", employee["orders_received"]),
            ("Sample-to-order", f"{employee['sample_to_order_rate']:.1f}%"),
        ],
    ]
    metric_cells = []
    for row in metric_rows:
        metric_cells.append([
            Table(
                [[Paragraph(_text(label), metric_label_style)], [Paragraph(_text(value), metric_value_style)]],
                colWidths=[41 * mm],
            )
            for label, value in row
        ])
    metric_table = Table(metric_cells, colWidths=[42.75 * mm] * 4, rowHeights=[19 * mm, 19 * mm])
    metric_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE_TEAL),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.6, WHITE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5 * mm),
    ]))
    story.extend([metric_table, Spacer(1, 3 * mm)])

    operational_rows = [
        ["Pending review", employee["pending"], "Clarification required", employee["clarification_required"]],
        ["Rejected", employee["rejected"], "Awaiting sample feedback", employee["awaiting_feedback"]],
        ["Satisfied samples", employee["satisfied"], "Avg. first response", (
            f"{employee['average_response_hours']:.1f} hours"
            if employee.get("average_response_hours") is not None else "No response data"
        )],
        ["Last recorded activity", _date(employee.get("last_activity_at")), "Report generated", _date(generated_at)],
    ]
    operations = Table(
        [[Paragraph(f"<b>{_text(a)}</b>", small_style), Paragraph(_text(b), body_style),
          Paragraph(f"<b>{_text(c)}</b>", small_style), Paragraph(_text(d), body_style)]
         for a, b, c, d in operational_rows],
        colWidths=[37 * mm, 48.5 * mm, 42 * mm, 43.5 * mm],
    )
    operations.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SAND),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.4 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.4 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2.2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.2 * mm),
    ]))
    story.append(operations)

    def section(title: str, description: str) -> None:
        story.append(KeepTogether([
            Paragraph(_text(title), section_style),
            Paragraph(_text(description), small_style),
            Spacer(1, 2 * mm),
        ]))

    section("Lead activity", "Every lead submitted by this employee in the selected reporting period.")
    lead_headers = ["Submitted", "Company", "Region", "Product / interest", "Source", "Outcome"]
    lead_rows = [[Paragraph(value, table_header_style) for value in lead_headers]]
    for lead in leads:
        lead_rows.append([
            Paragraph(_date(lead.get("submitted_at")), table_cell_style),
            Paragraph(_text(lead.get("company_name")), table_cell_style),
            Paragraph(_text(lead.get("region")), table_cell_style),
            Paragraph(_text(lead.get("product_interest")), table_cell_style),
            Paragraph(_text(lead.get("lead_source")), table_cell_style),
            Paragraph(_text(_status(lead.get("status"))), table_cell_style),
        ])
    if not leads:
        lead_rows.append([Paragraph("No lead activity in this period.", table_cell_style), "", "", "", "", ""])
    lead_table = LongTable(
        lead_rows,
        colWidths=[23 * mm, 36 * mm, 23 * mm, 38 * mm, 27 * mm, 24 * mm],
        repeatRows=1,
    )
    lead_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("SPAN", (0, 1), (-1, 1)) if not leads else ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, colors.HexColor("#F8FAF9")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 1.7 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1.7 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 1.6 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.6 * mm),
    ]))
    story.append(lead_table)

    section("Customer sample follow-through", "Sample dispatches, feedback stages and order outcomes recorded by this employee.")
    sample_headers = ["Sample date", "Company", "Fragrances / applications", "Current outcome"]
    sample_rows = [[Paragraph(value, table_header_style) for value in sample_headers]]
    for sample in samples:
        item_names = ", ".join(
            str(item.get("fragrance_name", ""))
            + (f" ({item.get('application')})" if item.get("application") else "")
            for item in sample.get("items", [])
        )
        sample_rows.append([
            Paragraph(_date(sample.get("sample_date")), table_cell_style),
            Paragraph(_text(sample.get("company_name")), table_cell_style),
            Paragraph(_text(item_names), table_cell_style),
            Paragraph(_text(_status(sample.get("status"))), table_cell_style),
        ])
    if not samples:
        sample_rows.append([Paragraph("No customer samples recorded in this period.", table_cell_style), "", "", ""])
    sample_table = LongTable(
        sample_rows,
        colWidths=[28 * mm, 40 * mm, 72 * mm, 31 * mm],
        repeatRows=1,
    )
    sample_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("SPAN", (0, 1), (-1, 1)) if not samples else ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, colors.HexColor("#F8FAF9")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 1.7 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1.7 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 1.6 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.6 * mm),
    ]))
    story.extend([
        sample_table,
        Spacer(1, 5 * mm),
        Paragraph(
            "Decision rate measures completed Merchandising decisions. Acceptance rate is calculated only "
            "from accepted and rejected leads. Sample-to-order rate uses recorded sample entries as the base.",
            small_style,
        ),
    ])

    def footer(canvas, doc) -> None:
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.line(18 * mm, 13 * mm, A4[0] - 18 * mm, 13 * mm)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(18 * mm, 8.5 * mm, f"{organization_name} | Marketing Analysis")
        canvas.setFont("Helvetica-Bold", 7)
        canvas.drawRightString(A4[0] - 18 * mm, 8.5 * mm, f"Page {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()
