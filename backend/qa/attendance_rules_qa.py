from collections import Counter
from datetime import date

from app.modules.payroll.attendance_rules import apply_monthly_late_policy


def main() -> None:
    counters = Counter()
    statuses = []
    penalties = []
    for day in (2, 4, 7, 10, 12):
        result = apply_monthly_late_policy(counters, "EMP-1", date(2026, 8, day), "P", True)
        statuses.append(result.status_code)
        penalties.append(result.half_day_penalty)

    assert statuses == ["LT", "LT", "LT", "HD", "LT"]
    assert penalties == [False, False, False, True, False]

    september = apply_monthly_late_policy(counters, "EMP-1", date(2026, 9, 1), "P", True)
    assert september.status_code == "LT"
    assert september.late_occurrence == 1, "Late count must reset each month"

    existing_half_day = apply_monthly_late_policy(counters, "EMP-1", date(2026, 9, 2), "HD", True)
    assert existing_half_day.status_code == "HD"
    assert existing_half_day.late_occurrence == 1

    other_employee = apply_monthly_late_policy(counters, "EMP-2", date(2026, 8, 10), "P", True)
    assert other_employee.late_occurrence == 1, "Employees need independent counters"
    print("Attendance late-policy QA passed")


if __name__ == "__main__":
    main()
