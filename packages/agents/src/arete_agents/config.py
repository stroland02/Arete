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
    ollama_base_url: str = "http://127.0.0.1:11434"

    # Deployment tier. "local" can reach a localhost Ollama; "saas" (hosted)
    # cannot, so an Ollama-backed review pointed at localhost is refused with an
    # honest message rather than a fabricated/empty result.
    deployment_tier: Literal["local", "saas"] = "local"

    database_url: str = "postgresql://arete:arete@localhost:5432/arete"
    redis_url: str = "redis://localhost:6379"

    # Per-role Claude model tier. "opus" (claude-opus-4-8) = strongest/slowest,
    # "sonnet" (claude-sonnet-5) = balanced, "haiku" (claude-haiku-4-5) =
    # fast/low-latency. Defaults favour SPEED: judgment roles run on sonnet,
    # mechanical/interactive roles on haiku; opus is opt-in per role. Each is
    # individually overridable via env (e.g. SECURITY_TIER=opus).
    security_tier: Literal["opus", "sonnet", "haiku"] = "sonnet"
    business_logic_tier: Literal["opus", "sonnet", "haiku"] = "sonnet"
    deployment_safety_tier: Literal["opus", "sonnet", "haiku"] = "sonnet"
    synthesizer_tier: Literal["opus", "sonnet", "haiku"] = "sonnet"
    ci_tier: Literal["opus", "sonnet", "haiku"] = "haiku"
    performance_tier: Literal["opus", "sonnet", "haiku"] = "haiku"
    quality_tier: Literal["opus", "sonnet", "haiku"] = "haiku"
    test_coverage_tier: Literal["opus", "sonnet", "haiku"] = "haiku"
    chat_tier: Literal["opus", "sonnet", "haiku"] = "haiku"

    eval_finder_tier: Literal["opus", "sonnet", "haiku"] = "opus"
    eval_judge_tier: Literal["opus", "sonnet", "haiku"] = "sonnet"
    eval_f1_threshold: float = 0.05

    # Base URL of the packages/webhook Node/Express service, reached FROM this
    # process only for the internal, token-guarded write-back surface
    # (POST /internal/memory -- Phase 2 Task 8, see tools/memory.py). Mirrors
    # the .env.example default the webhook side already documents for the
    # reverse direction (WEBHOOK_SERVICE_URL, e.g.
    # packages/dashboard/src/app/api/scan/route.ts).
    webhook_service_url: str = "http://localhost:3000"
    # Shared bearer for the webhook's `/internal/*` surface
    # (packages/webhook/src/internal-auth.ts). Empty by default -- a memory
    # write attempted with no token configured is rejected by the webhook's
    # own fail-closed 503, which add_project_memory reports as an honest
    # failure string (never invents success).
    internal_api_token: str = ""

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
