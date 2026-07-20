"""POST /fix orchestrator (healing-loop v1, Wave B — Eng3 lane).

Per docs/superpowers/specs/2026-07-19-healing-loop-design.md §3 (FROZEN):
checkout the tenant repo -> author a patch on the connected model -> a
deterministic grounding gate (mirrors /scan's path/line gate) -> verify the
authored diff against auto_resolver's real, LLM-backed core -> an honest
FixResponse. `patch` is non-empty iff status=="fixed"; a patch that fails
grounding or verification NEVER reaches the caller — fix_failed always
carries the real reason instead.

Grounding is a HARD gate over the whole authored patch, not a per-file drop
(the /scan pattern): patch files are not independent like scan findings — a
fix can span causally-linked files (e.g. a function moved from A to B), so
silently dropping one bad file could ship a broken partial patch under the
banner of a "verified" fix. One invalid file invalidates the whole attempt.
"""

from __future__ import annotations

import concurrent.futures
import difflib
import json
import logging
import re
from pathlib import Path
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from arete_agents.auto_resolver import OpenComment, verify_resolved
from arete_agents.config import Settings
from arete_agents.context_map.repo_cache import (
    DEFAULT_REPOS_ROOT,
    RepoCacheError,
    ensure_repo_checked_out,
)
from arete_agents.models.fix import (
    FixPatchFile,
    FixRequest,
    FixResponse,
    FixVerification,
    TranscriptReport,
    TranscriptStep,
)

_logger = logging.getLogger(__name__)

# The whole checkout -> author -> verify sequence is bounded as ONE unit — the
# spec's single 300s budget, not a per-stage allowance. Kept comfortably under
# the caller's (webhook worker's) own abort so agents' own honest fix_failed
# response — with a real reason — wins the race over a bare connection drop.
DEFAULT_FIX_TIMEOUT_SECONDS = 280.0

MAX_LINES_PER_FILE = 800


def _clone_url(full_name: str) -> str:
    return f"https://github.com/{full_name}.git"


def _numbered(path: str, content: str) -> str:
    lines = content.splitlines()[:MAX_LINES_PER_FILE]
    body = "\n".join(f"{i + 1}: {line}" for i, line in enumerate(lines))
    return f"=== {path} ===\n{body}"


_AUTHOR_SYSTEM_PROMPT = """You are the Areté fix author for the {dimension} dimension. You are given one \
concrete issue/opportunity, real evidence from the repository, and the CURRENT full content of every \
evidenced file. Author a real, complete fix.

Rules:
- Every file you return must include its COMPLETE new content — never a diff, never a placeholder, \
never "// ... rest unchanged".
- Only include files that actually need to change. Prefer the smallest correct fix.
- A new file is allowed ONLY when it is genuinely necessary; set "isNew": true and explain why in "summary".
- If you cannot produce a real, complete, working fix, return an empty "files" array and explain why in \
"summary" — never a partial or fabricated fix.

Return ONLY valid JSON (no prose, no code fences):
{{
  "files": [ {{ "path": "<path>", "content": "<COMPLETE new file content>", "isNew": <true|false> }} ],
  "summary": "<what changed and why, or why no fix was possible>"
}}"""


def author_patch(llm: BaseChatModel, item: Any, sources: dict[str, str]) -> dict:
    """One author pass. Fails closed: any error or unparseable output is
    reported as "no fix produced" (empty files), never fabricated. `item` is
    the FixItem; kept loosely typed here to avoid a model->pipeline import
    cycle with models/fix.py's own use of this module."""
    evidence_lines = "\n".join(
        f"- {e.path}:{e.line}" + (f" — {e.excerpt}" if e.excerpt else "") for e in item.evidence
    )
    briefing = "\n\n".join(_numbered(path, content) for path, content in sources.items())
    messages = [
        SystemMessage(content=_AUTHOR_SYSTEM_PROMPT.format(dimension=item.dimension)),
        HumanMessage(
            content=(
                f"Issue: {item.title}\n{item.detail}\n\nEvidence:\n{evidence_lines}\n\n"
                f"Current file contents (line-numbered):\n\n{briefing}"
            )
        ),
    ]
    try:
        response = llm.with_retry(stop_after_attempt=2).invoke(messages)
        raw = response.content if isinstance(response.content, str) else ""
        clean = re.sub(r"```(?:json)?\n?|```$", "", raw, flags=re.MULTILINE).strip()
        parsed = json.loads(clean)
    except Exception as exc:
        _logger.warning("fix: author pass failed (%s) — no fix produced", exc)
        return {"files": [], "summary": f"the author model call failed: {exc}"}
    if not isinstance(parsed, dict):
        return {"files": [], "summary": "author returned a non-object response"}
    files = parsed.get("files")
    return {
        "files": files if isinstance(files, list) else [],
        "summary": str(parsed.get("summary") or ""),
    }


