from pathlib import Path

from app.modules.payroll.engine import read_salary_excel, salary_template_fields


ASSET_ROOT = Path(__file__).resolve().parents[1] / "app" / "assets" / "payroll"


def test_salary_upload_template_maps_account_number() -> None:
    rows = read_salary_excel((ASSET_ROOT / "AROMAZEN_Salary_Upload_Template.xlsx").read_bytes())

    assert rows[0]["details"]["account_number"] == "123456789012"
    assert rows[0]["details"]["ot_hours"] == "0"


def test_salary_master_uses_account_number_placeholder() -> None:
    fields = {field.lower() for field in salary_template_fields(ASSET_ROOT / "AROMAZEN_SalarySlip_Master.pdf")}

    assert "account_number" in fields
    assert "ot_hours" in fields
