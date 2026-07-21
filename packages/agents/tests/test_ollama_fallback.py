"""Ollama as the safety fallback + honest empty state.

Integrity rule under test: when an Ollama-backed review can't actually run
(server unreachable, model not pulled, or a localhost server on the SaaS tier),
the system reports it honestly — it NEVER emits a review-shaped, falsely-"clean"
result implying the code was reviewed.
"""

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

import arete_agents.llm.ollama as ollama
from arete_agents.config import Settings
from arete_agents.llm.base import ROLE_KEYS, get_llms_by_role


def _tags_response(names):
    resp = MagicMock()
    resp.raise_for_status.return_value = None
    resp.json.return_value = {"models": [{"name": n} for n in names]}
    return resp


def test_ollama_available_true_when_model_pulled():
    with patch.object(ollama.httpx, "get", return_value=_tags_response(["qwen2.5-coder:latest"])):
        ok, reason = ollama.ollama_available("http://localhost:11434", "qwen2.5-coder")
    assert ok is True
    assert reason is None


def test_ollama_available_false_with_pull_hint_when_model_missing():
    with patch.object(ollama.httpx, "get", return_value=_tags_response(["llama3:latest"])):
        ok, reason = ollama.ollama_available("http://localhost:11434", "qwen2.5-coder")
    assert ok is False
    assert "ollama pull qwen2.5-coder" in reason


def test_ollama_available_false_when_server_unreachable():
    with patch.object(ollama.httpx, "get", side_effect=OSError("connection refused")):
        ok, reason = ollama.ollama_available("http://localhost:11434", "qwen2.5-coder")
    assert ok is False
    assert "unreachable" in reason.lower()


def test_saas_tier_refuses_localhost_without_probing():
    # No httpx call should be needed — SaaS can't reach localhost by definition.
    with patch.object(ollama.httpx, "get", side_effect=AssertionError("must not probe")):
        reason = ollama.ollama_unavailable_reason(
            "http://localhost:11434", "qwen2.5-coder", deployment_tier="saas"
        )
    assert reason is not None
    assert "saas" in reason.lower()
    assert "localhost" in reason.lower()


def test_ollama_settings_need_no_api_key():
    # The fallback target must be constructable with no key and build clients.
    s = Settings(llm_provider="ollama", anthropic_api_key="")
    llms = get_llms_by_role(s)
    assert set(llms) == set(ROLE_KEYS)
    # Ollama rides the openai-v2 hook (ChatOpenAI on /v1) — see
    # test_build_ollama_llm_uses_model_and_base_url in test_llm_providers.py.
    assert "openai" in type(llms["security"]).__module__.lower()


def _min_pr(**extra):
    body = {"repo": "o/r", "pr_number": 1, "title": "t", "description": "d", "files": []}
    body.update(extra)
    return body


def test_review_returns_503_when_ollama_unavailable():
    import arete_agents.server as server

    with patch.object(
        server, "ollama_unavailable_reason",
        return_value="Ollama model 'qwen2.5-coder' is not pulled. Run: ollama pull qwen2.5-coder",
    ), patch.object(server, "get_llms_by_role_from_config") as from_config:
        client = TestClient(server.app)
        resp = client.post("/review", json=_min_pr(llm={"provider": "ollama"}))

    assert resp.status_code == 503
    assert "ollama pull qwen2.5-coder" in resp.text
    # Never built a client / ran a fabricated review.
    from_config.assert_not_called()


def test_review_proceeds_when_ollama_available():
    import arete_agents.server as server

    fake_orch = MagicMock()
    fake_orch.run.return_value = {"ok": True}
    with patch.object(server, "ollama_unavailable_reason", return_value=None), patch.object(
        server, "get_llms_by_role_from_config", return_value={"security": MagicMock()}
    ), patch.object(server, "ReviewOrchestrator", return_value=fake_orch):
        client = TestClient(server.app)
        resp = client.post("/review", json=_min_pr(llm={"provider": "ollama", "model": "qwen2.5-coder"}))

    assert resp.status_code == 200
    fake_orch.run.assert_called_once()
