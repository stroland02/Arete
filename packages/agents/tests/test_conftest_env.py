from arete_agents.config import get_settings


def test_test_session_always_has_a_usable_provider():
    """Keyless (no ANTHROPIC_API_KEY / GEMINI_API_KEY exported), the suite
    used to leave the default provider = 'anthropic' with no key, so
    Settings() construction raised and ReviewOrchestrator.run() silently fell
    back to blind-merge — masking 9 real full-pipeline assertions. conftest
    now sets CI's fake-gemini env so local == CI and get_settings() always
    constructs. A red line is then a real bug, not a missing key."""
    get_settings.cache_clear()
    settings = get_settings()  # must NOT raise
    # "ollama" is a valid keyless provider too (config.py Literal): a developer
    # who exports LLM_PROVIDER=ollama for local dev has a usable provider and
    # must not fail this test.
    assert settings.llm_provider in {"gemini", "anthropic", "ollama"}
