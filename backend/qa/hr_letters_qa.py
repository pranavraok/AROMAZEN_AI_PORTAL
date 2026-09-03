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
from html import escape
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

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
        "PLACEHOLDER_PATTERN",
    }
    function_names = {
        "_paragraphs",
        "_template_tokens",
        "_legacy_appointment_layout",
        "_replace_token",
        "_replace_remaining_docx_tokens",
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
        "ZIP_DEFLATED": ZIP_DEFLATED,
        "ZipFile": ZipFile,
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
        "escape": escape,
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

    spot_fields = {
        "issue_date": "12/08/2026",
        "employee_name": "Ananya Krishnamurthy Rao",
        "designation": "Senior Quality Assurance Executive",
        "appreciation_reason": "Your alertness and proactive approach are greatly appreciated.",
        "positive_impact": "Your contribution prevented production downtime and supported the whole team.",
        "reward_statement": "Please accept this spot appreciation reward.",
        "closing_message": "Thank you for your dedication and excellent work.",
        "signatory_name": "Mrs. Deeksha",
        "signatory_title": "Accounts & HR Head",
    }
    spot_output = output_dir / "spot-appreciation-all-fields.pdf"
    spot_output.write_bytes(generator["_generate_pdf"]("spot_appreciation", spot_fields))
    spot_reader = PdfReader(spot_output)
    assert len(spot_reader.pages) == 1
    assert "{{" not in "\n".join(page.extract_text() or "" for page in spot_reader.pages)
    print("PASS: generated 1-page letterhead-safe Spot Appreciation PDF")

    special_template = ASSET_ROOT / "special-increment-template.docx"
    special_tokens = generator["_template_tokens"](special_template)
    assert len([token for token in special_tokens if token.startswith("salary_")]) == 37
    special_fields = {
        token: (
            "1,000"
            if token.startswith("salary_")
            else {
                "issue_date": "12/08/2026",
                "employee_name": "Ananya Krishnamurthy Rao",
                "effective_date": "01/09/2026",
                "revised_salary": "45,000/-",
                "appt_ref": "APL/HR/APPT/2026/0812",
                "appt_date": "12/08/2026",
                "signatory_name": "Ms. Swathi Nayak",
                "signatory_title": "Human Resources",
            }.get(token, "Sample value")
        )
        for token in special_tokens
    }
    special_output = output_dir / "special-increment-all-fields.pdf"
    special_output.write_bytes(generator["_generate_pdf"]("special_increment", special_fields))
    special_reader = PdfReader(special_output)
    special_text = "\n".join(page.extract_text() or "" for page in special_reader.pages)
    assert len(special_reader.pages) == 3
    assert "{{" not in special_text
    assert "Basic Salary" in special_text
    assert "Cost To Company" in special_text
    print("PASS: generated 3-page Special Increment PDF with a fully mapped compensation annexure")


if __name__ == "__main__":
    main()
