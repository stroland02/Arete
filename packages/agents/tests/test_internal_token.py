"""arete_agents.internal_token -- Python counterpart to @arete/internal-token
(Task 1, packages/internal-token). Mints and verifies the signed, short-lived
HS256 JWTs that identify one internal Areté service to another over the
service-to-service surface internal_auth.py guards (review finding B4).

CROSS-LANGUAGE CONTRACT: docs/superpowers/fixtures/internal-token-vector.json
is a token TypeScript's mintInternalToken produced for a FIXED key/iss/iat.
mint_internal_token here MUST reproduce that exact compact JWT string for the
same inputs -- byte for byte -- and verify_internal_token must accept it
before the fixture's `exp` and report `expired` after. This is the guard that
the two services' wire formats never silently drift apart (see
packages/internal-token/src/vector.test.ts, its TS twin).
"""

import json
from pathlib import Path

import jwt as pyjwt
import pytest

from arete_agents.config import get_settings
from arete_agents.internal_token import (
    InternalTokenKeyset,
    InternalTokenNotConfigured,
    VerifyResult,
    load_keyset,
    mint_internal_token,
    verify_internal_token,
)

FIXTURE_PATH = (
    Path(__file__).resolve().parents[3]
    / "docs"
    / "superpowers"
    / "fixtures"
    / "internal-token-vector.json"
)

TEST_KEYS = {"k1": "a" * 48}
TEST_ACTIVE_KID = "k1"


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    # internal_token.load_keyset() consults Settings first (so .env is
    # honoured); a stale cached Settings object from an earlier test module
    # would make every env change below invisible.
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def keyset_env(monkeypatch):
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEYS", json.dumps(TEST_KEYS))
    monkeypatch.setenv("INTERNAL_TOKEN_ACTIVE_KID", TEST_ACTIVE_KID)
    monkeypatch.delenv("INTERNAL_TOKEN_TTL_SECONDS", raising=False)


# ---------------------------------------------------------------------------
# load_keyset
# ---------------------------------------------------------------------------


def test_load_keyset_returns_none_when_signing_keys_env_is_missing(monkeypatch):
    monkeypatch.delenv("INTERNAL_TOKEN_SIGNING_KEYS", raising=False)
    monkeypatch.delenv("INTERNAL_TOKEN_ACTIVE_KID", raising=False)
    assert load_keyset() is None


def test_load_keyset_returns_none_for_an_empty_object(monkeypatch):
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEYS", "{}")
    monkeypatch.setenv("INTERNAL_TOKEN_ACTIVE_KID", "k1")
    assert load_keyset() is None


def test_load_keyset_returns_none_for_unparseable_json(monkeypatch):
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEYS", "not-json")
    monkeypatch.setenv("INTERNAL_TOKEN_ACTIVE_KID", "k1")
    assert load_keyset() is None


def test_load_keyset_returns_none_when_active_kid_is_not_in_keys(monkeypatch, keyset_env):
    monkeypatch.setenv("INTERNAL_TOKEN_ACTIVE_KID", "nope")
    assert load_keyset() is None


def test_load_keyset_returns_none_when_active_kid_is_absent(monkeypatch, keyset_env):
    monkeypatch.delenv("INTERNAL_TOKEN_ACTIVE_KID", raising=False)
    assert load_keyset() is None


def test_load_keyset_returns_the_parsed_keyset_and_active_kid(keyset_env):
    keyset = load_keyset()
    assert keyset == InternalTokenKeyset(keys=TEST_KEYS, active_kid="k1")


# ---------------------------------------------------------------------------
# InternalTokenNotConfigured -- raised only for an unconfigured keyset, never
# for a bad/expired/tampered token.
# ---------------------------------------------------------------------------


def test_mint_raises_not_configured_when_the_keyset_is_missing(monkeypatch):
    monkeypatch.delenv("INTERNAL_TOKEN_SIGNING_KEYS", raising=False)
    with pytest.raises(InternalTokenNotConfigured):
        mint_internal_token("arete-webhook")


