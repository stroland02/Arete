import json
import os
from unittest.mock import MagicMock

import pytest
from langchain_core.messages import AIMessage

from arete_agents.internal_token import mint_internal_token
from arete_agents.models.pr import FileChange, PRContext

# The agents service's POST surface is behind the signed internal-token guard
# (arete_agents/internal_auth.py + internal_token.py, review finding B4) and
# FAILS CLOSED with 503 when no keyset is configured. Endpoint tests are
# standing in for our own server-side callers (packages/webhook,
# packages/dashboard), so they configure the keyset and present a token
# minted from it -- exactly as those callers do in production.
INTERNAL_TEST_KEYS = {"test-kid": "test-internal-token-signing-key-0123456789ab"}
INTERNAL_TEST_ACTIVE_KID = "test-kid"

# Set directly at collection time (not via monkeypatch, which is fixture-scoped)
# so the module-level mint_internal_token() call below -- building the
# constant INTERNAL_HEADERS many test modules import -- has a configured
# keyset to read.
os.environ.setdefault("INTERNAL_TOKEN_SIGNING_KEYS", json.dumps(INTERNAL_TEST_KEYS))
os.environ.setdefault("INTERNAL_TOKEN_ACTIVE_KID", INTERNAL_TEST_ACTIVE_KID)
# Collection-time mint below (INTERNAL_HEADERS) is a module-level constant that
# must stay valid for the entire suite run, not just 120s (the production
# default TTL) -- a suite that runs longer than that would see this token
# expire mid-run and every auth'd-endpoint test start returning 401
# (previously observed flakiness). Test-only; production TTL is untouched.
os.environ.setdefault("INTERNAL_TOKEN_TTL_SECONDS", "86400")

# Mirror CI's provider env (ci.yml test-agents job) at collection time so the
# LOCAL keyless sandbox exercises the SAME path CI and prod take, instead of
# the anthropic-default -> Settings() raises -> orchestrator blind-merge
# fallback path that masked 9 real full-pipeline failures. `test-key-not-real`
# is never a valid key: gemini provider construction is lazy (llm/gemini.py),
# every affected test injects a mock LLM, and CI proves no real network call is
# made under this env. setdefault (not overwrite) preserves a developer's real
# key if one is exported.
os.environ.setdefault("LLM_PROVIDER", "gemini")
os.environ.setdefault("GEMINI_API_KEY", "test-key-not-real")

INTERNAL_HEADERS = {"Authorization": f"Bearer {mint_internal_token('arete-webhook')}"}


@pytest.fixture(autouse=True)
def _internal_token_keyset(monkeypatch):
    """Configure the signing keyset for every test. Deliberately does NOT
    touch get_settings()'s cache: internal_token.load_keyset() falls back to
    the bare environment, and clearing a process-wide lru_cache under every
    test would perturb the many suites that seed Settings themselves."""
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEYS", json.dumps(INTERNAL_TEST_KEYS))
    monkeypatch.setenv("INTERNAL_TOKEN_ACTIVE_KID", INTERNAL_TEST_ACTIVE_KID)
    yield

SEC = (
    '{"comments": [{"path": "src/auth.py", "line": 5, "body": "SQL injection.", '
    '"severity": "error", "category": "security"}], "summary": "SQL injection."}'
)
PERF = '{"comments": [], "summary": "No performance issues."}'
QUAL = (
    '{"comments": [{"path": "src/auth.py", "line": 2, "body": "Use snake_case.", '
    '"severity": "info", "category": "quality"}], "summary": "Naming issue."}'
)
TEST_COV = (
    '{"comments": [{"path": "src/auth.py", "line": 8, "body": "Missing error test.", '
    '"severity": "warning", "category": "test_coverage"}], "summary": "Untested path."}'
)
DEPLOY = '{"comments": [], "summary": "No deployment risks."}'
BIZ = (
    '{"comments": [{"path": "src/auth.py", "line": 3, "body": "Missing audit log.", '
    '"severity": "warning", "category": "business_logic"}], "summary": "Audit gap."}'
)


@pytest.fixture
def sample_pr():
    return PRContext(
        repo="acme/api",
        pr_number=7,
        title="Fix login",
        description="Addresses auth bug",
        files=[
            FileChange(
                path="src/auth.py",
                patch="+SELECT * FROM users WHERE id='" + "+user_id",
                additions=1,
                deletions=0,
            )
        ],
    )


@pytest.fixture
def cyclic_llm():
    mock = MagicMock()
    mock.invoke.side_effect = [
        AIMessage(content=r)
        for r in [SEC, PERF, QUAL, TEST_COV, DEPLOY, BIZ] * 20
    ]
    mock.bind_tools.return_value = mock
    mock.with_retry.return_value = mock
    return mock
