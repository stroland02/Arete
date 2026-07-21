"""Signed, short-lived internal tokens -- the Python counterpart to
@arete/internal-token (Task 1, packages/internal-token), which mirrors this
module's mint/verify/loadKeyset one-for-one.

WHY THIS EXISTS. internal_auth.py's original guard compared a single static
shared secret with a constant-time equality check. A static secret has no
expiry, no scoping to an issuer, and no way to revoke one caller without
rotating the value for every caller at once. This module replaces it with
short-lived (120s default) HS256 JWTs: `{iss, aud: "arete-internal", iat,
exp}` under a keyset addressed by `kid`, so a compromised or rotated key can
be dropped from the keyset without touching any other caller's credential.

CROSS-LANGUAGE BYTE-FOR-BYTE CONTRACT (docs/superpowers/fixtures/
internal-token-vector.json). PyJWT's own `jwt.encode(..., headers=...)`
cannot be used to build the token: it always assembles the protected header
as `{"typ": ..., "alg": ...}.update(extra_headers)`, so the *key order* in
the resulting JSON is always `typ, alg, ...` (or, with `sort_headers=True`,
alphabetical -- `alg, kid, typ`). Neither matches the TS side's `jose`
`SignJWT.setProtectedHeader({alg, typ, kid})`, whose insertion order (and
hence its exact base64url bytes) is `alg, typ, kid`. mint_internal_token
therefore builds the compact JWS by hand -- explicit key order for both the
header and the claims, matching the TS object-literal order exactly -- and
signs with PyJWT's own HMACAlgorithm, so the cryptography is still 100%
PyJWT; only the JSON envelope assembly is explicit. This is verified
empirically, not by assumption: see the SHARED-VECTOR tests in
tests/test_internal_token.py, which assert byte-for-byte equality against a
token TS's mintInternalToken actually produced.

verify_internal_token is NOT affected by this: JSON object key order is
irrelevant to a JSON *parser* (jwt.get_unverified_header / jwt.decode parse
into a dict), so verification runs entirely through PyJWT's public API.
"""

import base64
import hashlib
import hmac
import json
import os
import re
import time
from dataclasses import dataclass

import jwt

INTERNAL_TOKEN_DEFAULT_TTL_SECONDS = 120

# Audience claim shared by every internal token -- the wire-format contract
# with the TypeScript side (packages/internal-token/src/mint.ts).
INTERNAL_TOKEN_AUDIENCE = "arete-internal"

_BEARER = re.compile(r"^Bearer\s+(.+)$", re.IGNORECASE)

# Signature verification is checked against the real signed bytes, so a
# tolerance here only smooths clock skew between processes -- it never
# widens what counts as a *valid* signature. Mirrors verify.ts's
# `clockTolerance: 5`.
_LEEWAY_SECONDS = 5


class InternalTokenNotConfigured(Exception):
    """Raised when the signing keyset itself is missing, unparseable, empty,
    or names an active kid absent from its own keys -- distinct from any
    bad-token verification result, so callers can answer 503 (misconfig)
    instead of 401 (unauthorized). Never raised for a bad/expired/tampered
    token; those are returned as `VerifyResult(ok=False, reason=...)`.
    Mirrors errors.ts's class of the same name.
    """


@dataclass(frozen=True)
class InternalTokenKeyset:
    """kid -> secret material (raw string, HMAC-256 key), plus the kid new
    tokens are minted with. `active_kid` is always a member of `keys` --
    load_keyset() never returns a keyset for which that isn't true."""

    keys: dict[str, str]
    active_kid: str


@dataclass(frozen=True)
class VerifyResult:
    """`ok=True` carries `iss`/`kid`; `ok=False` carries `reason`, one of
    `no_header|malformed|unknown_kid|bad_signature|expired|wrong_audience`
    -- the exact same reason strings as verify.ts's VerifyFailureReason."""

    ok: bool
    reason: str | None = None
    iss: str | None = None
    kid: str | None = None


def load_keyset() -> InternalTokenKeyset | None:
    """Loads the signing keyset from `INTERNAL_TOKEN_SIGNING_KEYS` (a JSON
    object mapping kid -> secret) and `INTERNAL_TOKEN_ACTIVE_KID`.

    Returns `None` -- never raises -- when the env is missing, unparseable,
    an empty object, or the active kid does not name a key present in the
    keyset. Callers (mint/verify) turn `None` into `InternalTokenNotConfigured`.
    Mirrors keyset.ts's loadKeyset() exactly.
    """
    raw_keys, active_kid = _read_keyset_env()
    if not raw_keys:
        return None

    try:
        parsed = json.loads(raw_keys)
    except (json.JSONDecodeError, TypeError):
        return None

    if not isinstance(parsed, dict) or not parsed:
        return None
    if not all(isinstance(k, str) and isinstance(v, str) for k, v in parsed.items()):
        return None

    if not active_kid or active_kid not in parsed:
        return None

    return InternalTokenKeyset(keys=parsed, active_kid=active_kid)


