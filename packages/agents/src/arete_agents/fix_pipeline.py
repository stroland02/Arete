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
import time
from pathlib import Path
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from opentelemetry import context as otel_context
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

from arete_agents.auto_resolver import OpenComment, verify_resolved
from arete_agents.config import Settings
from arete_agents.context_map.repo_cache import (
    DEFAULT_REPOS_ROOT,
    RepoCacheError,
    ensure_repo_checked_out,
)
from arete_agents.fix_findings import FIX_FINDINGS_RUBRIC, from_fix_item, ground_findings, has_qualifying_finding
from arete_agents.fix_signals import render_signals
from arete_agents.models.fix import (
    FixPatchFile,
    FixRequest,
    FixResponse,
    FixVerification,
    TranscriptReport,
    TranscriptStep,
)
from arete_agents.observability import get_meter, get_tracer

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
evidenced file. That evidence already passed a findings-first gate: its confidence and quotes were \
verified against this exact checkout before you were ever invoked (see the rubric below) -- author your \
fix as if it is real, but never invent additional "evidence" of your own that wasn't given to you.

{rubric}

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


def author_patch(
    llm: BaseChatModel, item: Any, sources: dict[str, str], signals: Any = None
) -> dict:
    """One author pass. Fails closed: any error or unparseable output is
    reported as "no fix produced" (empty files), never fabricated. `item` is
    the FixItem; kept loosely typed here to avoid a model->pipeline import
    cycle with models/fix.py's own use of this module.

    `signals` is the incident's runtime context (FixSignals) when an alert
    opened this work item, else None — most work items are scan-born and have
    none, so it defaults to None and the prompt is byte-identical to before.
    """
    evidence_lines = "\n".join(
        f"- {e.path}:{e.line}" + (f" — {e.excerpt}" if e.excerpt else "") for e in item.evidence
    )
    briefing = "\n\n".join(_numbered(path, content) for path, content in sources.items())
    # Runtime context goes BEFORE the file contents: what actually failed at
    # runtime should frame how the author reads the code, rather than arriving
    # as an afterthought once it has already formed a theory from the source.
    signal_section = render_signals(signals)
    signal_block = f"{signal_section}\n\n" if signal_section else ""
    messages = [
        SystemMessage(content=_AUTHOR_SYSTEM_PROMPT.format(dimension=item.dimension, rubric=FIX_FINDINGS_RUBRIC)),
        HumanMessage(
            content=(
                f"Issue: {item.title}\n{item.detail}\n\nEvidence:\n{evidence_lines}\n\n"
                f"{signal_block}"
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


def _record_fix_metrics(outcome: str, stage: str, duration_seconds: float | None = None) -> None:
    """Emits the arete.fix.* metrics (obs spec §5 namespace) with CLOSED,
    low-cardinality dimensions only -- outcome and stage. Never a repo name,
    container/item id, or installation id (Global Constraint 1: those are
    span attributes only, set by the callers of this function, never metric
    dimensions).

    Telemetry must never take a fix run down (Global Constraint 3): any
    failure here -- a broken meter, a bad attribute type -- is logged and
    swallowed, never re-raised, so it can never turn a real FixResponse into
    an exception.
    """
    try:
        meter = get_meter(__name__)
        meter.create_counter(
            "arete.fix.runs", description="Fix pipeline runs by outcome and terminal stage"
        ).add(1, {"outcome": outcome, "stage": stage})
        if duration_seconds is not None:
            meter.create_histogram(
                "arete.fix.duration", unit="s", description="End-to-end fix drive duration"
            ).record(duration_seconds, {"outcome": outcome})
    except Exception:
        _logger.warning("fix: metrics recording failed; continuing", exc_info=True)


def _drive_fix_stages(
    req: FixRequest,
    llms: dict[str, BaseChatModel],
    verify_settings: Settings,
    repo_root: Path,
    tracer: trace.Tracer,
) -> tuple[FixResponse, str]:
    """The real checkout -> findings -> evidence -> author -> ground ->
    verify sequence, run entirely inside the caller's active `fix.run` span
    (see _run_fix_inner) so every stage below nests under it automatically
    via OTel's context-based parenting -- no explicit parent wiring needed.

    Returns (response, terminal_stage). `terminal_stage` is a closed,
    low-cardinality tag (checkout|findings|author|ground_files|verify|
    complete) for _record_fix_metrics -- never a repo name or any per-run id.
    """
    transcript: list[TranscriptStep] = []

    with tracer.start_as_current_span("fix.checkout") as span:
        try:
            repo_dir = ensure_repo_checked_out(
                _clone_url(req.repo.full_name),
                req.repo.token,
                req.installation_id,
                req.repo.full_name,
                root=repo_root,
            )
        except RepoCacheError as exc:
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, "checkout failed"))
            return (
                FixResponse(
                    status="fix_failed",
                    reason=f"could not check out {req.repo.full_name}: {exc}",
                    transcript=transcript,
                ),
                "checkout",
            )

    # Findings-first gate (Phase 2 Task 7): author_patch must never run
    # without at least one finding whose evidence is mechanically verified
    # against THIS checkout and whose confidence clears the rubric's
    # grounded bar. Fails closed with an honest fix_failed rather than
    # letting a speculative or ungrounded item reach the author model.
    with tracer.start_as_current_span("fix.findings") as span:
        findings_report = from_fix_item(req.item)
        grounded_findings, finding_violations = ground_findings(findings_report, repo_dir)
        span.set_attribute("arete.fix.findings.grounded_count", len(grounded_findings))
        span.set_attribute("arete.fix.findings.violation_count", len(finding_violations))
        if not has_qualifying_finding(grounded_findings):
            reason_detail = (
                "; ".join(finding_violations) or "no finding met the rubric's grounded-confidence bar (>= 0.4)"
            )
            span.set_status(Status(StatusCode.ERROR, "no_grounded_findings"))
            _logger.warning(
                "fix: no grounded findings for container %s (%s) — refusing to author a patch",
                req.container_id,
                reason_detail,
            )
            transcript.append(
                TranscriptStep(
                    agent=req.item.dimension,
                    action="findings",
                    detail=reason_detail,
                    report=TranscriptReport(status="blocked", blockers=finding_violations or [reason_detail]),
                )
            )
            return (
                FixResponse(status="fix_failed", reason="no_grounded_findings", transcript=transcript),
                "findings",
            )

    with tracer.start_as_current_span("fix.evidence") as span:
        sources: dict[str, str] = {}
        for ref in req.item.evidence:
            target = repo_dir / ref.path
            if target.is_file() and ref.path not in sources:
                try:
                    sources[ref.path] = target.read_text(encoding="utf-8", errors="replace")
                except OSError as exc:
                    _logger.warning("fix: could not read evidence file %s: %s", ref.path, exc)
        span.set_attribute("arete.fix.evidence.file_count", len(sources))

    fallback_llm = next(iter(llms.values()), None)
    author_llm = llms.get(req.item.dimension, fallback_llm)
    if author_llm is None:
        return (
            FixResponse(
                status="fix_failed", reason="no LLM client available to author a fix", transcript=transcript
            ),
            "author",
        )

    with tracer.start_as_current_span("fix.author") as span:
        # The LLM call inside author_patch (llm.with_retry().invoke()) is the
        # exact same BaseChatModel invocation shape agents/base.py's
        # review_file() uses -- it rides the SAME service-wide gen_ai
        # instrumentations installed once in observability.py
        # (_instrument_llm_layers), so it gets gen_ai.* attributes (provider,
        # model, token usage) automatically, nested under this span, with no
        # extra manual instrumentation required here.
        authored = author_patch(author_llm, req.item, sources, req.signals)
        span.set_attribute("arete.fix.author.file_count", len(authored["files"]))
        if not authored["files"]:
            span.set_status(Status(StatusCode.ERROR, "no fix produced"))
            transcript.append(
                TranscriptStep(
                    agent=req.item.dimension,
                    action="author",
                    detail=authored["summary"] or "no fix was produced",
                    report=TranscriptReport(status="blocked", blockers=[authored["summary"] or "no fix produced"]),
                )
            )
            return (
                FixResponse(
                    status="fix_failed",
                    reason=authored["summary"] or "the author model could not produce a fix",
                    transcript=transcript,
                ),
                "author",
            )

    with tracer.start_as_current_span("fix.ground_files") as span:
        files, violations = _ground_files(authored["files"], repo_dir)
        span.set_attribute("arete.fix.ground_files.violation_count", len(violations))
        if violations:
            span.set_status(Status(StatusCode.ERROR, "grounding violation"))
            transcript.append(
                TranscriptStep(
                    agent=req.item.dimension,
                    action="author",
                    detail="authored patch failed the grounding gate",
                    report=TranscriptReport(status="blocked", blockers=violations),
                )
            )
            return (
                FixResponse(
                    status="fix_failed",
                    reason="authored patch failed grounding: " + "; ".join(violations),
                    transcript=transcript,
                ),
                "ground_files",
            )

    transcript.append(
        TranscriptStep(
            agent=req.item.dimension,
            action="author",
            detail=authored["summary"] or f"authored {len(files)} file(s)",
            report=TranscriptReport(status="done", confidence=req.item.confidence),
        )
    )

    with tracer.start_as_current_span("fix.verify") as span:
        diff = _unified_diff(repo_dir, files)
        comment = OpenComment(
            id=req.container_id,
            pr_number=0,
            body=f"{req.item.title}\n{req.item.detail}",
            line=req.item.evidence[0].line if req.item.evidence else 0,
        )
        verified = verify_resolved(verify_settings, comment, diff)
        span.set_attribute("arete.fix.verify.verified", verified)

        if not verified:
            span.set_status(Status(StatusCode.ERROR, "unverified"))
            transcript.append(
                TranscriptStep(
                    agent="auto_resolver",
                    action="verify",
                    detail="the authored diff could not be confirmed to resolve the reported issue",
                    report=TranscriptReport(status="blocked", blockers=["verification failed"]),
                )
            )
            return (
                FixResponse(
                    status="fix_failed",
                    reason="authored a patch but could not verify it actually resolves the issue",
                    transcript=transcript,
                    verification=FixVerification(verdict="unverified", checks=["auto_resolver.verify_resolved"]),
                ),
                "verify",
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

    return (
        FixResponse(
            status="fixed",
            patch=files,
            transcript=transcript,
            verification=FixVerification(verdict="verified", checks=["auto_resolver.verify_resolved"]),
        ),
        "complete",
    )


def _run_fix_inner(
    req: FixRequest,
    llms: dict[str, BaseChatModel],
    verify_settings: Settings,
    repo_root: Path,
) -> FixResponse:
    """`fix.run` root span (obs spec §5, FROZEN span naming tree -- same
    pattern as `review.run`/`scan.run`/`chat.turn`): wraps the whole
    checkout -> author -> verify sequence so every stage in
    _drive_fix_stages nests under it, and emits the terminal arete.fix.*
    metrics exactly once per run. Repo/container/installation identifiers go
    on THIS span's attributes only -- never on the metrics (Global
    Constraint 1)."""
    tracer = get_tracer(__name__)
    started = time.monotonic()

    with tracer.start_as_current_span(
        "fix.run",
        attributes={
            "arete.container.id": req.container_id,
            "arete.repo.full_name": req.repo.full_name,
            "arete.installation.id": req.installation_id,
            "arete.fix.dimension": req.item.dimension,
        },
    ) as run_span:
        response, stage = _drive_fix_stages(req, llms, verify_settings, repo_root, tracer)
        outcome = "fixed" if response.status == "fixed" else "fix_failed"
        run_span.set_attribute("arete.fix.outcome", outcome)
        run_span.set_attribute("arete.fix.stage", stage)
        if outcome == "fix_failed":
            run_span.set_status(Status(StatusCode.ERROR, response.reason or "fix_failed"))

        _record_fix_metrics(outcome, stage, time.monotonic() - started)

        return response


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

    # Trace continuity (obs spec §5): OTel's active-span context lives in a
    # contextvar, and concurrent.futures.ThreadPoolExecutor does NOT
    # propagate contextvars into its worker threads -- each worker thread
    # starts with a fresh, empty Context. Left alone, the fix.run span
    # created inside _run_fix_inner (which runs on the pool's worker thread)
    # would start a brand-new orphan trace instead of joining whatever trace
    # the caller (the FastAPI request span for this /fix call, itself a
    # child of the webhook-side drive) already started. Capture the calling
    # thread's context here and re-attach it inside the worker before
    # running _run_fix_inner.
    parent_ctx = otel_context.get_current()

    def _run_with_parent_context() -> FixResponse:
        token = otel_context.attach(parent_ctx)
        try:
            return _run_fix_inner(req, llms, settings, repo_root)
        finally:
            otel_context.detach(token)

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(_run_with_parent_context)
        try:
            return future.result(timeout=timeout_seconds)
        except concurrent.futures.TimeoutError:
            _logger.warning("fix: timed out after %ss for container %s", timeout_seconds, req.container_id)
            _record_fix_metrics("fix_failed", "timeout")
            return FixResponse(status="fix_failed", reason="timeout")
