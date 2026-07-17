from unittest.mock import MagicMock

import pytest


def test_get_llm_returns_gemini_when_provider_gemini(monkeypatch):
    from arete_agents.config import get_settings
    get_settings.cache_clear()
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")

    from arete_agents.llm.base import get_llm
    llm = get_llm(get_settings())
    module = type(llm).__module__
    assert "google" in module.lower() or "gemini" in type(llm).__name__.lower()


def test_get_llm_returns_anthropic_when_provider_anthropic(monkeypatch):
    from arete_agents.config import get_settings
    get_settings.cache_clear()
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("GEMINI_API_KEY", "")

    from arete_agents.llm.base import get_llm
    llm = get_llm(get_settings())
    assert "anthropic" in type(llm).__module__.lower()


def test_get_llm_raises_on_unknown_provider():
    from arete_agents.llm.base import get_llm
    mock_settings = MagicMock()
    mock_settings.llm_provider = "openai"
    with pytest.raises(ValueError, match="Unknown LLM provider"):
        get_llm(mock_settings)


def test_get_llms_by_role_uses_gemini_when_provider_gemini(monkeypatch):
    # The review path (orchestrator) builds clients via get_llms_by_role — it
    # must honor LLM_PROVIDER=gemini, including the fixed critic roles, so a
    # live review can run on Gemini with no Anthropic key present.
    from arete_agents.config import get_settings
    get_settings.cache_clear()
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")

    from arete_agents.llm.base import ROLE_KEYS, get_llms_by_role
    llms = get_llms_by_role(get_settings())
    for role in ROLE_KEYS:
        assert role in llms, f"missing client for role {role}"
        assert "google" in type(llms[role]).__module__.lower(), (
            f"role {role} is not a Gemini client: {type(llms[role])!r}"
        )


def test_get_llms_by_role_uses_anthropic_when_provider_anthropic(monkeypatch):
    from arete_agents.config import get_settings
    get_settings.cache_clear()
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("GEMINI_API_KEY", "")

    from arete_agents.llm.base import ROLE_KEYS, get_llms_by_role
    llms = get_llms_by_role(get_settings())
    for role in ROLE_KEYS:
        assert "anthropic" in type(llms[role]).__module__.lower()


def test_build_gemini_llm_maps_tier_to_model():
    from arete_agents.llm.gemini import build_gemini_llm
    opus = build_gemini_llm("test-key", "opus")
    sonnet = build_gemini_llm("test-key", "sonnet")
    assert "pro" in str(opus.model).lower()
    assert "flash" in str(sonnet.model).lower()
