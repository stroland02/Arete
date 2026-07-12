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
    }


def get_llms_by_role(settings: Settings) -> dict[str, BaseChatModel]:
    """Build one Anthropic client per role, at that role's configured tier.

    Anthropic-only by construction (does not consult llm_provider). Clients
    are shared across roles that resolve to the same tier, so at most two
    ChatAnthropic instances are created regardless of role count.
    """
    from arete_agents.llm.anthropic import build_anthropic_llm

    tiers = role_tiers(settings)
    clients_by_tier: dict[str, BaseChatModel] = {}
    for tier in set(tiers.values()):
        clients_by_tier[tier] = build_anthropic_llm(settings.anthropic_api_key, tier)
    return {role: clients_by_tier[tier] for role, tier in tiers.items()}
