from typing import Literal

from langchain_google_genai import ChatGoogleGenerativeAI

from arete_agents.llm.base import DEFAULT_LLM_TIMEOUT_SECONDS

# Model tier -> Gemini model ID. Mirrors the Anthropic tiering so the per-role
# *_tier config stays meaningful when LLM_PROVIDER=gemini: the "opus"
# (nuanced-judgment) tier maps to the stronger Pro model, "sonnet" to the
# faster/cheaper Flash model.
_TIER_MODEL_IDS: dict[str, str] = {
    "opus": "gemini-2.5-pro",
    "sonnet": "gemini-2.5-flash",
}


def build_gemini_llm(
    api_key: str,
    tier: Literal["opus", "sonnet"] = "opus",
    model: str | None = None,
) -> ChatGoogleGenerativeAI:
    """Build a Gemini client. ``model`` overrides the tier->model mapping when
    given (used by the per-request BYO path, where the caller names an exact
    model); otherwise the model is chosen from ``tier``."""
    return ChatGoogleGenerativeAI(
        model=model or _TIER_MODEL_IDS[tier],
        google_api_key=api_key,
        temperature=0.1,
        max_tokens=8192,
        timeout=DEFAULT_LLM_TIMEOUT_SECONDS,
    )
