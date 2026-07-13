from unittest.mock import patch

import pytest


def test_settings_loads_gemini_provider():
    env = {"LLM_PROVIDER": "gemini", "GEMINI_API_KEY": "test-key"}
    with patch.dict("os.environ", env):
        from arete_agents.config import get_settings
        get_settings.cache_clear()
        settings = get_settings()
        assert settings.llm_provider == "gemini"
        assert settings.gemini_api_key == "test-key"


def test_settings_loads_anthropic_provider():
    with patch.dict("os.environ", {
        "LLM_PROVIDER": "anthropic",
        "ANTHROPIC_API_KEY": "sk-ant-test",
        "GEMINI_API_KEY": "",
    }):
        from arete_agents.config import get_settings
        get_settings.cache_clear()
        settings = get_settings()
        assert settings.llm_provider == "anthropic"
        assert settings.anthropic_api_key == "sk-ant-test"


def test_settings_gemini_requires_api_key():
    with patch.dict("os.environ", {"LLM_PROVIDER": "gemini", "GEMINI_API_KEY": ""}):
        from arete_agents.config import get_settings
        get_settings.cache_clear()
        with pytest.raises(ValueError):
            get_settings()


def test_settings_anthropic_requires_api_key():
    from arete_agents.config import get_settings
    get_settings.cache_clear()
    with patch.dict("os.environ", {
        "LLM_PROVIDER": "anthropic",
        "ANTHROPIC_API_KEY": "",
    }):
        with pytest.raises(ValueError):
            get_settings()


def test_eval_tier_defaults():
    from arete_agents.config import Settings
    settings = Settings(llm_provider="anthropic", anthropic_api_key="k")
    assert settings.eval_finder_tier == "opus"
    assert settings.eval_judge_tier == "sonnet"


def test_eval_tiers_accept_overrides():
    from arete_agents.config import Settings
    settings = Settings(
        llm_provider="anthropic",
        anthropic_api_key="k",
        eval_finder_tier="sonnet",
        eval_judge_tier="opus",
    )
    assert settings.eval_finder_tier == "sonnet"
    assert settings.eval_judge_tier == "opus"
