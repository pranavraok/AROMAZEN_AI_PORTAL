from __future__ import annotations

import ast
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.shared import Pt
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
ROUTES_PATH = ROOT / "app/modules/hr_letters/routes.py"
ASSET_ROOT = ROOT / "app/assets/hr_letters"


class TestLogger:
    def warning(self, *args, **kwargs):
        pass

    def error(self, *args, **kwargs):
        pass


def load_generator():
    tree = ast.parse(ROUTES_PATH.read_text(encoding="utf-8"))
    constant_names = {
        "TEMPLATE_FILES",
        "EXPECTED_APPOINTMENT_PAGE_COUNT",
        "KANNADA_FONT_NAME",
        "APPOINTMENT_REQUIRED_FIELDS",
    }
    function_names = {
        "_paragraphs",
        "_replace_token",
        "_fill_docx",
        "_validate_letter_fields",
        "_convert_with_libreoffice",
        "_convert_with_microsoft_word",
        "_convert_docx_to_pdf",
        "_trim_appointment_footer_overflow",
        "_generate_pdf",
    }
    nodes = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            getattr(target, "id", "") in constant_names for target in node.targets
        ):
            nodes.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name in function_names:
            nodes.append(node)
    namespace = {
        "Document": Document,
        "Path": Path,
        "PdfReader": PdfReader,
        "Pt": Pt,
        "ASSET_ROOT": ASSET_ROOT,
        "io": io,
        "logger": TestLogger(),
        "os": os,
        "qn": qn,
        "re": re,
        "shutil": shutil,
        "subprocess": subprocess,
        "sys": sys,
        "tempfile": tempfile,
        "time": time,
        "urllib": urllib,
        "uuid": uuid,
        "datetime": datetime,
        "timezone": timezone,
        "_offer_pdf": lambda fields: b"",
    }
    module = ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[]))
    exec(compile(module, str(ROUTES_PATH), "exec"), namespace)
    return namespace


SALARY_COMPONENTS = [
    "basic_salary",
    "house_rent_allowance",
    "conveyance_allowance",
    "medical_reimbursement",
    "special_allowance",
    "variable_pay",
    "a_gross_salary_total",
    "employer_contribution_pf_12",
    "employer_contribution_esi_3_25",
    "b_employee_retiral_total",
    "residential_telephone_reimbursement",
    "car_fuel_and_maintenance_allowance",
    "monthly_perquisites_total",
    "group_medical_insurance_policy_premium_gmc",
    "group_personal_accident_policy_gpa",
    "employee_benefits_total",
    "fixed_compensation_in_hand",
    "cost_to_company_ctc_per_annum_total",
]


def appointment_fields() -> dict[str, str]:
    fields = {
        "reference_number": "APL/HR/APPT/2026/0812",
        "issue_date": "12/08/2026",
        "employee_salutation_name": "Ms. Ananya Krishnamurthy Rao",
        "employee_name": "Ananya Krishnamurthy Rao",
        "employee_name_kannada": "ಅನನ್ಯ ಕೃಷ್ಣಮೂರ್ತಿ ರಾವ್",
        "employee_address": "No. 42, Second Cross, Indiranagar, Bengaluru, Karnataka - 560038",
        "employee_phone": "+91 98765 43210",
        "designation": "Senior Quality Assurance Executive",
        "designation_kannada": "ಹಿರಿಯ ಗುಣಮಟ್ಟ ಭರವಸೆ ಕಾರ್ಯನಿರ್ವಾಹಕಿ",
        "joining_date": "19/08/2026",
        "reporting_officer": "Mr. Raghavendra Srinivasan",
        "reporting_officer_kannada": "ಶ್ರೀ ರಾಘವೇಂದ್ರ ಶ್ರೀನಿವಾಸನ್",
        "gross_salary": "45,000/-",
        "gross_salary_words": "Rupees Forty Five Thousand Only",
        "gross_salary_words_kannada": "ರೂಪಾಯಿ ನಲವತ್ತೈದು ಸಾವಿರ ಮಾತ್ರ",
        "signatory_name": "Ms. Swathi Nayak",
        "signatory_name_kannada": "ಸ್ವಾತಿ ನಾಯಕ್",
        "signatory_title": "Human Resources",
    }
    for index, component in enumerate(SALARY_COMPONENTS, start=1):
        fields[f"salary_{component}_monthly"] = f"{index * 1250:,}"
        fields[f"salary_{component}_annual"] = f"{index * 15000:,}"
    return fields


def main() -> None:
    generator = load_generator()
    output_dir = ROOT.parent / "tmp" / "hr-letters-qa"
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "appointment-all-fields.pdf"
    output.write_bytes(generator["_generate_pdf"]("appointment", appointment_fields()))
    reader = PdfReader(output)
    assert len(reader.pages) == generator["EXPECTED_APPOINTMENT_PAGE_COUNT"]
    extracted = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert not re.search(r"\{\{[^}]+\}\}", extracted)
    assert "Ananya Krishnamurthy Rao" in extracted
    assert "Senior Quality Assurance Executive" in extracted
    assert "APL/HR/APPT/2026/0812" in extracted
    assert "Residential Telephone Reimbursement" not in extracted
    assert "Car fuel and Maintenance Allowance" not in extracted
    print(f"PASS: generated {len(reader.pages)}-page all-fields appointment PDF at {output}")

    long_fields = appointment_fields()
    long_fields["employee_address"] = (
        "No. 42, Second Cross, Indiranagar, Near Metro Station, Opposite Community Hall, "
        "Bengaluru Urban District, Karnataka - 560038"
    )
    long_output = output_dir / "appointment-long-content.pdf"
    long_output.write_bytes(generator["_generate_pdf"]("appointment", long_fields))
    assert len(PdfReader(long_output).pages) == generator["EXPECTED_APPOINTMENT_PAGE_COUNT"]
    print("PASS: compact retry kept a long-address appointment at 10 pages")


if __name__ == "__main__":
    main()
