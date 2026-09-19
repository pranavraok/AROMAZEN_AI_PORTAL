from pathlib import Path

from fastapi import HTTPException
from docx import Document
from lxml import etree

from app.modules.hr_letters.routes import (
    _custom_template_filename,
    _fill_docx,
    _replace_xml_paragraph_tokens,
    _template_tokens,
)


def test_custom_template_detects_and_fills_split_run_placeholder(tmp_path: Path) -> None:
    template = tmp_path / "custom-template.docx"
    document = Document()
    paragraph = document.add_paragraph("Dear ")
    paragraph.add_run("{{ employee")
    paragraph.add_run("_name }}")
    document.save(template)

    assert _template_tokens(template) == ["employee_name"]

    output = _fill_docx(
        "custom",
        {"employee_name": "Pranav Rao"},
        tmp_path,
        source_path=template,
    )
    generated = Document(output)
    assert generated.paragraphs[0].text == "Dear Pranav Rao"
    assert "{{" not in generated.paragraphs[0].text


def test_ooxml_only_placeholder_replacement_handles_multiple_text_nodes() -> None:
    namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    paragraph = etree.fromstring(
        f'<w:p xmlns:w="{namespace}"><w:r><w:t>{{{{job_</w:t></w:r>'
        '<w:r><w:t>title}}</w:t></w:r></w:p>'
    )

    assert _replace_xml_paragraph_tokens(paragraph, {"job_title": "Manager"})
    assert "".join(paragraph.xpath(".//w:t/text()", namespaces={"w": namespace})) == "Manager"


def test_excluded_custom_fields_are_blank_including_salary_fields(tmp_path: Path) -> None:
    template = tmp_path / "optional-fields.docx"
    document = Document()
    document.add_paragraph("Bank account: {{bank_account_number}}")
    document.add_paragraph("Monthly basic: {{salary_basic_monthly}}")
    document.save(template)

    output = _fill_docx(
        "custom",
        {
            "bank_account_number": "1234567890",
            "salary_basic_monthly": "50,000",
        },
        tmp_path,
        source_path=template,
        excluded_fields={"bank_account_number", "salary_basic_monthly"},
    )

    generated = Document(output)
    assert generated.paragraphs[0].text == "Bank account: "
    assert generated.paragraphs[1].text == "Monthly basic: "
    assert "NIL" not in "\n".join(paragraph.text for paragraph in generated.paragraphs)


def test_custom_template_rename_preserves_docx_extension() -> None:
    assert _custom_template_filename("Bank Confirmation") == "Bank Confirmation.docx"
    assert _custom_template_filename("Bank Confirmation.docx") == "Bank Confirmation.docx"


def test_custom_template_rename_rejects_paths_and_other_file_types() -> None:
    for invalid_name in ("../Bank Confirmation", "Bank Confirmation.pdf", "Bank Confirmation."):
        try:
            _custom_template_filename(invalid_name)
        except HTTPException as error:
            assert error.status_code == 422
        else:
            raise AssertionError(f"Expected {invalid_name!r} to be rejected")