def test_verify_raises_not_configured_when_the_keyset_is_missing(monkeypatch):
    monkeypatch.delenv("INTERNAL_TOKEN_SIGNING_KEYS", raising=False)
    with pytest.raises(InternalTokenNotConfigured):
        verify_internal_token("Bearer x")


# ---------------------------------------------------------------------------
# round trip + determinism
# ---------------------------------------------------------------------------


def test_round_trip_mint_then_verify(keyset_env):
    token = mint_internal_token("arete-webhook", now=1_700_000_000)
    result = verify_internal_token(f"Bearer {token}", now=1_700_000_050)
    assert result == VerifyResult(ok=True, reason=None, iss="arete-webhook", kid="k1")


def test_mint_is_deterministic_for_a_fixed_now(keyset_env):
    a = mint_internal_token("arete-webhook", now=1_700_000_000)
    b = mint_internal_token("arete-webhook", now=1_700_000_000)
    assert a == b


def test_mint_produces_a_compact_jwt_with_the_active_kid_and_default_ttl(keyset_env):
    now = 1_700_000_000
    token = mint_internal_token("arete-webhook", now=now)
    parts = token.split(".")
    assert len(parts) == 3

    header = pyjwt.get_unverified_header(token)
    assert header == {"alg": "HS256", "typ": "JWT", "kid": "k1"}

    claims = pyjwt.decode(
        token,
        "a" * 48,
        algorithms=["HS256"],
        audience="arete-internal",
        options={"verify_exp": False},  # `now` here is 2023; only the claim shape is under test
    )
    assert claims == {"iss": "arete-webhook", "aud": "arete-internal", "iat": now, "exp": now + 120}


# ---------------------------------------------------------------------------
# the six verify failure reasons (TS reason strings, verbatim)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("header", [None, ""])
def test_verify_returns_no_header_when_authorization_is_absent_or_empty(keyset_env, header):
    result = verify_internal_token(header)
    assert result == VerifyResult(ok=False, reason="no_header")


@pytest.mark.parametrize("header", ["s3cret", "Basic abc123", "Bearer", "Bearer "])
def test_verify_returns_malformed_for_a_non_bearer_header(keyset_env, header):
    result = verify_internal_token(header)
    assert result.ok is False
    assert result.reason == "malformed"


def test_verify_returns_malformed_for_a_bearer_value_that_is_not_a_parseable_jwt(keyset_env):
    result = verify_internal_token("Bearer not-a-jwt")
    assert result == VerifyResult(ok=False, reason="malformed")


def test_verify_returns_unknown_kid_when_the_kid_was_revoked(monkeypatch, keyset_env):
    token = mint_internal_token("arete-webhook", now=1_700_000_000)
    # Revoke: the kid the token was signed with no longer exists in the keyset.
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEYS", json.dumps({"k2": "b" * 48}))
    monkeypatch.setenv("INTERNAL_TOKEN_ACTIVE_KID", "k2")
    result = verify_internal_token(f"Bearer {token}", now=1_700_000_050)
    assert result == VerifyResult(ok=False, reason="unknown_kid")


def test_verify_accepts_a_token_signed_by_a_non_active_kid_still_present(monkeypatch, keyset_env):
    token = mint_internal_token("arete-webhook", now=1_700_000_000)  # signed with k1
    # Rotation window: k1 still present in the keyset, but no longer active.
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEYS", json.dumps({"k1": "a" * 48, "k2": "b" * 48}))
    monkeypatch.setenv("INTERNAL_TOKEN_ACTIVE_KID", "k2")
    result = verify_internal_token(f"Bearer {token}", now=1_700_000_050)
    assert result.ok is True
    assert result.kid == "k1"


def test_verify_returns_bad_signature_for_a_tampered_token(keyset_env):
    token = mint_internal_token("arete-webhook", now=1_700_000_000)
    tampered = token[:-2] + ("bb" if token.endswith("aa") else "aa")
    result = verify_internal_token(f"Bearer {tampered}", now=1_700_000_050)
    assert result == VerifyResult(ok=False, reason="bad_signature")


