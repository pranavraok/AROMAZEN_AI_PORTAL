from pathlib import Path

from pypdf import PdfReader

from app.modules.payroll.engine import bonus_template_fields, generate_bonus_pdf, password_for, read_bonus_excel


ASSET_ROOT = Path(__file__).resolve().parents[1] / "app" / "assets" / "payroll"


def test_bonus_upload_template_maps_required_employee_fields() -> None:
    rows = read_bonus_excel((ASSET_ROOT / "AROMAZEN_Bonus_Upload_Template.xlsx").read_bytes())

    assert len(rows) == 1
    assert rows[0]["employee_name"] == "Sample Employee"
    assert rows[0]["details"]["unit"] == "1"
    assert "Baikampady Industrial Area" in rows[0]["details"]["unit_address"]
    assert rows[0]["details"]["bonus_amount"] == "25000.00"
    assert rows[0]["details"]["bonus_amount_words"] == "Twenty Five Thousand Rupees Only"
    assert rows[0]["details"]["payment_date"] == "15-09-2026"


def test_bonus_master_exposes_all_canva_placeholders() -> None:
    fields = {field.lower() for field in bonus_template_fields(ASSET_ROOT / "AROMAZEN_BonusSlip_Master.pdf")}

    assert fields == {
        "accounting_year", "unit_address", "employee_name", "employee_code",
        "date_of_joining", "designation", "uan", "esi_number", "account_number",
        "transaction_id", "payment_date", "bonus_amount", "bonus_amount_words",
    }


def test_bonus_pdf_is_single_page_and_password_protected(tmp_path: Path) -> None:
    row = read_bonus_excel((ASSET_ROOT / "AROMAZEN_Bonus_Upload_Template.xlsx").read_bytes())[0]
    output = tmp_path / "bonus-slip.pdf"

    generate_bonus_pdf(
        row["details"],
        "2026-2027",
        output,
        password_for(row["employee_name"], row["birth_year"]),
        ASSET_ROOT / "AROMAZEN_BonusSlip_Master.pdf",
    )

    reader = PdfReader(output)
    assert reader.is_encrypted
    assert reader.decrypt("SAMP1992")
    assert len(reader.pages) == 1
    text = reader.pages[0].extract_text()
    assert "2026-2027" in text
    assert "Sample Employee" in text
    assert "INR 25,000.00" in text
