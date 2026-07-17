"""Provider generalization: Ollama + per-request (BYO) model config.

The review path must build LLM clients for the configured provider — including
a single-model provider like Ollama that has no opus/sonnet tiers — and, per
item 1, from a per-request config rather than global Settings. The critic
roles fall back to the single available model (see the independent-critic
design's single-client ruling): a lone model can't offer a distinct cross-tier
critic, so it verifies against itself — a benign no-op, never a fabricated
second model.
"""

from arete_agents.config import Settings
from arete_agents.llm.base import (
    ROLE_KEYS,
    get_llms_by_role,
    get_llms_by_role_from_config,
)


def test_build_ollama_llm_uses_model_and_base_url():
    from arete_agents.llm.ollama import build_ollama_llm

    llm = build_ollama_llm("qwen2.5-coder", "http://localhost:11434")
    assert "ollama" in type(llm).__module__.lower()
    assert llm.model == "qwen2.5-coder"
    assert llm.base_url == "http://localhost:11434"


def test_get_llms_by_role_ollama_shares_one_model_across_all_roles():
    s = Settings(
        llm_provider="ollama",
        ollama_model="qwen2.5-coder",
        anthropic_api_key="",
    )
    llms = get_llms_by_role(s)
    assert set(llms) == set(ROLE_KEYS)
    # Single-model provider: ONE client shared by every role, both critics
    # included (critic-fallback ruling) — no opus/sonnet split.
    assert len({id(c) for c in llms.values()}) == 1
    assert "ollama" in type(llms["security"]).__module__.lower()
    assert llms["critic_opus"] is llms["critic_sonnet"]


def test_get_llms_by_role_anthropic_still_tiers_opus_and_sonnet():
    # Generalization must not regress the tiered providers.
    s = Settings(llm_provider="anthropic", anthropic_api_key="sk-ant-test")
    llms = get_llms_by_role(s)
    assert len({id(c) for c in llms.values()}) == 2  # opus + sonnet
    assert "anthropic" in type(llms["security"]).__module__.lower()


def test_from_config_ollama_builds_from_passed_config_not_settings():
    llms = get_llms_by_role_from_config(
        provider="ollama", model="llama3", api_key=None, base_url="http://host:11434"
    )
    assert set(llms) == set(ROLE_KEYS)
    assert len({id(c) for c in llms.values()}) == 1  # one BYO model, all roles
    assert llms["security"].model == "llama3"
    assert llms["security"].base_url == "http://host:11434"


def test_from_config_anthropic_uses_passed_key_and_model():
    # The per-request path builds from the passed apiKey/model, NOT from any
    # global Settings / env key.
    llms = get_llms_by_role_from_config(
        provider="anthropic", model="claude-sonnet-5", api_key="sk-passed", base_url=None
    )
    assert "anthropic" in type(llms["security"]).__module__.lower()
    assert llms["security"].model == "claude-sonnet-5"
    # every role shares the one explicitly chosen model
    assert len({id(c) for c in llms.values()}) == 1


def test_from_config_rejects_unknown_provider():
    import pytest

    with pytest.raises(ValueError, match="Unknown LLM provider"):
        get_llms_by_role_from_config(provider="cohere", model="c", api_key="k", base_url=None)


def test_from_config_openai_uses_passed_key_and_model():
    llms = get_llms_by_role_from_config(
        provider="openai", model="gpt-4o", api_key="sk-openai", base_url=None
    )
    client = llms["security"]
    assert "openai" in type(client).__module__.lower()
    assert "gpt-4o" in str(getattr(client, "model_name", "") or getattr(client, "model", ""))
    assert len({id(c) for c in llms.values()}) == 1  # one client, every role


def test_from_config_openrouter_uses_openai_client_with_default_base_url():
    # OpenRouter rides the OpenAI-compatible client, pointed at its endpoint.
    llms = get_llms_by_role_from_config(
        provider="openrouter",
        model="anthropic/claude-3.5-sonnet",
        api_key="sk-or",
        base_url=None,
    )
    client = llms["security"]
    assert "openai" in type(client).__module__.lower()
    base = str(getattr(client, "openai_api_base", "") or getattr(client, "base_url", ""))
    assert "openrouter.ai" in base


def test_from_config_openrouter_respects_explicit_base_url():
    # An explicit base_url (Azure / self-hosted / proxy) overrides the default.
    llms = get_llms_by_role_from_config(
        provider="openrouter", model="x", api_key="k", base_url="https://custom.example/v1"
    )
    client = llms["security"]
    base = str(getattr(client, "openai_api_base", "") or getattr(client, "base_url", ""))
    assert "custom.example" in base
