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


# Canonical role keys for the production pipeline. The first six match each
# review agent's `agent_name`; the rest cover the CI agent, the synthesizer,
# and the chat agent.
ROLE_KEYS: tuple[str, ...] = (
    "security",
    "performance",
    "quality",
    "test_coverage",
    "deployment_safety",
    "business_logic",
    "ci_diagnostics",
    "synthesizer",
    "chat",
    # Fixed-tier critic roles (independent verification stage) — always
    # opus/sonnet respectively, deliberately not env-configurable via
    # Settings, so both critic tiers are always available regardless of
    # how the 9 roles above are configured. See ReviewOrchestrator._apply_critic.
    "critic_opus",
    "critic_sonnet",
)


def role_tiers(settings: Settings) -> dict[str, str]:
    """Map each role key to its configured Claude tier ("opus" | "sonnet")."""
    return {
        "security": settings.security_tier,
        "performance": settings.performance_tier,
        "quality": settings.quality_tier,
        "test_coverage": settings.test_coverage_tier,
        "deployment_safety": settings.deployment_safety_tier,
        "business_logic": settings.business_logic_tier,
        "ci_diagnostics": settings.ci_tier,
        "synthesizer": settings.synthesizer_tier,
        "chat": settings.chat_tier,
        # Fixed, not settings-derived — see ROLE_KEYS comment above.
        "critic_opus": "opus",
        "critic_sonnet": "sonnet",
    }


def _provider_api_key(settings: Settings) -> str:
    return (
        settings.gemini_api_key
        if settings.llm_provider == "gemini"
        else settings.anthropic_api_key
    )


def build_llm(
    provider: str,
    *,
    model: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    tier: str = "opus",
) -> BaseChatModel:
    """Build a single chat client for ``provider``. ``model`` names an exact
    model (the per-request BYO path); when omitted, anthropic/gemini pick a
    model from ``tier`` and ollama uses its configured default. Raises
    ValueError on an unknown provider."""
    if provider == "ollama":
        from arete_agents.llm.ollama import (
            DEFAULT_OLLAMA_BASE_URL,
            DEFAULT_OLLAMA_MODEL,
            build_ollama_llm,
        )

        return build_ollama_llm(
            model or DEFAULT_OLLAMA_MODEL, base_url or DEFAULT_OLLAMA_BASE_URL
        )
    if provider == "gemini":
        from arete_agents.llm.gemini import build_gemini_llm

        return build_gemini_llm(api_key or "", tier, model=model)
    if provider == "anthropic":
        from arete_agents.llm.anthropic import build_anthropic_llm

        return build_anthropic_llm(api_key or "", tier, model=model)
    raise ValueError(f"Unknown LLM provider: {provider!r}")


def get_llms_by_role(settings: Settings) -> dict[str, BaseChatModel]:
    """Build one LLM client per role, honoring ``settings.llm_provider``.

    anthropic/gemini tier each role across opus/sonnet models — at most two
    clients, shared by tier — so the fixed critic roles always have both tiers
    available. ollama has no tiers: a SINGLE local model client is shared by
    EVERY role, both critics included (the critic-fallback ruling — a lone
    model can't offer a distinct cross-tier critic, so it verifies against
    itself, a benign no-op). Either way a review runs entirely on the selected
    provider with no key from another provider required."""
    if settings.llm_provider == "ollama":
        client = build_llm(
            "ollama", model=settings.ollama_model, base_url=settings.ollama_base_url
        )
        return {role: client for role in ROLE_KEYS}

    tiers = role_tiers(settings)
    api_key = _provider_api_key(settings)
    clients_by_tier: dict[str, BaseChatModel] = {}
    for tier in set(tiers.values()):
        clients_by_tier[tier] = build_llm(
            settings.llm_provider, api_key=api_key, tier=tier
        )
    return {role: clients_by_tier[tier] for role, tier in tiers.items()}


def get_llms_by_role_from_config(
    provider: str,
    model: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
) -> dict[str, BaseChatModel]:
    """Build role clients from a per-request BYO model config instead of global
    Settings (see POST /review). The caller names one model, so a SINGLE client
    serves every role — both critics included (critic-fallback ruling). Raises
    ValueError on an unknown provider."""
    client = build_llm(provider, model=model, api_key=api_key, base_url=base_url)
    return {role: client for role in ROLE_KEYS}
