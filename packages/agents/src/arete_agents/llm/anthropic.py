from langchain_anthropic import ChatAnthropic


def build_anthropic_llm(api_key: str) -> ChatAnthropic:
    return ChatAnthropic(
        model="claude-opus-4-8",
        api_key=api_key,
        temperature=0.1,
        max_tokens=8192,
    )