def test_verify_returns_bad_signature_for_a_token_signed_with_a_different_secret(keyset_env):
    other_token = pyjwt.encode(
        {"iss": "arete-webhook", "aud": "arete-internal", "iat": 1_700_000_000, "exp": 1_700_000_120},
        "not-the-real-secret" * 3,
        algorithm="HS256",
        headers={"kid": "k1"},
    )
    result = verify_internal_token(f"Bearer {other_token}", now=1_700_000_050)
    assert result == VerifyResult(ok=False, reason="bad_signature")


def test_verify_returns_expired_past_the_ttl(keyset_env):
    token = mint_internal_token("arete-webhook", now=1_700_000_000)
    result = verify_internal_token(f"Bearer {token}", now=1_700_000_000 + 200)
    assert result == VerifyResult(ok=False, reason="expired")


def test_verify_returns_expired_exactly_at_the_leeway_boundary(keyset_env):
    # jose (the TS side) expires when `now >= exp + tolerance`. At the exact
    # boundary instant `now == exp + leeway`, a strict `>` check would ACCEPT
    # here while TS REJECTS -- a cross-language parity bug. Pin `>=`.
    now = 1_700_000_000
    token = mint_internal_token("arete-webhook", now=now)  # exp = now + 120 (default TTL)
    boundary = now + 120 + 5  # exp + _LEEWAY_SECONDS, exactly
    result = verify_internal_token(f"Bearer {token}", now=boundary)
    assert result == VerifyResult(ok=False, reason="expired")


# wrong_audience -- a gap Task 1 (TS) flagged it could never reach, because
# mintInternalToken always sets aud itself. Python can, by crafting the token
# directly with PyJWT rather than going through mint_internal_token.
def test_verify_returns_wrong_audience_for_a_token_minted_with_a_different_audience(keyset_env):
    now = 1_700_000_000
    bad_aud_token = pyjwt.encode(
        {"iss": "arete-webhook", "aud": "something-else", "iat": now, "exp": now + 120},
        "a" * 48,
        algorithm="HS256",
        headers={"kid": "k1"},
    )
    result = verify_internal_token(f"Bearer {bad_aud_token}", now=now + 10)
    assert result == VerifyResult(ok=False, reason="wrong_audience")


# ---------------------------------------------------------------------------
# SHARED-VECTOR reproduction -- the cross-language pin. If this ever needs to
# change, the wire format has drifted and packages/internal-token (TS) must
# change with it.
# ---------------------------------------------------------------------------


@pytest.fixture
def vector():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def vector_env(monkeypatch, vector):
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEYS", json.dumps(vector["input"]["keys"]))
    monkeypatch.setenv("INTERNAL_TOKEN_ACTIVE_KID", vector["input"]["activeKid"])
    # The fixture's exp is pinned to the default 120s TTL. conftest.py sets
    # INTERNAL_TOKEN_TTL_SECONDS process-wide (86400s) so its own
    # collection-time token outlives the suite -- scope it back out here so
    # this vector reproduction isn't perturbed by that unrelated env var.
    monkeypatch.delenv("INTERNAL_TOKEN_TTL_SECONDS", raising=False)


def test_mint_reproduces_the_exact_fixture_token(vector, vector_env):
    token = mint_internal_token(vector["input"]["iss"], now=vector["input"]["iat"])
    assert token == vector["token"]


def test_verify_accepts_the_fixture_token_before_expiry(vector, vector_env):
    result = verify_internal_token(f"Bearer {vector['token']}", now=vector["verify"]["acceptsAtNow"])
    assert result == VerifyResult(
        ok=True, reason=None, iss=vector["input"]["iss"], kid=vector["input"]["activeKid"]
    )


def test_verify_reports_expired_for_the_fixture_token_past_exp(vector, vector_env):
    result = verify_internal_token(f"Bearer {vector['token']}", now=vector["verify"]["expiredAtNow"])
    assert result == VerifyResult(ok=False, reason="expired")
