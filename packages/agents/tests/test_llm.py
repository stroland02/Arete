import pytest
from unittest.mock import MagicMock


def test_get_llm_returns_gemini_when_provider_gemini():
    from arete_agents.config import get_settings
    get_settings.cache_clear()

    import os
    os.environ["LLM_PROVIDER"] = "gemini"
    os.environ["GEMINI_API_KEY"] = "test-key"

    from arete_agents.llm.base import get_llm
    llm = get_llm(get_settings())
    module = type(llm).__module__
    assert "google" in module.lower() or "gemini" in type(llm).__name__.lower()


def test_get_llm_returns_anthropic_when_provider_anthropic():
    from arete_agents.config import get_settings
    get_settings.cache_clear()

    import os
    os.environ["LLM_PROVIDER"] = "anthropic"
    os.environ["ANTHROPIC_API_KEY"] = "sk-ant-test"
    os.environ["GEMINI_API_KEY"] = ""

    from arete_agents.llm.base import get_llm
    llm = get_llm(get_settings())
    assert "anthropic" in type(llm).__module__.lower()


def test_get_llm_raises_on_unknown_provider():
    from arete_agents.llm.base import get_llm
    mock_settings = MagicMock()
    mock_settings.llm_provider = "openai"
    with pytest.raises(ValueError, match="Unknown LLM provider"):
        get_llm(mock_settings)
