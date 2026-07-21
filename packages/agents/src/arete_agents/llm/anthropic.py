from typing import Literal

from langchain_anthropic import ChatAnthropic

from arete_agents.llm.base import DEFAULT_LLM_TIMEOUT_SECONDS, DEFAULT_MAX_TOKENS

# Model tier -> Anthropic model ID. "opus" is the strongest (slowest) tier;
# "sonnet" is the balanced tier; "haiku" is the fast, low-latency tier used for
# interactive/mechanical roles (chat, quality, etc.) — see config per-role
# *_tier fields and role_tiers().
_TIER_MODEL_IDS: dict[str, str] = {
    "opus": "claude-opus-4-8",
    "sonnet": "claude-sonnet-5",
    "haiku": "claude-haiku-4-5",
}


def build_anthropic_llm(
    api_key: str,
    tier: Literal["opus", "sonnet", "haiku"] = "sonnet",
    model: str | None = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> ChatAnthropic:
    """Build a Claude client. ``model`` overrides the tier->model mapping when
    given (used by the per-request BYO path, where the caller names an exact
    model); otherwise the model is chosen from ``tier``. ``max_tokens`` bounds
    the output — smaller budgets cut generation latency for interactive roles."""
    return ChatAnthropic(
        model=model or _TIER_MODEL_IDS[tier],
        api_key=api_key,
        temperature=0.1,
        max_tokens=max_tokens,
        timeout=DEFAULT_LLM_TIMEOUT_SECONDS,
    )
