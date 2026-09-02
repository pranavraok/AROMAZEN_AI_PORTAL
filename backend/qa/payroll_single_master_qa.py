import io
import sys
import types
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import email_validator  # noqa: F401
except ModuleNotFoundError:
    module = types.ModuleType("email_validator")

    class EmailNotValidError(ValueError):
        pass

    def validate_email(value, check_deliverability=False):
        return types.SimpleNamespace(normalized=str(value).lower())

    module.EmailNotValidError = EmailNotValidError
    module.validate_email = validate_email
    sys.modules["email_validator"] = module

from pypdf import PdfReader, PdfWriter
from openpyxl import Workbook

from app.modules.payroll.engine import (
    COLUMNS,
    UNIT_ADDRESSES,
    generate_salary_pdf,
    read_salary_excel,
    salary_template_fields,
)


def details_for_unit(unit: str) -> dict[str, str]:
    return {
        "employee_name": f"Sample Employee {unit}",
        "employee_code": f"EMP00{unit}",
        "unit": unit,
        "unit_address": UNIT_ADDRESSES[unit],
        "designation": "Executive",
        "date_of_joining": "10-01-2022",
        "uan": f"UAN{unit}",
        "esi_number": f"ESI{unit}",
        "days": "30",
        "present_days": "29",
        "lop": "1",
        "ot_hours": "2",
        "basic_gross": "12000.00",
        "basic_earnings": "11600.00",
        "hra_gross": "6000.00",
        "hra_earnings": "5800.00",
        "special_allowance_gross": "12000.00",
        "special_allowance_earnings": "11600.00",
        "overtime_gross": "1000.00",
        "overtime_earnings": "1000.00",
        "variable_pay_gross": "500.00",
        "variable_pay_earnings": "500.00",
        "total_gross": "31500.00",
        "total_earnings": "30500.00",
        "pf": "900.00",
        "esi_deduction": "100.00",
        "professional_tax": "200.00",
        "loan": "0.00",
        "advance": "0.00",
        "other_deductions": "0.00",
        "tds": "0.00",
        "deduction_total": "1200.00",
        "net_wages": "29300.00",
        "net_wages_words": "Twenty Nine Thousand Three Hundred Rupees Only",
    }


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    template = root / "backend" / "app" / "assets" / "payroll" / "AROMAZEN_SalarySlip_Master.pdf"
    output_dir = root / "tmp" / "pdfs" / "salary-single-master-qa"
    output_dir.mkdir(parents=True, exist_ok=True)
    fields = set(salary_template_fields(template))
    assert {"unit", "unit_address", "employee_name", "net_salary"}.issubset(fields)

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Salary Data"
    sheet.append([label for _, label in COLUMNS])
    for unit in ("1", "2", "3"):
        details = details_for_unit(unit)
        details.update(
            personal_email=f"employee{unit}@example.com",
            date_of_birth=date(1992, 5, 18),
            unit_address="This manually entered address must be ignored",
        )
        sheet.append([details.get(key, "") for key, _ in COLUMNS])
    workbook_bytes = io.BytesIO()
    workbook.save(workbook_bytes)
    rows = read_salary_excel(workbook_bytes.getvalue())
    assert [row["details"]["unit_address"] for row in rows] == [UNIT_ADDRESSES[str(unit)] for unit in (1, 2, 3)]

    for unit in ("1", "2", "3"):
        protected = output_dir / f"unit-{unit}-protected.pdf"
        preview = output_dir / f"unit-{unit}.pdf"
        generate_salary_pdf(details_for_unit(unit), "2026-08", protected, "SAMP1992", template)
        reader = PdfReader(protected)
        assert reader.is_encrypted and reader.decrypt("SAMP1992")
        assert len(reader.pages) == 1
        writer = PdfWriter()
        writer.add_page(reader.pages[0])
        with preview.open("wb") as stream:
            writer.write(stream)
        assert UNIT_ADDRESSES[unit] in (reader.pages[0].extract_text() or "")
    print("Single salary-slip master QA passed for Units 1, 2 and 3")


if __name__ == "__main__":
    main()
