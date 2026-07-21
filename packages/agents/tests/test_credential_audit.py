"""§6 gate 1: credentials travel in headers, never URLs or query params.

The wire-level test uses httpx.MockTransport so the openai-compatible path
(openai, openrouter, ollama) is proven at the actual request; anthropic and
gemini are proven by constructed-client inspection (their SDKs own the wire).
"""

import httpx
from langchain_openai import ChatOpenAI

from arete_agents.llm.anthropic import build_anthropic_llm
from arete_agents.llm.gemini import build_gemini_llm
from arete_agents.llm.ollama import build_ollama_llm
from arete_agents.llm.openai import build_openai_llm

CANARY = "arete-audit-canary-key-12345"

_URL_FIELD_NAMES = (
    "base_url",
    "openai_api_base",
    "anthropic_api_url",
    "endpoint",
    "api_base",
)


def _url_fields(client) -> list[str]:
    values = []
    for name in _URL_FIELD_NAMES:
        value = getattr(client, name, None)
        if value:
            values.append(str(value))
    return values


def test_anthropic_key_never_in_url_fields():
    llm = build_anthropic_llm(CANARY)
    assert all(CANARY not in url for url in _url_fields(llm))


def test_openai_key_never_in_url_fields():
    llm = build_openai_llm(api_key=CANARY)
    assert all(CANARY not in url for url in _url_fields(llm))


def test_gemini_key_never_in_url_fields_or_transport_host():
    llm = build_gemini_llm(CANARY)
    assert all(CANARY not in url for url in _url_fields(llm))
    transport = getattr(getattr(llm, "client", None), "_transport", None)
    host = str(getattr(transport, "host", ""))
    assert CANARY not in host


def test_openai_compatible_wire_key_in_header_not_url():
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers.get("authorization", "")
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-audit",
                "object": "chat.completion",
                "created": 0,
                "model": "audit-model",
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": "ok"},
                    "finish_reason": "stop",
                }],
                "usage": {
                    "prompt_tokens": 1,
                    "completion_tokens": 1,
                    "total_tokens": 2,
                },
            },
        )

    llm = ChatOpenAI(
        model="audit-model",
        api_key=CANARY,
        base_url="http://ollama.audit.test/v1",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    llm.invoke("ping")
    assert CANARY not in seen["url"]
    assert seen["authorization"] == f"Bearer {CANARY}"


def test_ollama_base_url_carries_no_credentials():
    llm = build_ollama_llm(base_url="http://127.0.0.1:11434")
    base = str(llm.openai_api_base)
    assert "key=" not in base and "@" not in base.split("//", 1)[1]
