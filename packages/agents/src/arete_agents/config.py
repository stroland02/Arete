from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Anthropic is the standard provider for all AI-driven decisions. The
    # gemini path remains dormant (selectable via LLM_PROVIDER=gemini) but is
    # not used by the production pipeline, which builds Anthropic clients
    # per role via get_llms_by_role().
    llm_provider: Literal["gemini", "anthropic"] = "anthropic"
    gemini_api_key: str = ""
    anthropic_api_key: str = ""

    database_url: str = "postgresql://arete:arete@localhost:5432/arete"
    redis_url: str = "redis://localhost:6379"

    # Per-role Claude model tier. "opus" (claude-opus-4-8) for nuanced-
    # judgment roles; "sonnet" (claude-sonnet-5) for more mechanical/
    # pattern-based roles. Each is individually overridable via env
    # (e.g. SECURITY_TIER=sonnet).
    security_tier: Literal["opus", "sonnet"] = "opus"
    business_logic_tier: Literal["opus", "sonnet"] = "opus"
    deployment_safety_tier: Literal["opus", "sonnet"] = "opus"
    ci_tier: Literal["opus", "sonnet"] = "opus"
    synthesizer_tier: Literal["opus", "sonnet"] = "opus"
    performance_tier: Literal["opus", "sonnet"] = "sonnet"
    quality_tier: Literal["opus", "sonnet"] = "sonnet"
    test_coverage_tier: Literal["opus", "sonnet"] = "sonnet"
    chat_tier: Literal["opus", "sonnet"] = "sonnet"

    eval_finder_provider: Literal["gemini", "anthropic"] | None = None
    eval_judge_provider: Literal["gemini", "anthropic"] | None = None
    eval_f1_threshold: float = 0.05

    @field_validator("gemini_api_key")
    @classmethod
    def gemini_key_required(cls, v: str, info) -> str:
        if info.data.get("llm_provider") == "gemini" and not v:
            raise ValueError("GEMINI_API_KEY is required when LLM_PROVIDER=gemini")
        return v

    @field_validator("anthropic_api_key")
    @classmethod
    def anthropic_key_required(cls, v: str, info) -> str:
        if info.data.get("llm_provider") == "anthropic" and not v:
            raise ValueError(
                "ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic"
            )
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
