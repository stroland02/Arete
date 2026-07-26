import logging
from typing import Callable, Sequence

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

from arete_agents.config import Settings
from arete_agents.llm.base import get_llms_by_role

logger = logging.getLogger(__name__)

# Auto-Resolver (Autorecovery Agent): given an open review comment and the PR's
# latest diff, decides — via the real security-tier LLM — whether the flagged
# issue has actually been fixed, so it can be resolved without a human re-review.
#
# Obtaining the open comments (a DB read) and actually resolving a thread (a
# GitHub/GitLab API mutation, needing a minted installation token) are
# cross-lane (webhook/db) and explicitly out of scope here — see
# docs/superpowers/specs/2026-07-15-python-apply-resume-design.md's "Out of
# scope" note. Both are injected as callables/data so this module owns only
# the real, in-lane part: the verification decision itself.

_VERIFIER_SYSTEM_PROMPT = (
    "You are the Areté Auto-Resolver. You will be shown a flagged issue and "
    "the PR's latest diff. Reply with exactly one word: RESOLVED if the diff "
    "demonstrably fixes the flagged issue, or UNRESOLVED otherwise."
)


class OpenComment(BaseModel):
    """One open review comment eligible for auto-resolution scanning."""
    id: str
    pr_number: int
    body: str
    line: int


def verify_resolved(settings: Settings, comment: OpenComment, latest_diff: str) -> bool:
    """Ask the real security-tier LLM whether latest_diff fixes the issue
    described in comment.body. Returns False — never a fabricated "resolved"
    — when no security LLM is configured or the call itself fails; a broken
    verification must never auto-close a real finding."""
    llms = get_llms_by_role(settings)
    resolver_llm = llms.get("security")
    if resolver_llm is None:
        return False

    messages = [
        SystemMessage(content=_VERIFIER_SYSTEM_PROMPT),
        HumanMessage(content=f"Issue: {comment.body}\n\nLatest diff:\n{latest_diff}"),
    ]
    try:
        response = resolver_llm.invoke(messages)
    except Exception as exc:
        logger.warning(
            f"Auto-resolver verification failed for comment {comment.id}: {exc}"
        )
        return False

    reply = str(response.content).strip().upper()
    return reply.startswith("RESOLVED")


def scan_and_resolve_prs(
    settings: Settings,
    open_comments: Sequence[OpenComment],
    fetch_latest_diff: Callable[[int], str],
    resolve_thread: Callable[[str], None],
) -> int:
    """For each open comment, fetch its PR's latest diff (via the injected
    fetch_latest_diff — a real GitHub/GitLab API call in production) and, if
    verify_resolved confirms the fix, resolve the thread (via the injected
    resolve_thread — a real GitHub/GitLab mutation in production, using a
    minted installation token). Returns the number of threads resolved this
    run."""
    resolved_count = 0
    for comment in open_comments:
        latest_diff = fetch_latest_diff(comment.pr_number)
        if verify_resolved(settings, comment, latest_diff):
            resolve_thread(comment.id)
            resolved_count += 1
    return resolved_count
