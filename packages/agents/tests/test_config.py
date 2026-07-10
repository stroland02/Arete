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
        with pytest.raises(Exception):
            get_settings()
