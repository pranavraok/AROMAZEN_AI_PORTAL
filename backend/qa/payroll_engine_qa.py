import io
from datetime import date
from decimal import Decimal

from openpyxl import Workbook

from app.modules.payroll.engine import COLUMNS, read_salary_excel


def build_workbook() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append([label for _, label in COLUMNS])
    values = {
        "employee_name": "Sample Employee", "personal_email": "test@example.com",
        "date_of_birth": date(1992, 5, 18), "employee_code": "EMP-1", "unit": 2,
        "date_of_joining": date(2022, 1, 10), "designation": "Executive", "uan": "UAN1",
        "esi_number": "ESI1", "days": 30, "present_days": 15, "lop": 15, "ot_hours": 2,
        "basic_gross": 12000, "basic_earnings": 6000, "hra_gross": 6000, "hra_earnings": 3000,
        "special_allowance_gross": 12000, "special_allowance_earnings": 6000,
        "overtime_gross": 1000, "overtime_earnings": 1000,
        "variable_pay_gross": 500, "variable_pay_earnings": 500,
        "total_gross": 31500, "total_earnings": 16500, "pf": 900, "esi_deduction": 100,
        "professional_tax": 200, "deduction_total": 1200, "net_wages": 15300,
        "net_wages_words": "Fifteen Thousand Three Hundred Rupees Only",
    }
    row = [values.get(key) for key, _ in COLUMNS]
    sheet.append(row)
    sheet.append(row)
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def main() -> None:
    rows = read_salary_excel(build_workbook())
    assert len(rows) == 2, "Duplicate test emails must be allowed"
    details = rows[0]["details"]
    assert details["unit"] == "2"
    assert "Shivamogga" in details["unit_address"]
    assert Decimal(details["basic_earnings"]) == Decimal("6000.00")
    assert Decimal(details["hra_earnings"]) == Decimal("3000.00")
    assert Decimal(details["special_allowance_earnings"]) == Decimal("6000.00")
    assert Decimal(details["total_earnings"]) == Decimal("16500.00")
    assert Decimal(details["deduction_total"]) == Decimal("1200.00")
    assert Decimal(details["net_wages"]) == Decimal("15300.00")
    assert details["uploaded_net_wages"] == "15300.00"
    assert details["net_wages_words"] == "Fifteen Thousand Three Hundred Rupees Only"
    print("Payroll engine QA passed")


if __name__ == "__main__":
    main()