def _read_keyset_env() -> tuple[str, str]:
    """Settings first (so `.env` is honoured), bare-environment fallback (so
    a keyless boot can still REJECT) -- the identical ladder
    internal_auth.py's retired `configured_token()` used for the single
    static secret, now extended to the two keyset env vars. Settings()
    eagerly validates the LLM provider key, so an LLM-misconfigured process
    must still be able to load (and just as importantly, still be able to
    REJECT on) its own internal-token keyset.
    """
    try:
        from arete_agents.config import get_settings

        settings = get_settings()
        raw_keys = settings.internal_token_signing_keys
        active_kid = settings.internal_token_active_kid
        if raw_keys:
            return raw_keys, active_kid
    except Exception:
        pass
    return (
        os.environ.get("INTERNAL_TOKEN_SIGNING_KEYS", ""),
        os.environ.get("INTERNAL_TOKEN_ACTIVE_KID", ""),
    )


def _resolve_ttl_seconds() -> int:
    raw = os.environ.get("INTERNAL_TOKEN_TTL_SECONDS")
    if not raw:
        return INTERNAL_TOKEN_DEFAULT_TTL_SECONDS
    try:
        parsed = int(raw)
    except ValueError:
        return INTERNAL_TOKEN_DEFAULT_TTL_SECONDS
    return parsed if parsed > 0 else INTERNAL_TOKEN_DEFAULT_TTL_SECONDS


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def mint_internal_token(iss: str, *, now: int | None = None) -> str:
    """Mints a compact HS256 JWT identifying this process to another internal
    Areté service. Claims: `{iss, aud: "arete-internal", iat, exp}`; header:
    `{alg: "HS256", typ: "JWT", kid}`.

    `now` is injectable seconds-since-epoch so callers (and the vector test)
    can fully control `iat`/`exp` -- with a fixed `now`, the result is
    byte-for-byte deterministic, which is what makes a cross-language test
    vector possible.

    Raises `InternalTokenNotConfigured` if the keyset/active kid is missing.
    """
    keyset = load_keyset()
    if keyset is None:
        raise InternalTokenNotConfigured()

    current = now if now is not None else int(time.time())
    exp = current + _resolve_ttl_seconds()
    kid = keyset.active_kid
    secret = keyset.keys[kid]

    # Explicit key order pins the exact byte sequence to the TS side's
    # SignJWT/JWTPayload literal order -- see the module docstring.
    header = {"alg": "HS256", "typ": "JWT", "kid": kid}
    payload = {"iss": iss, "aud": INTERNAL_TOKEN_AUDIENCE, "iat": current, "exp": exp}

    header_b64 = _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")

    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()

    return f"{header_b64}.{payload_b64}.{_b64url(signature)}"


def verify_internal_token(authorization: str | None, *, now: int | None = None) -> VerifyResult:
    """Verifies a `Bearer <jwt>` Authorization header minted by
    `mint_internal_token`. Never raises on a bad token -- every failure mode
    (missing header, malformed value, revoked/unknown kid, tampered
    signature, expiry, wrong audience) is a returned
    `VerifyResult(ok=False, reason=...)`, so callers can answer 401 without a
    try/except.

    Raises `InternalTokenNotConfigured` only when the keyset itself is
    unconfigured -- that is a 503 (misconfig), never a 401.

    `now` is injectable seconds-since-epoch, used for the expiry check so
    tests can move the clock past expiry deterministically (PyJWT's own
    `exp` validation always uses the real wall clock, which is why it is
    disabled here and re-implemented against the injectable `now`).
    """
    keyset = load_keyset()
    if keyset is None:
        raise InternalTokenNotConfigured()

    if not authorization:
        return VerifyResult(ok=False, reason="no_header")

    match = _BEARER.match(authorization)
    if not match:
        return VerifyResult(ok=False, reason="malformed")
    token = match.group(1)

    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError:
        return VerifyResult(ok=False, reason="malformed")

    kid = header.get("kid")
    # Read the kid and look it up BEFORE ever attempting verification --
    # revocation means a token signed by a removed key must never even be
    # tried against a different (still-present) key.
    if not isinstance(kid, str) or kid not in keyset.keys:
        return VerifyResult(ok=False, reason="unknown_kid")

    secret = keyset.keys[kid]

    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=INTERNAL_TOKEN_AUDIENCE,
            leeway=_LEEWAY_SECONDS,
            # exp is validated manually below against the injectable `now`
            # -- PyJWT's own verify_exp always uses the real wall clock.
            options={"verify_exp": False},
        )
    except jwt.InvalidAudienceError:
        return VerifyResult(ok=False, reason="wrong_audience")
    except jwt.InvalidTokenError:
        return VerifyResult(ok=False, reason="bad_signature")

    current = now if now is not None else int(time.time())
    exp = claims.get("exp")
    if isinstance(exp, (int, float)) and current > exp + _LEEWAY_SECONDS:
        return VerifyResult(ok=False, reason="expired")

    return VerifyResult(ok=True, iss=str(claims.get("iss")), kid=kid)
