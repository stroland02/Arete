from langchain_ollama import ChatOllama

# Ollama has no opus/sonnet tiering — a single local model serves every role
# (see get_llms_by_role's ollama branch and the critic-fallback ruling). The
# default model is a code-specialised model the user pulls locally; if it is
# not pulled, the review must fail honestly ("ollama pull qwen2.5-coder"),
# never fabricate findings.
DEFAULT_OLLAMA_MODEL = "qwen2.5-coder"
DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"


def build_ollama_llm(
    model: str = DEFAULT_OLLAMA_MODEL,
    base_url: str = DEFAULT_OLLAMA_BASE_URL,
) -> ChatOllama:
    """Build a local Ollama chat client. Construction does not open a
    connection — an unreachable server or an un-pulled model only surfaces on
    the first call, which the review path turns into an honest empty state."""
    return ChatOllama(model=model, base_url=base_url, temperature=0.1)