def _ground_files(raw_files: list[dict], repo_dir: Path) -> tuple[list[FixPatchFile], list[str]]:
    """The deterministic gate: every path must exist in the checkout UNLESS
    the author explicitly marked it new. Returns (files, violations) — any
    violation invalidates the whole patch (see module docstring)."""
    files: list[FixPatchFile] = []
    violations: list[str] = []
    for raw in raw_files:
        if not isinstance(raw, dict):
            violations.append("a returned file entry was not an object")
            continue
        path, content = raw.get("path"), raw.get("content")
        is_new = bool(raw.get("isNew"))
        if not isinstance(path, str) or not path or not isinstance(content, str):
            violations.append(f"malformed file entry: {raw!r}")
            continue
        exists = (repo_dir / path).is_file()
        if not exists and not is_new:
            violations.append(f"{path}: does not exist in the checkout and was not marked new")
            continue
        if exists and is_new:
            violations.append(f"{path}: marked new but already exists in the checkout")
            continue
        files.append(FixPatchFile(path=path, content=content))
    return files, violations


def _unified_diff(repo_dir: Path, files: list[FixPatchFile]) -> str:
    blocks = []
    for f in files:
        original_path = repo_dir / f.path
        before = original_path.read_text(encoding="utf-8", errors="replace") if original_path.is_file() else ""
        diff = "".join(
            difflib.unified_diff(
                before.splitlines(keepends=True),
                f.content.splitlines(keepends=True),
                fromfile=f"a/{f.path}",
                tofile=f"b/{f.path}",
            )
        )
        blocks.append(diff)
    return "\n".join(blocks)


def _settings_for_verification(llm_cfg: Any, fallback: Settings) -> Settings:
    """auto_resolver.verify_resolved is hard-wired to Settings.llm_provider
    (via get_llms_by_role), whose Literal is only gemini/anthropic/ollama —
    narrower than the newer per-request BYO path (build_llm) that also
    supports openai/openrouter. Route verification onto the SAME model /fix
    authored on whenever that's possible; fall back to the service default
    (logged, never silent) for a provider Settings can't express."""
    if llm_cfg is not None and llm_cfg.provider in ("ollama", "anthropic", "gemini"):
        kwargs: dict[str, Any] = {"llm_provider": llm_cfg.provider}
        if llm_cfg.provider == "ollama":
            if llm_cfg.model:
                kwargs["ollama_model"] = llm_cfg.model
            if llm_cfg.base_url:
                kwargs["ollama_base_url"] = llm_cfg.base_url
        elif llm_cfg.provider == "anthropic" and llm_cfg.api_key:
            kwargs["anthropic_api_key"] = llm_cfg.api_key
        elif llm_cfg.provider == "gemini" and llm_cfg.api_key:
            kwargs["gemini_api_key"] = llm_cfg.api_key
        return Settings(**kwargs)
    if llm_cfg is not None:
        _logger.warning(
            "fix: verification cannot run on provider %r (auto_resolver only reaches "
            "ollama/anthropic/gemini) — falling back to the service default model for "
            "the verify stage only.",
            llm_cfg.provider,
        )
    return fallback


