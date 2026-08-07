import io
from datetime import date
from decimal import Decimal

from openpyxl import Workbook

from app.modules.payroll.engine import read_salary_excel


def build_workbook() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append([
        "NAME", "PERSONAL EMAIL", "DOB", "EMPLOYEE CODE", "UNIT", "DOJ", "DESIGNATION",
        "UAN", "ESI", "DAYS", "PRESENT DAYS", "LOP", "OT HOURS", "GROSS", "BASIC", "HRA",
        "SPECIAL ALLOWANCE", "OVERTIME", "VARIABLE PAY", "PF", "ESI", "P. Tax", "LOAN",
        "TDS", "ADVANCE", "OTHERS", "NET",
    ])
    row = [
        "Sample Employee", "test@example.com", date(1992, 5, 18), "EMP-1", 2, date(2022, 1, 10), "Executive",
        "UAN1", "ESI1", 30, 15, None, 2, 30000, 12000, 6000, 12000, 1000, 500, 900, 100, 200, 0, 0, 0, 0, 99999,
    ]
    sheet.append(row)
    sheet.append([*row[:1], "test@example.com", *row[2:]])
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
    assert details["uploaded_net_wages"] == "99999.00"
    print("Payroll engine QA passed")


if __name__ == "__main__":
    main()
