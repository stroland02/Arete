from langchain_anthropic import ChatAnthropic

from arete_agents.llm.base import DEFAULT_LLM_TIMEOUT_SECONDS


def build_anthropic_llm(api_key: str) -> ChatAnthropic:
    return ChatAnthropic(
        model="claude-opus-4-8",
        api_key=api_key,
        temperature=0.1,
        max_tokens=8192,
        timeout=DEFAULT_LLM_TIMEOUT_SECONDS,
    )