def _run_fix_inner(
    req: FixRequest,
    llms: dict[str, BaseChatModel],
    verify_settings: Settings,
    repo_root: Path,
) -> FixResponse:
    transcript: list[TranscriptStep] = []

    try:
        repo_dir = ensure_repo_checked_out(
            _clone_url(req.repo.full_name),
            req.repo.token,
            req.installation_id,
            req.repo.full_name,
            root=repo_root,
        )
    except RepoCacheError as exc:
        return FixResponse(
            status="fix_failed",
            reason=f"could not check out {req.repo.full_name}: {exc}",
            transcript=transcript,
        )

    sources: dict[str, str] = {}
    for ref in req.item.evidence:
        target = repo_dir / ref.path
        if target.is_file() and ref.path not in sources:
            try:
                sources[ref.path] = target.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                _logger.warning("fix: could not read evidence file %s: %s", ref.path, exc)

    fallback_llm = next(iter(llms.values()), None)
    author_llm = llms.get(req.item.dimension, fallback_llm)
    if author_llm is None:
        return FixResponse(
            status="fix_failed",
            reason="no LLM client available to author a fix",
            transcript=transcript,
        )

    authored = author_patch(author_llm, req.item, sources)
    if not authored["files"]:
        transcript.append(
            TranscriptStep(
                agent=req.item.dimension,
                action="author",
                detail=authored["summary"] or "no fix was produced",
                report=TranscriptReport(status="blocked", blockers=[authored["summary"] or "no fix produced"]),
            )
        )
        return FixResponse(
            status="fix_failed",
            reason=authored["summary"] or "the author model could not produce a fix",
            transcript=transcript,
        )

    files, violations = _ground_files(authored["files"], repo_dir)
    if violations:
        transcript.append(
            TranscriptStep(
                agent=req.item.dimension,
                action="author",
                detail="authored patch failed the grounding gate",
                report=TranscriptReport(status="blocked", blockers=violations),
            )
        )
        return FixResponse(
            status="fix_failed",
            reason="authored patch failed grounding: " + "; ".join(violations),
            transcript=transcript,
        )

    transcript.append(
        TranscriptStep(
            agent=req.item.dimension,
            action="author",
            detail=authored["summary"] or f"authored {len(files)} file(s)",
            report=TranscriptReport(status="done", confidence=req.item.confidence),
        )
    )

    diff = _unified_diff(repo_dir, files)
    comment = OpenComment(
        id=req.container_id,
        pr_number=0,
        body=f"{req.item.title}\n{req.item.detail}",
        line=req.item.evidence[0].line if req.item.evidence else 0,
    )
    verified = verify_resolved(verify_settings, comment, diff)

    if not verified:
        transcript.append(
            TranscriptStep(
                agent="auto_resolver",
                action="verify",
                detail="the authored diff could not be confirmed to resolve the reported issue",
                report=TranscriptReport(status="blocked", blockers=["verification failed"]),
            )
        )
        return FixResponse(
            status="fix_failed",
            reason="authored a patch but could not verify it actually resolves the issue",
            transcript=transcript,
            verification=FixVerification(verdict="unverified", checks=["auto_resolver.verify_resolved"]),
        )

    transcript.append(
        TranscriptStep(
            agent="auto_resolver",
            action="verify",
            detail="verified the diff resolves the reported issue",
            report=TranscriptReport(status="done", confidence=req.item.confidence),
        )
    )
    transcript.append(
        TranscriptStep(
            agent=req.item.dimension,
            action="compose",
            detail=f"composed a {len(files)}-file patch",
            report=TranscriptReport(status="done"),
        )
    )

    return FixResponse(
        status="fixed",
        patch=files,
        transcript=transcript,
        verification=FixVerification(verdict="verified", checks=["auto_resolver.verify_resolved"]),
    )


def run_fix(
    req: FixRequest,
    llms: dict[str, BaseChatModel],
    verify_settings: Settings | None = None,
    repo_root: Path = DEFAULT_REPOS_ROOT,
    timeout_seconds: float = DEFAULT_FIX_TIMEOUT_SECONDS,
) -> FixResponse:
    """Public entry point. Bounds the ENTIRE checkout->author->verify sequence
    to `timeout_seconds` as one unit (the spec's single 300s budget) — a hang
    anywhere in that chain still returns an honest fix_failed instead of the
    caller having to rely solely on its own HTTP-level abort."""
    settings = _settings_for_verification(req.llm, verify_settings or Settings(llm_provider="ollama"))

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(_run_fix_inner, req, llms, settings, repo_root)
        try:
            return future.result(timeout=timeout_seconds)
        except concurrent.futures.TimeoutError:
            _logger.warning("fix: timed out after %ss for container %s", timeout_seconds, req.container_id)
            return FixResponse(status="fix_failed", reason="timeout")
