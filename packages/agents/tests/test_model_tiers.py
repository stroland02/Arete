from unittest.mock import MagicMock

from arete_agents.config import Settings
from arete_agents.llm.anthropic import _TIER_MODEL_IDS, build_anthropic_llm
from arete_agents.llm.base import ROLE_KEYS, get_llms_by_role, role_tiers
from arete_agents.orchestrator import ReviewOrchestrator


def _settings(**kw) -> Settings:
    base = dict(llm_provider="anthropic", anthropic_api_key="sk-ant-test")
    base.update(kw)
    return Settings(**base)


def test_tier_model_ids():
    assert _TIER_MODEL_IDS == {
        "opus": "claude-opus-4-8",
        "sonnet": "claude-sonnet-5",
    }


def test_build_anthropic_llm_defaults_to_opus():
    llm = build_anthropic_llm("sk-ant-test")
    assert llm.model == "claude-opus-4-8"


def test_build_anthropic_llm_sonnet_tier():
    llm = build_anthropic_llm("sk-ant-test", tier="sonnet")
    assert llm.model == "claude-sonnet-5"


def test_role_tiers_defaults_match_spec():
    tiers = role_tiers(_settings())
    assert tiers == {
        "security": "opus",
        "performance": "sonnet",
        "quality": "sonnet",
        "test_coverage": "sonnet",
        "deployment_safety": "opus",
        "business_logic": "opus",
        "ci_diagnostics": "opus",
        "synthesizer": "opus",
        "chat": "sonnet",
        "critic_opus": "opus",
        "critic_sonnet": "sonnet",
    }


def test_role_tiers_is_env_overridable():
    tiers = role_tiers(_settings(security_tier="sonnet"))
    assert tiers["security"] == "sonnet"


def test_get_llms_by_role_covers_every_role():
    llms = get_llms_by_role(_settings())
    assert set(llms) == set(ROLE_KEYS)


def test_get_llms_by_role_shares_one_client_per_tier():
    llms = get_llms_by_role(_settings())
    # All opus roles share one instance; all sonnet roles share another;
    # the two tiers are distinct instances (only 2 clients built total).
    assert llms["security"] is llms["business_logic"]  # both opus
    assert llms["performance"] is llms["quality"]       # both sonnet
    assert llms["security"] is not llms["performance"]
    assert len({id(c) for c in llms.values()}) == 2


def test_get_llms_by_role_honors_provider():
    # The review path must build clients for the CONFIGURED provider — this is
    # what lets a live review run on Gemini. Anthropic remains the default.
    anthropic_llms = get_llms_by_role(_settings())
    assert "anthropic" in type(anthropic_llms["security"]).__module__.lower()

    gemini_llms = get_llms_by_role(
        _settings(llm_provider="gemini", gemini_api_key="g", anthropic_api_key="")
    )
    assert "google" in type(gemini_llms["security"]).__module__.lower()
    # the fixed critic roles follow the provider too — no Anthropic key needed
    assert "google" in type(gemini_llms["critic_opus"]).__module__.lower()


def test_orchestrator_accepts_per_role_dict():
    llms = {role: MagicMock(name=role) for role in ROLE_KEYS}
    orch = ReviewOrchestrator(llm=llms)
    by_name = {a.agent_name: a for a in orch._agents}
    assert by_name["security"]._llm is llms["security"]
    assert by_name["performance"]._llm is llms["performance"]
    assert by_name["business_logic"]._llm is llms["business_logic"]
    assert orch.synthesizer._llm is llms["synthesizer"]


def test_orchestrator_single_llm_maps_to_all_roles():
    single = MagicMock(name="single")
    orch = ReviewOrchestrator(llm=single)
    assert all(a._llm is single for a in orch._agents)
    assert orch.synthesizer._llm is single
    assert orch._llms["ci_diagnostics"] is single
    assert orch._llms["chat"] is single


def test_critic_tiers_are_fixed_regardless_of_role_overrides():
    """critic_opus/critic_sonnet never change even if every configurable
    role is overridden to the same tier via env."""
    tiers = role_tiers(_settings(
        security_tier="sonnet", business_logic_tier="sonnet",
        deployment_safety_tier="sonnet", ci_tier="sonnet",
        synthesizer_tier="sonnet", chat_tier="sonnet",
    ))
    assert tiers["critic_opus"] == "opus"
    assert tiers["critic_sonnet"] == "sonnet"


def test_get_llms_by_role_always_builds_both_tiers_for_critic():
    """Even when every one of the 9 configurable roles resolves to the same
    tier, get_llms_by_role must still build BOTH an opus and a sonnet
    client, because critic_opus/critic_sonnet are fixed."""
    llms = get_llms_by_role(_settings(
        security_tier="sonnet", business_logic_tier="sonnet",
        deployment_safety_tier="sonnet", ci_tier="sonnet",
        synthesizer_tier="sonnet", chat_tier="sonnet",
    ))
    assert llms["critic_opus"] is not llms["critic_sonnet"]
    assert len({id(c) for c in llms.values()}) == 2
