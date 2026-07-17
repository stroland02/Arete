from langchain_openai import ChatOpenAI

from arete_agents.llm.base import DEFAULT_LLM_TIMEOUT_SECONDS

# OpenRouter is OpenAI-API-compatible: the SAME client, pointed at a different
# base URL. Any OpenAI-compatible gateway (OpenRouter, Azure OpenAI, a local
# proxy) is reachable this way by passing base_url.
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_OPENAI_MODEL = "gpt-4o"


def build_openai_llm(
    model: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
) -> ChatOpenAI:
    """Build an OpenAI (or OpenAI-compatible) chat client. ``base_url`` targets
    a compatible gateway such as OpenRouter; when omitted the OpenAI default
    endpoint is used. Construction opens no connection — an invalid key or
    unreachable endpoint only surfaces on the first call."""
    kwargs: dict = {
        "model": model or DEFAULT_OPENAI_MODEL,
        "api_key": api_key,
        "temperature": 0.1,
        "timeout": DEFAULT_LLM_TIMEOUT_SECONDS,
    }
    if base_url:
        kwargs["base_url"] = base_url
    return ChatOpenAI(**kwargs)
