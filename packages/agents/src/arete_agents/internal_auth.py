"""Shared-token guard for this service's service-to-service surface.

Mirrors packages/webhook/src/internal-auth.ts one-for-one -- Bearer parse,
length check, constant-time compare, 401 on mismatch, fail-closed 503 when the
token is not configured -- because spec section 6 gate 4 requires internal
endpoints to keep exactly that posture, and two services that guard the same
shared credential differently are two chances to get it wrong.

WHY THIS EXISTS (review finding B4). POST /review took a caller-supplied
PRContext carrying BOTH `installationId` and `repo`, with no auth of any kind.
This process holds its own INTERNAL_API_TOKEN for the webhook's
/internal/memory write-back, so anyone who could reach this port could name a
victim installation + repo and -- via injected content in `files[].patch` or
`description` that induces an add_project_memory tool call -- persist rows
into that tenant's repo using OUR credential. AgentMemory rows are re-injected
into every future review prompt for that repo (fetchProjectMemories ->
agents/base.py), so an unauthenticated /review was a cross-tenant WRITE
vector with amplification, not merely free compute.

Every caller of this service is one of our own server-side processes
(packages/webhook and packages/dashboard), each of which already has
INTERNAL_API_TOKEN in its environment for the reverse direction. Nothing
browser-facing calls these endpoints directly.

/health stays unguarded: container healthchecks carry no bearer, and a guarded
/health would let the fail-closed posture take the whole service down on a
misconfiguration rather than just its guarded routes.
"""

import hmac
import os
import re

from fastapi import Header, HTTPException

_BEARER = re.compile(r"^Bearer\s+(.+)$", re.IGNORECASE)


def configured_token() -> str:
    """The expected shared token, read PER REQUEST (not captured at import)
    so a test or an operator changing the environment takes effect, exactly
    like internal-auth.ts's injectable ``getToken()``.

    Settings is the primary source (it also reads packages/agents/.env), with a
    bare-environment fallback: Settings() eagerly validates the LLM provider
    key, and a keyless boot must still be able to REJECT -- never to run open.
    """
    try:
        from arete_agents.config import get_settings

        token = get_settings().internal_api_token
        if token:
            return token
    except Exception:
        pass
    return os.environ.get("INTERNAL_API_TOKEN", "")


def token_matches(header: str | None, token: str) -> bool:
    """Constant-time check of an Authorization header against the shared token."""
    if not header or not token:
        return False
    match = _BEARER.match(header)
    if not match:
        return False
    presented = match.group(1).encode()
    expected = token.encode()
    # Length is compared explicitly (and compare_digest is still used on the
    # bytes) so the comparison itself never short-circuits on content.
    return len(presented) == len(expected) and hmac.compare_digest(presented, expected)


def require_internal_token(authorization: str | None = Header(default=None)) -> None:
    """FastAPI dependency: require `Authorization: Bearer <INTERNAL_API_TOKEN>`.

    Fail-closed -- with no token configured the surface answers 503 rather than
    silently running open. A prod misconfig should be loud, not a hole.
    """
    token = configured_token()
    if not token:
        raise HTTPException(status_code=503, detail="internal_auth_not_configured")
    if not token_matches(authorization, token):
        raise HTTPException(status_code=401, detail="unauthorized")
    return None
