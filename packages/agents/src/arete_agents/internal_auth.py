"""Signed-token guard for this service's service-to-service surface.

Mirrors packages/webhook/src/internal-auth.ts one-for-one -- verify the
Bearer JWT, 401 on any bad-token reason, fail-closed 503 when the keyset is
not configured -- because spec section 6 gate 4 requires internal endpoints
to keep exactly that posture, and two services that guard the same shared
credential differently are two chances to get it wrong.

Obs Phase 3 Task 4: this used to compare a single static shared secret
(constant-time equality). It now verifies short-lived, kid-addressed HS256
JWTs via arete_agents.internal_token (the Python counterpart of
@arete/internal-token) -- a static secret has no expiry and no way to revoke
one caller without rotating the value for every caller at once. This is a
CLEAN CUTOVER: there is no dual-accept path for the retired static secret.

WHY THIS GUARD EXISTS AT ALL (review finding B4). POST /review took a
caller-supplied PRContext carrying BOTH `installationId` and `repo`, with no
auth of any kind. This process mints its own internal token for the
webhook's /internal/memory write-back, so anyone who could reach this port
could name a victim installation + repo and -- via injected content in
`files[].patch` or `description` that induces an add_project_memory tool
call -- persist rows into that tenant's repo using OUR credential.
AgentMemory rows are re-injected into every future review prompt for that
repo (fetchProjectMemories -> agents/base.py), so an unauthenticated /review
was a cross-tenant WRITE vector with amplification, not merely free compute.

Every caller of this service is one of our own server-side processes
(packages/webhook and packages/dashboard), each of which mints its own
internal token for the reverse direction. Nothing browser-facing calls these
endpoints directly.

/health stays unguarded: container healthchecks carry no bearer, and a guarded
/health would let the fail-closed posture take the whole service down on a
misconfiguration rather than just its guarded routes.
"""

from fastapi import Header, HTTPException

from arete_agents.internal_token import InternalTokenNotConfigured, verify_internal_token


def require_internal_token(authorization: str | None = Header(default=None)) -> None:
    """FastAPI dependency: require `Authorization: Bearer <signed internal token>`.

    Fail-closed -- with no keyset configured the surface answers 503 rather
    than silently running open. A prod misconfig should be loud, not a hole.
    Any bad-token reason (missing header, malformed, unknown/revoked kid,
    tampered signature, expired, wrong audience) answers 401 without
    distinguishing which -- the caller only needs to know it was rejected.
    """
    try:
        result = verify_internal_token(authorization)
    except InternalTokenNotConfigured:
        raise HTTPException(status_code=503, detail="internal_auth_not_configured") from None
    if not result.ok:
        raise HTTPException(status_code=401, detail="unauthorized")
    return None
