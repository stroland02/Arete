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

    llm_provider: Literal["gemini", "anthropic"] = "gemini"
    gemini_api_key: str = ""
    anthropic_api_key: str = ""

    database_url: str = "postgresql://arete:arete@localhost:5432/arete"
    redis_url: str = "redis://localhost:6379"

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
