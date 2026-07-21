"""POST /scan — repo-wide specialist scan, critic-grounded findings.

The scan briefs the six specialists on the WHOLE repo (code map for structure,
targeted file reads for content) instead of a PR diff. Anti-fabrication is
enforced deterministically here: a finding without real {path, line} evidence
that resolves against the actual checkout is DROPPED, an empty scan is an
honest no_findings, and the endpoint mirrors /review's BYO-model / lazy-boot /
Ollama-503 structure exactly (keyless boot must survive).
"""

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from tests.conftest import INTERNAL_HEADERS

from arete_agents.models.pr import ScanRequest
from arete_agents.scan import run_scan


def _checkout(tmp_path, installation_id=42, repo_slug="acme/shop"):
    """Create a fake cached checkout with one real 6-line source file."""
    repo_dir = tmp_path / str(installation_id) / repo_slug.replace("/", "__")
    target = repo_dir / "app" / "api" / "reports.ts"
    target.parent.mkdir(parents=True)
    target.write_text(
        "import { db } from '../data/db'\n"
        "export function reports(q) {\n"
        "  return db.raw(q)\n"
        "}\n"
        "// eof\n"
        "\n",
        encoding="utf-8",
    )
    return repo_dir


def _graph():
    return {
        "nodes": [
            {"id": "app/api/reports.ts", "kind": "File", "path": "app/api/reports.ts", "degree": 5},
            {"id": "app", "kind": "Folder", "path": "app", "degree": 9},
        ],
        "edges": [],
    }


def _finding(**overrides):
    f = {
        "kind": "issue",
        "title": "SQL built from raw request input",
        "detail": "reports() passes q straight into db.raw.",
        "evidence": [{"path": "app/api/reports.ts", "line": 3, "excerpt": "db.raw(q)"}],
        "confidence": 0.8,
    }
    f.update(overrides)
    return f


def _run(tmp_path, findings_by_dim):
    """run_scan with graph + specialists stubbed; findings_by_dim maps
    dimension -> list of raw finding dicts the stubbed specialist returns."""
    req = ScanRequest(installationId=42, repoSlug="acme/shop")
    _checkout(tmp_path)
    with patch("arete_agents.scan.build_graph_export", return_value=_graph()), patch(
        "arete_agents.scan.brief_specialist",
        side_effect=lambda llm, dimension, sources: findings_by_dim.get(dimension, []),
    ):
        return run_scan(req, {"security": MagicMock()}, repo_root=tmp_path)


def test_evidence_free_finding_is_dropped(tmp_path):
    result = _run(tmp_path, {"security": [_finding(evidence=[])]})
    assert result.findings == []
    assert result.status == "no_findings"


def test_ungrounded_evidence_path_is_dropped(tmp_path):
    ghost = _finding(evidence=[{"path": "src/made-up.ts", "line": 3}])
    out_of_range = _finding(evidence=[{"path": "app/api/reports.ts", "line": 9999}])
    result = _run(tmp_path, {"security": [ghost], "quality": [out_of_range]})
    assert result.findings == []
    assert result.status == "no_findings"


def test_grounded_finding_survives_with_real_confidence(tmp_path):
    result = _run(tmp_path, {"security": [_finding()]})
    assert result.status == "complete"
    assert len(result.findings) == 1
    f = result.findings[0]
    assert f.dimension == "security"
    assert f.kind == "issue"
    assert f.confidence == 0.8
    assert f.evidence[0]["path"] == "app/api/reports.ts"
    assert f.evidence[0]["line"] == 3


def test_empty_scan_is_honest_no_findings(tmp_path):
    result = _run(tmp_path, {})
    assert result.status == "no_findings"
    assert result.findings == []


def test_scan_endpoint_builds_clients_from_llm_block():
    import arete_agents.server as server

    captured = {}

    def fake_from_config(provider, model=None, api_key=None, base_url=None):
        captured.update(
            provider=provider, model=model, api_key=api_key, base_url=base_url
        )
        return {"security": MagicMock()}

    fake_response = MagicMock()
    fake_response.model_dump.return_value = {"status": "no_findings", "findings": []}

    with patch.object(
        server, "get_llms_by_role_from_config", side_effect=fake_from_config
    ), patch.object(server, "run_scan", return_value=fake_response) as run_mock, patch.object(
        server, "ollama_unavailable_reason", return_value=None
    ):
        client = TestClient(server.app, headers=INTERNAL_HEADERS)
        resp = client.post(
            "/scan",
            json={
                "installationId": 42,
                "repoSlug": "acme/shop",
                "llm": {
                    "provider": "anthropic",
                    "model": "claude-opus-4",
                    "apiKey": "sk-user",
                },
            },
        )

    assert resp.status_code == 200
    assert captured == {
        "provider": "anthropic",
        "model": "claude-opus-4",
        "api_key": "sk-user",
        "base_url": None,
    }
    run_mock.assert_called_once()


def test_scan_endpoint_503s_when_ollama_unavailable():
    import arete_agents.server as server

    hint = "Ollama is not reachable. Run `ollama pull llama3` and retry."
    with patch.object(
        server, "ollama_unavailable_reason", return_value=hint
    ), patch.object(server, "run_scan") as run_mock:
        client = TestClient(server.app, headers=INTERNAL_HEADERS)
        resp = client.post(
            "/scan",
            json={
                "installationId": 42,
                "repoSlug": "acme/shop",
                "llm": {"provider": "ollama", "model": "llama3"},
            },
        )

    assert resp.status_code == 503
    assert "ollama pull" in resp.text
    run_mock.assert_not_called()
