"""add_project_memory (Phase 2 Task 8).

Was a pure stub: it logged and returned a hardcoded success string,
persisting nothing -- an agent calling it was TOLD the write succeeded when
nothing was written. This module is the real write path: it calls the
webhook service's token-guarded POST /internal/memory, which is the one
place an AgentMemory row is actually created (see
packages/webhook/src/memory-write.ts).

Tenant safety: `installation_id` and `repo_full_name` are BOUND to the tool
via closure in `build_memory_tool`, exactly like
`context_map/tools.py::get_context_map_tools` binds a review's own indexed
project. They are NEVER LLM-supplied tool arguments -- letting a model choose
which tenant's repo to write to is exactly the hole this task closes. The
webhook endpoint re-derives and re-checks the tenant boundary server-side
regardless (defense in depth), but this process never even offers the model
a way to name a different repo.

Honest failure (the defect being removed): every path below returns a
string starting with "Failed to save" on anything other than a real
persisted row -- a transport error, a non-2xx response, or missing
installation/repo context. It must never return the "Successfully saved"
string without an actual 200/201 from the webhook.
"""

import logging
from typing import Callable

import httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from arete_agents.config import get_settings

logger = logging.getLogger(__name__)

# Mirrors packages/webhook/src/memory-write.ts's ALLOWED_KINDS /
# AgentMemory.kind schema comment (packages/db/prisma/schema.prisma).
_ALLOWED_KINDS = frozenset({"feedback", "terminology", "infra", "project"})

# Mirrors packages/webhook/src/memory-write.ts's MAX_MEMORY_BODY_CHARS. Kept
# in sync manually -- both sides document the other. Sending an
# already-oversized body is rejected here before ever making the HTTP call
# (cheaper than a round trip just to get the same rejection back), but the
# webhook enforces this too (defense in depth: a client-side check must never
# be the ONLY gate).
_MAX_NOTE_CHARS = 4000

_REQUEST_TIMEOUT_S = 10.0

PostFn = Callable[[dict, dict], httpx.Response]


class AddProjectMemoryInput(BaseModel):
    note: str = Field(description="The rule/fact to remember, in full.")
    kind: str = Field(
        default="project",
        description="One of feedback | terminology | infra | project.",
    )


def _default_post(payload: dict, headers: dict) -> httpx.Response:
    settings = get_settings()
    url = f"{settings.webhook_service_url.rstrip('/')}/internal/memory"
    return httpx.post(url, json=payload, headers=headers, timeout=_REQUEST_TIMEOUT_S)


def build_memory_tool(
    installation_id: int | None,
    repo_full_name: str | None,
    post: PostFn = _default_post,
) -> StructuredTool:
    """Build the add_project_memory tool BOUND to this review's own
    installation/repo (see module docstring on why this is closure-bound,
    never LLM-supplied). ``post`` is injectable for testing without a real
    network call -- pass a fake that raises a real ``httpx`` transport error
    to prove the honest-failure path, or one that returns a canned
    ``httpx.Response`` to prove the success/rejection mapping.
    """

    def add_project_memory(note: str, kind: str = "project") -> str:
        """
        Persist a newly learned rule about the repository's codebase or infrastructure.
        This rule will be globally available to all future agent runs on this repository.
        Only save high-level architectural rules, paradigms, or strict requirements
        (e.g., 'Frontend uses Tailwind, no raw CSS' or 'Always use Redis for caching').
        """
        if installation_id is None or not repo_full_name:
            logger.warning("add_project_memory called with no installation/repo context")
            return "Failed to save memory: no repository context available for this run."

        if len(note) > _MAX_NOTE_CHARS:
            return (
                f"Failed to save memory: note is {len(note)} chars, "
                f"which exceeds the {_MAX_NOTE_CHARS}-char cap. Nothing was saved -- "
                "shorten the note rather than relying on truncation."
            )

        effective_kind = kind if kind in _ALLOWED_KINDS else "project"
        title = note.strip()[:80] or "Rule"

        settings = get_settings()
        headers = {"Content-Type": "application/json"}
        if settings.internal_api_token:
            headers["Authorization"] = f"Bearer {settings.internal_api_token}"

        payload = {
            "installationId": installation_id,
            "repoFullName": repo_full_name,
            "kind": effective_kind,
            "title": title,
            "body": note,
        }

        try:
            response = post(payload, headers)
        except httpx.HTTPError as exc:
            # A REAL transport failure (connection refused, timeout, DNS
            # failure, etc.) -- exactly the class of error the old stub could
            # never honestly report, because it never made a call at all.
            logger.error(f"add_project_memory transport failure: {exc}")
            return f"Failed to save memory: could not reach the persistence service ({exc})."

        if response.status_code in (200, 201):
            return f"Successfully saved {effective_kind} memory: '{note}'"

        try:
            detail = response.json().get("reason", response.text)
        except Exception:
            detail = response.text
        logger.error(
            f"add_project_memory rejected by server: {response.status_code} {detail}"
        )
        return f"Failed to save memory: rejected by server ({detail})."

    return StructuredTool.from_function(
        add_project_memory,
        name="add_project_memory",
        args_schema=AddProjectMemoryInput,
    )
