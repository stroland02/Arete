from langchain_core.language_models import BaseChatModel

from arete_agents.config import Settings

# Bounds a single LLM call so one slow/hung provider request can't pin a
# review thread open indefinitely. The orchestrator is fully synchronous
# (no asyncio), so this per-call timeout — combined with with_retry(2) at
# the call sites — is the practical substitute for a request-level deadline.
DEFAULT_LLM_TIMEOUT_SECONDS = 60


def get_llm(settings: Settings) -> BaseChatModel:
    if settings.llm_provider == "gemini":
        from arete_agents.llm.gemini import build_gemini_llm
        return build_gemini_llm(settings.gemini_api_key)
    elif settings.llm_provider == "anthropic":
        from arete_agents.llm.anthropic import build_anthropic_llm
        return build_anthropic_llm(settings.anthropic_api_key)
    else:
        raise ValueError(f"Unknown LLM provider: {settings.llm_provider!r}")
