"""Fast deterministic QA for assistant intent routing and prompt behavior."""

from types import SimpleNamespace

from app.modules.ai.providers import AIProviderRouter
from app.modules.ai.routes import _build_prompt, _query_plan


def message(role: str, content: str):
    return SimpleNamespace(role=role, content=content)


def main() -> None:
    general = _query_plan("Explain how photosynthesis works", [], [], False)
    assert general.mode == "general" and not general.use_knowledge and not general.exhaustive

    internal = _query_plan("What is our leave policy?", [], [], False)
    assert internal.mode == "internal" and internal.use_knowledge and not internal.exhaustive

    exhaustive = _query_plan("Tell me complete details of all employees in a list", [], [], False)
    assert exhaustive.mode == "internal_exhaustive" and exhaustive.use_knowledge and exhaustive.exhaustive and exhaustive.retrieval_limit >= 30

    follow_up = _query_plan("What about the remaining employees?", [message("user", "List our employee records")], [], False)
    assert follow_up.mode == "internal_exhaustive" and follow_up.exhaustive

    attachment = _query_plan("Summarize this file", [], [], True)
    assert attachment.mode == "attachment" and not attachment.use_knowledge

    prompt = _build_prompt("Explain gravity", [], [], [], general)
    assert "No relevant" not in prompt and "database" not in prompt.lower()

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
