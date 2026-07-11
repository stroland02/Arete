from arete_agents.config import Settings
from arete_agents.eval.__main__ import resolve_providers


def _settings(**kw) -> Settings:
    base = dict(llm_provider="gemini", gemini_api_key="k", anthropic_api_key="k")
    base.update(kw)
    return Settings(**base)


def test_new_config_fields_default_none():
    s = _settings()
    assert s.eval_finder_provider is None
    assert s.eval_judge_provider is None
    assert s.eval_f1_threshold == 0.05


def test_heterogeneous_judge_default_gemini_finder():
    finder, judge = resolve_providers(_settings(llm_provider="gemini"), None)
    assert finder == "gemini"
    assert judge == "anthropic"


def test_heterogeneous_judge_default_anthropic_finder():
    finder, judge = resolve_providers(_settings(llm_provider="anthropic"), None)
    assert finder == "anthropic"
    assert judge == "gemini"


def test_judge_flag_overrides():
    finder, judge = resolve_providers(_settings(llm_provider="gemini"), "stub")
    assert judge == "stub"


def test_finder_override_setting():
    finder, judge = resolve_providers(
        _settings(llm_provider="gemini", eval_finder_provider="anthropic"), None
    )
    assert finder == "anthropic"
    assert judge == "gemini"
