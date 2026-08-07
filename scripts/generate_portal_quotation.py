from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "AROMAZEN_AI_Portal_Quotation.pdf"


def register_fonts() -> tuple[str, str]:
    regular_candidates = [
        Path(r"C:\Windows\Fonts\segoeui.ttf"),
        Path(r"C:\Windows\Fonts\arial.ttf"),
    ]
    bold_candidates = [
        Path(r"C:\Windows\Fonts\segoeuib.ttf"),
        Path(r"C:\Windows\Fonts\arialbd.ttf"),
    ]
    regular = next(path for path in regular_candidates if path.exists())
    bold = next(path for path in bold_candidates if path.exists())
    pdfmetrics.registerFont(TTFont("QuoteSans", str(regular)))
    pdfmetrics.registerFont(TTFont("QuoteSansBold", str(bold)))
    return "QuoteSans", "QuoteSansBold"


def money(value: int) -> str:
    raw = str(value)
    if len(raw) <= 3:
        grouped = raw
    else:
        last = raw[-3:]
        head = raw[:-3]
        pairs = []
        while head:
            pairs.append(head[-2:])
            head = head[:-2]
        grouped = ",".join(reversed(pairs)) + "," + last
    return f"₹{grouped}"


def draw_page(canvas, doc):
    width, height = A4
    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#111412"))
    canvas.rect(0, 0, width, height, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#B8793D"))
    canvas.rect(0, height - 5 * mm, width, 5 * mm, fill=1, stroke=0)
    canvas.setStrokeColor(colors.HexColor("#3A3F3B"))
    canvas.setLineWidth(0.5)
    canvas.line(14 * mm, 12 * mm, width - 14 * mm, 12 * mm)
    canvas.setFillColor(colors.HexColor("#8E9891"))
    canvas.setFont("QuoteSans", 6.8)
    canvas.drawString(14 * mm, 7.7 * mm, "Confidential commercial quotation - AROMAZEN AI Portal")
    canvas.drawRightString(width - 14 * mm, 7.7 * mm, "Page 1 of 1")
    canvas.restoreState()


def build():
    normal_font, bold_font = register_fonts()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=11 * mm,
        bottomMargin=16 * mm,
        title="AROMAZEN AI Portal - End-to-End Development Quotation",
        author="Pranav Rao K",
        subject="Commercial quotation for end-to-end design, development, testing and launch",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="quote")
    doc.addPageTemplates([PageTemplate(id="quotation", frames=[frame], onPage=draw_page)])

    white = colors.HexColor("#F3F3EF")
    muted = colors.HexColor("#AAB2AC")
    gold = colors.HexColor("#D39A5D")
    border = colors.HexColor("#39413C")
    panel = colors.HexColor("#1A1F1C")
    panel_alt = colors.HexColor("#202622")
    green = colors.HexColor("#8FBF9B")

    styles = {
        "brand": ParagraphStyle("brand", fontName=bold_font, fontSize=9, leading=11, textColor=gold, spaceAfter=2),
        "title": ParagraphStyle("title", fontName=bold_font, fontSize=20, leading=23, textColor=white, spaceAfter=3),
        "subtitle": ParagraphStyle("subtitle", fontName=normal_font, fontSize=8.2, leading=11, textColor=muted),
        "meta": ParagraphStyle("meta", fontName=normal_font, fontSize=7.2, leading=9.5, textColor=muted),
        "meta_right": ParagraphStyle("meta_right", fontName=normal_font, fontSize=7.2, leading=9.5, textColor=muted, alignment=TA_RIGHT),
        "section": ParagraphStyle("section", fontName=bold_font, fontSize=9.5, leading=11.5, textColor=gold, spaceBefore=1, spaceAfter=4),
        "body": ParagraphStyle("body", fontName=normal_font, fontSize=7.35, leading=9.7, textColor=white),
        "body_muted": ParagraphStyle("body_muted", fontName=normal_font, fontSize=6.7, leading=8.8, textColor=muted),
        "small_bold": ParagraphStyle("small_bold", fontName=bold_font, fontSize=7.2, leading=9, textColor=white),
        "amount": ParagraphStyle("amount", fontName=bold_font, fontSize=7.5, leading=9, textColor=white, alignment=TA_RIGHT),
        "total_label": ParagraphStyle("total_label", fontName=bold_font, fontSize=10, leading=12, textColor=colors.HexColor("#151915")),
        "total": ParagraphStyle("total", fontName=bold_font, fontSize=15, leading=17, textColor=colors.HexColor("#151915"), alignment=TA_RIGHT),
        "chip": ParagraphStyle("chip", fontName=bold_font, fontSize=7.2, leading=9, textColor=green, alignment=TA_CENTER),
    }

    story = []
    header = Table(
        [
            [
                [Paragraph("AROMAZEN INDIA", styles["brand"]), Paragraph("AI PORTAL", styles["title"]), Paragraph("End-to-end design, development and production launch", styles["subtitle"])],
                [Paragraph("QUOTATION NO. AZ-AIP-080726", styles["meta_right"]), Paragraph("07 August 2026", styles["meta_right"]), Spacer(1, 3), Paragraph("Valid for 30 days", styles["meta_right"])],
            ]
        ],
        colWidths=[126 * mm, 52 * mm],
    )
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.extend([header, Spacer(1, 5 * mm)])

    scope_text = (
        "A complete internal portal for up to <b>50 users</b>, built around department-wise access, AI-assisted work, controlled company knowledge and document automation. "
        "The estimate reflects the current project structure plus the proposed Accounts automation scope."
    )
    story.append(Paragraph("PROJECT SCOPE", styles["section"]))
    story.append(Paragraph(scope_text, styles["body"]))
    story.append(Spacer(1, 2.3 * mm))

    chips = [
        "AI workspace + RAG",
        "RBAC + audit",
        "HR + payroll",
        "R&D workflows",
        "Tally + Accounts",
        "PDF / Excel automation",
    ]
    chip_table = Table([[Paragraph(item, styles["chip"]) for item in chips]], colWidths=[29.66 * mm] * 6)
    chip_table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#18251C")), ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#31523A")), ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#31523A")), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2)]))
    story.extend([chip_table, Spacer(1, 2.4 * mm)])

    reviewed_scope = (
        "<b>Reviewed product foundation</b><br/>"
        "AI chat and history; multi-provider routing; department knowledge/RAG; PDF, DOCX and Excel analysis; "
        "user administration and RBAC; usage dashboard; R&D documents; HR letters and interviews; attendance, payroll and salary slips."
    )
    planned_scope = (
        "<b>Planned completion included</b><br/>"
        "Accounts workspace; Tally import/integration flow; ledger and reconciliation views; rule-based TDS, GST and ITR readiness checks; "
        "exception reports; production file storage, backup, deployment and handover."
    )
    coverage = Table(
        [[Paragraph(reviewed_scope, styles["body_muted"]), Paragraph(planned_scope, styles["body_muted"])]],
        colWidths=[89 * mm, 89 * mm],
    )
    coverage.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), panel),
        ("BOX", (0, 0), (-1, -1), 0.5, border),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, border),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.extend([coverage, Spacer(1, 3.3 * mm)])

    story.append(Paragraph("COMMERCIAL BREAKDOWN", styles["section"]))
    rows = [
        ("01", "Product discovery, workflow mapping, architecture and UX system", 60_000),
        ("02", "Core portal: authentication, departments, roles, admin and dashboard", 125_000),
        ("03", "AI workspace: provider integration, knowledge/RAG, files and usage controls", 170_000),
        ("04", "R&D, HR letters, interviews and configurable document generation", 110_000),
        ("05", "Attendance, payroll batches, salary slips, email delivery and reports", 125_000),
        ("06", "Accounts automation: Tally flow, reconciliation, TDS/GST/ITR readiness checks", 210_000),
        ("07", "QA, security baseline, backup, deployment, documentation and training", 110_000),
        ("08", "Project management and 60-day post-launch defect warranty", 50_000),
    ]
    table_data = [[Paragraph("#", styles["small_bold"]), Paragraph("Work package", styles["small_bold"]), Paragraph("One-time fee", styles["small_bold"])]]
    for number, description, amount in rows:
        table_data.append([Paragraph(number, styles["body_muted"]), Paragraph(description, styles["body"]), Paragraph(money(amount), styles["amount"])])
    breakdown = Table(table_data, colWidths=[11 * mm, 137 * mm, 30 * mm], repeatRows=1)
    breakdown.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2A302C")),
        ("BACKGROUND", (0, 1), (-1, -1), panel),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [panel, panel_alt]),
        ("BOX", (0, 0), (-1, -1), 0.6, border),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, border),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4.2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.2),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.extend([breakdown, Spacer(1, 3 * mm)])

    total_box = Table(
        [[Paragraph("TOTAL END-TO-END DEVELOPMENT VALUE", styles["total_label"]), Paragraph(money(960_000), styles["total"])]],
        colWidths=[130 * mm, 48 * mm],
    )
    total_box.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), gold), ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#E6B37B")), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7)]))
    story.extend([total_box, Spacer(1, 3.2 * mm)])

    detail_left = (
        "<b>Delivery:</b> 18-22 weeks from scope sign-off and advance.<br/>"
        "<b>Payment:</b> 20% advance, 30% foundation, 30% UAT, 20% launch.<br/>"
        "<b>Included:</b> Source code, deployment, admin training and 60-day defect warranty."
    )
    detail_right = (
        "<b>Running cost:</b> Target below ₹5,000/month, excluding AI usage.<br/>"
        "<b>AI / external services:</b> Charged at actual provider usage.<br/>"
        "<b>Taxes:</b> GST, if applicable, is additional."
    )
    details = Table([[Paragraph(detail_left, styles["body_muted"]), Paragraph(detail_right, styles["body_muted"])]], colWidths=[89 * mm, 89 * mm])
    details.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), panel), ("BOX", (0, 0), (-1, -1), 0.5, border), ("INNERGRID", (0, 0), (-1, -1), 0.5, border), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7)]))
    story.extend([details, Spacer(1, 2.8 * mm)])

    note = (
        "<b>Commercial note:</b> The Accounts scope covers Tally data workflows, reconciliation and rule-based readiness/exception checks. "
        "Statutory filing, tax certification, government credentials, licensed third-party connectors and professional CA advice are excluded. "
        "Material scope changes or unavailable external APIs will be estimated separately."
    )
    story.append(Paragraph(note, styles["body_muted"]))
    story.append(Spacer(1, 2.7 * mm))

    sign = Table(
        [[Paragraph("Prepared by", styles["meta"]), Paragraph("Accepted for AROMAZEN INDIA", styles["meta_right"])], [Paragraph("<b>Pranav Rao K</b>", styles["body"]), Paragraph("Name / Signature / Date", styles["meta_right"])], ["", ""]],
        colWidths=[89 * mm, 89 * mm],
        rowHeights=[4 * mm, 5 * mm, 4 * mm],
    )
    sign.setStyle(TableStyle([("LINEABOVE", (0, 2), (0, 2), 0.5, border), ("LINEABOVE", (1, 2), (1, 2), 0.5, border), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.append(KeepTogether(sign))

    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    build()
