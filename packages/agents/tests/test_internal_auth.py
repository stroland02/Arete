"""Shared-token guard for the agents service's service-to-service surface
(review finding B4).

POST /review was completely unauthenticated. Both `installationId` and `repo`
arrive in the same caller-supplied PRContext, and this process holds its own
INTERNAL_API_TOKEN, so anyone with network reach could name a victim
installation + repo and -- via injected content in `files[].patch` or
`description` that induces an add_project_memory call -- write into that
tenant's repo using OUR credential. Those rows are re-injected into that
tenant's every future review prompt (fetchProjectMemories -> base.py), which
is why an open /review is a cross-tenant WRITE vector, not just a free-compute
one.

Spec section 6 gate 4 requires internal endpoints to keep the fail-closed
bearer-token pattern. This mirrors packages/webhook/src/internal-auth.ts:
Bearer parse, length check, constant-time compare, 401 on mismatch, and a
fail-closed 503 when the token is not configured at all.

These are the mutation tests Global Constraint 10 requires: a gate never
observed rejecting is not known to work.
"""

import pytest
from fastapi.testclient import TestClient

from arete_agents.config import get_settings
from arete_agents.internal_auth import require_internal_token, token_matches


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    from arete_agents.server import app

    return TestClient(app, raise_server_exceptions=False)


# A PRContext-shaped body naming a VICTIM tenant. It must never get far enough
# for the shape to matter -- the guard runs before the handler.
VICTIM_REVIEW = {
    "installationId": 999,
    "repo": "victim-org/victim-repo",
    "pr_number": 1,
    "title": "t",
    "description": "d",
    "files": [],
}

GUARDED_POSTS = [
    ("/review", VICTIM_REVIEW),
    ("/scan", {"installationId": 999, "repo": "victim-org/victim-repo"}),
    ("/fix", {"workItemId": "w1", "installationId": 999, "repo": "victim-org/victim-repo"}),
    ("/chat", {"user_reply": "hi"}),
    ("/approvals/apply", {"approvalId": "a", "reviewId": "r", "command": "c"}),
    (
        "/context-map/index",
        {
            "installation_id": 999,
            "repo_slug": "victim-org/victim-repo",
            "clone_url": "https://github.com/victim-org/victim-repo.git",
            "installation_token": "t",
        },
    ),
]


@pytest.mark.parametrize("path,body", GUARDED_POSTS)
def test_rejects_a_request_with_no_token_at_all(client, monkeypatch, path, body):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "s3cret")
    get_settings.cache_clear()

    response = client.post(path, json=body)

    assert response.status_code == 401


@pytest.mark.parametrize("path,body", GUARDED_POSTS)
def test_rejects_a_request_with_the_wrong_token(client, monkeypatch, path, body):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "s3cret")
    get_settings.cache_clear()

    response = client.post(path, json=body, headers={"Authorization": "Bearer wrong"})

    assert response.status_code == 401


@pytest.mark.parametrize("path,body", GUARDED_POSTS)
def test_fails_closed_with_503_when_the_token_is_not_configured(client, monkeypatch, path, body):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "")
    get_settings.cache_clear()

    response = client.post(path, json=body, headers={"Authorization": "Bearer anything"})

    # 503, not 200 and not 401: an unconfigured guard is a loud prod misconfig,
    # never a surface that silently runs open.
    assert response.status_code == 503


def test_a_correct_token_passes_the_guard(client, monkeypatch):
    """The guard must not be a brick. With the right bearer the request gets
    PAST auth and into the handler -- which then fails on its own terms (no
    real LLM here). The only property asserted is 'not rejected by the guard'."""
    monkeypatch.setenv("INTERNAL_API_TOKEN", "s3cret")
    get_settings.cache_clear()

    response = client.post(
        "/approvals/apply",
        json={"approvalId": "a", "reviewId": "r", "command": "echo hi"},
        headers={"Authorization": "Bearer s3cret"},
    )

    assert response.status_code not in (401, 503)


# The read-side twin of B4: GET /context-map/ui-url/{id} and
# GET /context-map/graph/{id} took an installation id straight from the URL
# path and returned that tenant's code graph with no auth of any kind --
# anyone with network reach to this port could read any tenant's code graph
# by iterating ids. A VICTIM installation id, exactly like VICTIM_REVIEW
# above: the guard must reject before the handler ever looks it up.
VICTIM_INSTALLATION_ID = 999

GUARDED_GETS = [
    f"/context-map/ui-url/{VICTIM_INSTALLATION_ID}",
    f"/context-map/graph/{VICTIM_INSTALLATION_ID}",
]


@pytest.mark.parametrize("path", GUARDED_GETS)
def test_get_routes_reject_a_request_with_no_token_at_all(client, monkeypatch, path):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "s3cret")
    get_settings.cache_clear()

    response = client.get(path)

    assert response.status_code == 401
    # No tenant data leaks in the rejection body -- just the guard's own detail.
    assert response.json() == {"detail": "unauthorized"}


@pytest.mark.parametrize("path", GUARDED_GETS)
def test_get_routes_reject_a_request_with_the_wrong_token(client, monkeypatch, path):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "s3cret")
    get_settings.cache_clear()

    response = client.get(path, headers={"Authorization": "Bearer wrong"})

    assert response.status_code == 401
    assert response.json() == {"detail": "unauthorized"}


@pytest.mark.parametrize("path", GUARDED_GETS)
def test_get_routes_fail_closed_503_when_the_token_is_not_configured(
    client, monkeypatch, path
):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "")
    get_settings.cache_clear()

    response = client.get(path, headers={"Authorization": "Bearer anything"})

    # 503, not 200 and not 401: an unconfigured guard is a loud prod
    # misconfiguration, never a surface that silently runs open.
    assert response.status_code == 503


@pytest.mark.parametrize("path", GUARDED_GETS)
def test_get_routes_pass_with_correct_token(client, monkeypatch, path):
    """The guard must not be a brick on the read side either. With the right
    bearer the request reaches the handler, which -- for an installation id
    with nothing indexed -- returns its own honest empty state, not a 401/503
    from the guard."""
    monkeypatch.setenv("INTERNAL_API_TOKEN", "s3cret")
    get_settings.cache_clear()

    response = client.get(path, headers={"Authorization": "Bearer s3cret"})

    assert response.status_code not in (401, 503)
    assert response.json()["available"] is False


def test_health_is_never_guarded(client, monkeypatch):
    """Container healthchecks carry no bearer. A guarded /health would make the
    fail-closed posture take the whole service down on a misconfig."""
    monkeypatch.setenv("INTERNAL_API_TOKEN", "s3cret")
    get_settings.cache_clear()

    assert client.get("/health").status_code == 200


@pytest.mark.parametrize(
    "header",
    [
        None,
        "",
        "s3cret",  # no scheme
        "Basic s3cret",  # wrong scheme
        "Bearer",  # scheme with no credential
        "Bearer ",
        "Bearer s3cre",  # prefix of the real token
        "Bearer s3crett",  # real token plus a byte
        "Bearer S3CRET",  # case differs
    ],
)
def test_token_matches_rejects_malformed_and_near_miss_headers(header):
    assert token_matches(header, "s3cret") is False


@pytest.mark.parametrize("header", ["Bearer s3cret", "bearer s3cret", "BEARER  s3cret"])
def test_token_matches_accepts_the_real_token(header):
    assert token_matches(header, "s3cret") is True


def test_require_internal_token_is_a_no_op_for_a_valid_header(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "s3cret")
    get_settings.cache_clear()
    assert require_internal_token("Bearer s3cret") is None
