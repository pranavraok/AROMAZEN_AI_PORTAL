"""Fast deterministic QA for assistant intent routing and prompt behavior."""

from datetime import date
from types import SimpleNamespace

from app.modules.ai.providers import AIProviderRouter
from app.modules.ai.routes import _build_prompt, _query_plan
from app.modules.ai.rag import _document_lexical_score, apply_structured_employee_filter, structured_employee_answer


def message(role: str, content: str):
    return SimpleNamespace(role=role, content=content)


def main() -> None:
    general = _query_plan("Explain how photosynthesis works", [], [], False)
    assert general.mode == "general" and not general.use_knowledge and not general.exhaustive

    internal = _query_plan("What is our leave policy?", [], [], False)
    assert internal.mode == "internal" and internal.use_knowledge and not internal.exhaustive

    exhaustive = _query_plan("Tell me complete details of all employees in a list", [], [], False)
    assert exhaustive.mode == "internal_exhaustive" and exhaustive.use_knowledge and exhaustive.exhaustive and exhaustive.retrieval_limit >= 30

    filtered_roster = _query_plan("Give me list of employee joined after March 2025 along with joining date", [], [], False)
    assert filtered_roster.mode == "internal_exhaustive" and filtered_roster.exhaustive

    employee_list = SimpleNamespace(
        original_filename="Employee List.xlsx", document_category="general",
        extracted_text="Employee Name: A | Date of Joining: 2025-05-01\n" * 40,
    )
    leave_policy = SimpleNamespace(
        original_filename="Leave Policy.docx", document_category="hr_policy",
        extracted_text="An employee may request annual leave.",
    )
    question = "Give me list of employee joined after March 2025 along with joining date"
    assert _document_lexical_score(question, employee_list) > _document_lexical_score(question, leave_policy)

    exhaustive_prompt = _build_prompt(question, [], [{
        "page": None, "chunk_index": 0, "document_name": "Employee List.xlsx",
        "collection_name": "HR", "content": employee_list.extracted_text,
        "complete_document": True, "source_characters": len(employee_list.extracted_text),
    }], [], filtered_roster)
    assert "complete_document=true" in exhaustive_prompt
    assert "output every match" in exhaustive_prompt

    records = [{
        "content": "\n".join([
            "Record 2: Employee Name: Before | Date of Joining: 2025-03-31",
            "Record 3: Employee Name: Match One | Date of Joining: 2025-05-01",
            "Record 4: Employee Name: Match Two | Joining Date: 15/08/2025",
            "Record 5: Employee Name: Not One Year | DOJ: 2025-09-01",
            "Record 6: Employee Name: Wrong Year | DOJ: 2026-05-01",
        ])
    }]
    filtered = apply_structured_employee_filter(
        "List all employees who joined in 2025 after April and completed 1 year",
        records,
        as_of=date(2026, 8, 22),
    )[0]
    assert filtered["matching_record_count"] == 2
    assert "Match One" in filtered["content"] and "Match Two" in filtered["content"]
    assert "Before" not in filtered["content"] and "Not One Year" not in filtered["content"]

    omission_regression = [{
        "structured_filter": True,
        "matching_record_count": 3,
        "after_date": "2025-03-31",
        "tenure_cutoff": None,
        "filter_as_of": "2026-08-22",
        "content": "\n".join([
            "Record 46: Employee ID: 46 | Employee Name: DHANYASHRI | Date of Joining: 26-May-2025 | Designation: Production Helper",
            "Record 48: Employee ID: 48 | Employee Name: DION HUBERT | Date of Joining: 02-Jun-2025 | Designation: Production Helper",
            "Record 54: Employee ID: 54 | Employee Name: KARTHIK | Date of Joining (DOJ): 16-Jun-2025 | Designation: Production Helper",
        ]),
    }]
    deterministic = structured_employee_answer(omission_regression)
    assert deterministic is not None
    assert all(name in deterministic for name in ("KARTHIK", "DHANYASHRI", "DION HUBERT"))
    assert "Total matching employees: 3" in deterministic

    follow_up = _query_plan("What about the remaining employees?", [message("user", "List our employee records")], [], False)
    assert follow_up.mode == "internal_exhaustive" and follow_up.exhaustive

    attachment = _query_plan("Summarize this file", [], [], True)
    assert attachment.mode == "attachment" and not attachment.use_knowledge

    attached_file = SimpleNamespace(original_filename="Long Report.pdf", extracted_text="x" * 70000)
    attachment_prompt = _build_prompt("Investigate this report", [], [], [attached_file], attachment)
    assert "complete_file=true" in attachment_prompt
    assert attachment_prompt.count("x") >= 70000

    prompt = _build_prompt("Explain gravity", [], [], [], general)
    assert "No relevant" not in prompt and "database" not in prompt.lower()
    assert "required for every mode" in prompt and "investigate every item" in prompt

    internal_prompt = _build_prompt("Explain our leave policy and all exceptions", [], [{
        "page": None, "chunk_index": 0, "document_name": "Leave Policy.docx",
        "collection_name": "HR", "content": "Policy and exception text.",
        "complete_document": True, "source_characters": 26,
        "corpus_truncated": False, "relevant_document_candidates": 1,
        "included_documents": 1, "omitted_documents": 0,
    }], [], internal)
    assert "complete_document=true" in internal_prompt
    assert "corpus_truncated=false" in internal_prompt and "omitted_documents=0" in internal_prompt
    assert "do not answer from only the first matching passage" in internal_prompt

    settings = SimpleNamespace(
        openai_api_key="configured", anthropic_api_key="configured", openai_chat_model="gpt-5.5",
        anthropic_default_model="claude-sonnet-4-6", anthropic_fast_model="claude-haiku-4-5",
        ai_default_provider="anthropic",
    )
    router = AIProviderRouter(settings)
    normal_models = [provider.model for provider in router._providers("[general] explain gravity")]
    exhaustive_models = [provider.model for provider in router._providers("[internal_exhaustive] list all employees")]
    assert all("haiku" not in model for model in normal_models + exhaustive_models)
    assert exhaustive_models[0] == "gpt-5.5"
    print("assistant_engine_qa=passed")


if __name__ == "__main__":
    main()
