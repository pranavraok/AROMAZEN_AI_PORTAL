from dataclasses import dataclass
from datetime import date
from typing import MutableMapping


DEFAULT_LATE_GRACE_MINUTES = 10
LATE_HALF_DAY_OCCURRENCE = 4


@dataclass(frozen=True)
class LatePolicyResult:
    status_code: str
    is_late: bool
    late_occurrence: int
    half_day_penalty: bool


def apply_monthly_late_policy(
    counters: MutableMapping[tuple[str, int, int], int],
    employee_key: str,
    work_date: date,
    status_code: str,
    is_late: bool,
) -> LatePolicyResult:
    """Convert an employee's fourth late arrival in a month into a half day."""
    normalized_status = str(status_code or "").strip().upper()
    counter_key = (employee_key, work_date.year, work_date.month)
    occurrence = counters.get(counter_key, 0)

    # Existing absences, weekly offs and half days do not add another late occurrence.
    counted_late = bool(is_late and normalized_status not in {"A", "WO", "HD"})
    if counted_late:
        occurrence += 1
        counters[counter_key] = occurrence

    half_day_penalty = counted_late and occurrence == LATE_HALF_DAY_OCCURRENCE
    if half_day_penalty:
        normalized_status = "HD"
    elif counted_late and normalized_status in {"", "P", "LT"}:
        normalized_status = "LT"
    elif not counted_late and normalized_status in {"", "LT"}:
        normalized_status = "P"

    return LatePolicyResult(
        status_code=normalized_status,
        is_late=counted_late,
        late_occurrence=occurrence,
        half_day_penalty=half_day_penalty,
    )
