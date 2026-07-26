"""POST /review honors a per-request BYO model config.

When the request carries an `llm` block, the review must build its clients from
THAT config (get_llms_by_role_from_config) — the user's own model — not the
server's global Settings singleton. When it doesn't, the global orchestrator is
used unchanged.
"""

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from tests.conftest import INTERNAL_HEADERS


def _min_pr(**extra):
    body = {
        "repo": "owner/repo",
        "pr_number": 1,
        "title": "t",
        "description": "d",
        "files": [],
    }
    body.update(extra)
    return body


def test_review_builds_from_per_request_config():
    import arete_agents.server as server

    captured = {}

    def fake_from_config(provider, model=None, api_key=None, base_url=None):
        captured.update(
            provider=provider, model=model, api_key=api_key, base_url=base_url
        )
        return {"security": MagicMock()}

    fake_orch = MagicMock()
    fake_orch.run.return_value = {"ok": True}

    # The global orchestrator is a LAZY singleton (None until first default-path
    # /review) — patch its accessor, not the module attribute.
    global_orch = MagicMock()

    with patch.object(
        server, "get_llms_by_role_from_config", side_effect=fake_from_config
    ), patch.object(server, "ReviewOrchestrator", return_value=fake_orch) as OrchCls, patch.object(
        server, "_get_orchestrator", return_value=global_orch
    ), patch.object(
        server, "ollama_unavailable_reason", return_value=None
    ):
        client = TestClient(server.app, headers=INTERNAL_HEADERS)
        resp = client.post(
            "/review",
            json=_min_pr(
                llm={
                    "provider": "ollama",
                    "model": "llama3",
                    "baseUrl": "http://host:11434",
                }
            ),
        )

    assert resp.status_code == 200
    # Built from the passed config...
    assert captured == {
        "provider": "ollama",
        "model": "llama3",
        "api_key": None,
        "base_url": "http://host:11434",
    }
    OrchCls.assert_called_once()  # a fresh orchestrator on the user's model
    global_orch.run.assert_not_called()  # NOT the global singleton


def test_review_falls_back_to_global_without_config():
    import arete_agents.server as server

    global_orch = MagicMock()
    global_orch.run.return_value = {"ok": "global"}

    with patch.object(
        server, "_get_orchestrator", return_value=global_orch
    ), patch.object(
        server, "get_llms_by_role_from_config"
    ) as from_config, patch.object(
        server, "ollama_unavailable_reason", return_value=None
    ):
        client = TestClient(server.app, headers=INTERNAL_HEADERS)
        resp = client.post("/review", json=_min_pr())
    global_run = global_orch.run

    assert resp.status_code == 200
    global_run.assert_called_once()
    from_config.assert_not_called()  # no per-request build when llm omitted


def test_review_rejects_unknown_provider_with_400():
    import arete_agents.server as server

    def boom(*a, **k):
        raise ValueError("Unknown LLM provider: 'openai'")

    with patch.object(server, "get_llms_by_role_from_config", side_effect=boom):
        client = TestClient(server.app, headers=INTERNAL_HEADERS)
        resp = client.post("/review", json=_min_pr(llm={"provider": "openai"}))

    assert resp.status_code == 400
    assert "Unknown LLM provider" in resp.text


def test_review_config_accepts_snake_case_aliases():
    # Python/CLI callers may send api_key/base_url (snake_case) instead of the
    # webhook camelCase — populate_by_name must accept both.
    import arete_agents.server as server

    captured = {}

    def fake_from_config(provider, model=None, api_key=None, base_url=None):
        captured.update(api_key=api_key, base_url=base_url)
        return {"security": MagicMock()}

    fake_orch = MagicMock()
    fake_orch.run.return_value = {"ok": True}

    with patch.object(
        server, "get_llms_by_role_from_config", side_effect=fake_from_config
    ), patch.object(server, "ReviewOrchestrator", return_value=fake_orch):
        client = TestClient(server.app, headers=INTERNAL_HEADERS)
        resp = client.post(
            "/review",
            json=_min_pr(
                llm={
                    "provider": "anthropic",
                    "api_key": "sk-snake",
                    "base_url": "http://x",
                }
            ),
        )

    assert resp.status_code == 200
    assert captured == {"api_key": "sk-snake", "base_url": "http://x"}
