import httpx
from langchain_ollama import ChatOllama

# Ollama has no opus/sonnet tiering — a single local model serves every role
# (see get_llms_by_role's ollama branch and the critic-fallback ruling). The
# default model is a code-specialised model the user pulls locally; if it is
# not pulled, the review must fail honestly ("ollama pull qwen2.5-coder"),
# never fabricate findings.
DEFAULT_OLLAMA_MODEL = "qwen2.5-coder"
# IPv4 127.0.0.1, not `localhost`: Ollama binds IPv4 only, and Node/httpx often
# resolve `localhost` to IPv6 ::1 first, which refuses the connection.
DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434"


def build_ollama_llm(
    model: str = DEFAULT_OLLAMA_MODEL,
    base_url: str = DEFAULT_OLLAMA_BASE_URL,
) -> ChatOllama:
    """Build a local Ollama chat client. Construction does not open a
    connection — an unreachable server or an un-pulled model only surfaces on
    the first call, which the review path turns into an honest empty state."""
    return ChatOllama(model=model, base_url=base_url, temperature=0.1)


def _is_localhost(base_url: str) -> bool:
    return any(h in base_url for h in ("localhost", "127.0.0.1", "::1"))


def ollama_available(
    base_url: str, model: str, timeout: float = 2.0
) -> tuple[bool, str | None]:
    """Probe a running Ollama server for ``model``. Returns (True, None) when
    the model is pulled and reachable, else (False, honest reason). Never
    raises — an unreachable server or un-pulled model is a normal, reportable
    state, not an error to swallow."""
    try:
        resp = httpx.get(f"{base_url.rstrip('/')}/api/tags", timeout=timeout)
        resp.raise_for_status()
        names = [m.get("name", "") for m in resp.json().get("models", [])]
    except Exception as exc:
        return False, (
            f"Ollama server is unreachable at {base_url} ({exc}). "
            f"Start it with `ollama serve`."
        )
    # tags report e.g. "qwen2.5-coder:latest"; match on the bare model name too.
    if not any(n == model or n.split(":", 1)[0] == model for n in names):
        return False, (
            f"Ollama model '{model}' is not pulled at {base_url}. "
            f"Run: ollama pull {model}"
        )
    return True, None


def ollama_unavailable_reason(
    base_url: str, model: str, deployment_tier: str = "local"
) -> str | None:
    """Return an honest reason string if an Ollama-backed review cannot run, or
    None if it can. On the SaaS tier a localhost base_url is unreachable by
    definition — say so without probing. This is what lets /review refuse to
    emit a review-shaped (falsely 'clean') result when no model actually ran."""
    if deployment_tier == "saas" and _is_localhost(base_url):
        return (
            f"The hosted (SaaS) tier cannot reach a localhost Ollama server "
            f"({base_url}). Point baseUrl at a reachable Ollama, or use a cloud "
            f"provider by connecting your own model."
        )
    _, reason = ollama_available(base_url, model)
    return reason
