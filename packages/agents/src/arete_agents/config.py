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

    # Provider for all AI-driven decisions. Each is built per role via
    # get_llms_by_role(): "anthropic"/"gemini" tier their roles across
    # opus/sonnet models; "ollama" is a single local model shared by every
    # role (no tiering). A per-request BYO config can override this per /review
    # call (see get_llms_by_role_from_config).
    llm_provider: Literal["gemini", "anthropic", "ollama"] = "anthropic"
    gemini_api_key: str = ""
    anthropic_api_key: str = ""

    # Ollama (local, no API key). Used when llm_provider="ollama". The default
    # model is code-specialised and must be pulled locally
    # ("ollama pull qwen2.5-coder"); an un-pulled model / unreachable server
    # yields an honest empty review, never fabricated findings.
    ollama_model: str = "qwen2.5-coder"
    ollama_base_url: str = "http://localhost:11434"

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

    eval_finder_tier: Literal["opus", "sonnet"] = "opus"
    eval_judge_tier: Literal["opus", "sonnet"] = "sonnet"
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
