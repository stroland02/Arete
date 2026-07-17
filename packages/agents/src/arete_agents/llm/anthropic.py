from typing import Literal

from langchain_anthropic import ChatAnthropic

from arete_agents.llm.base import DEFAULT_LLM_TIMEOUT_SECONDS

# Model tier -> Anthropic model ID. "opus" is the confirmed-working ID
# already in production use; "sonnet" is the faster/cheaper tier for more
# mechanical roles (see get_llms_by_role / config per-role *_tier fields).
_TIER_MODEL_IDS: dict[str, str] = {
    "opus": "claude-opus-4-8",
    "sonnet": "claude-sonnet-5",
}


def build_anthropic_llm(
    api_key: str,
    tier: Literal["opus", "sonnet"] = "opus",
    model: str | None = None,
) -> ChatAnthropic:
    """Build a Claude client. ``model`` overrides the tier->model mapping when
    given (used by the per-request BYO path, where the caller names an exact
    model); otherwise the model is chosen from ``tier``."""
    return ChatAnthropic(
        model=model or _TIER_MODEL_IDS[tier],
        api_key=api_key,
        temperature=0.1,
        max_tokens=8192,
        timeout=DEFAULT_LLM_TIMEOUT_SECONDS,
    )
