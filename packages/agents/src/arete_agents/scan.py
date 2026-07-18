"""Repo-wide discovery scan behind POST /scan (the work-item inbox).

Instead of a PR diff, the six specialists are briefed on the WHOLE repo:
structure comes from the code map (build_graph_export — up to the 20
highest-degree files), content from targeted reads of the already-cached
checkout (context_map.repo_cache — the scan never clones; the index-on-connect
path did that).

Anti-fabrication is enforced deterministically AFTER the specialists respond:
every finding must carry at least one {path, line} evidence ref where the path
exists in the checkout AND the line is in range of the file's real content.
Anything else — evidence-free findings, ghost paths, out-of-range lines,
non-issue kinds, missing confidence — is dropped, never surfaced. An empty
scan is an honest ``no_findings``.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from arete_agents.context_map.graph_export import build_graph_export
from arete_agents.context_map.repo_cache import DEFAULT_REPOS_ROOT
from arete_agents.models.pr import ScanFinding, ScanRequest, ScanResponse

_logger = logging.getLogger(__name__)

# The six review dimensions — same set the review orchestrator fans out to.
DIMENSIONS = [
    "security",
    "performance",
    "quality",
    "test_coverage",
    "deployment_safety",
    "business_logic",
]

MAX_FILES = 20
MAX_LINES_PER_FILE = 400


class ScanUnavailableError(Exception):
    """The repo has no cached checkout yet (nothing indexed this repo), so a
    scan has no real sources to ground findings against. The endpoint maps
    this to an honest 503, never an empty-but-'complete' scan."""


def select_files(graph: dict, limit: int = MAX_FILES) -> list[str]:
    """Up to `limit` File-node paths, highest degree first — the most
    connected (most load-bearing) files get scanned first."""
    files = [
        n
        for n in graph.get("nodes", [])
        if n.get("kind") == "File" and n.get("path")
    ]
    files.sort(key=lambda n: int(n.get("degree", 0) or 0), reverse=True)
    return [n["path"] for n in files[:limit]]


def _read_sources(repo_dir: Path, paths: list[str]) -> dict[str, list[str]]:
    """Read each selected file from the checkout (capped per file). Only files
    that actually exist make it into the briefing — and later, only lines that
    actually exist can ground a finding."""
    sources: dict[str, list[str]] = {}
    for rel in paths:
        target = repo_dir / rel
        try:
            if not target.is_file():
                continue
            lines = target.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError as exc:
            _logger.warning("scan: could not read %s: %s", rel, exc)
            continue
        sources[rel] = lines[:MAX_LINES_PER_FILE]
    return sources


def _numbered(sources: dict[str, list[str]]) -> str:
    blocks = []
    for path, lines in sources.items():
        body = "\n".join(f"{i + 1}: {line}" for i, line in enumerate(lines))
        blocks.append(f"=== {path} ===\n{body}")
    return "\n\n".join(blocks)


_SYSTEM_PROMPT = """You are the Areté {dimension} specialist, scanning a whole repository (not a PR diff).
Find concrete issues AND improvement opportunities in your dimension. Every finding must cite file:line evidence from the provided sources — findings without real evidence will be discarded.

Return ONLY a valid JSON array (no prose, no code fences). Each element:
{{
  "kind": "issue" | "opportunity",
  "title": "one-line subject",
  "detail": "what & why, concretely",
  "evidence": [{{"path": "<a provided file path>", "line": <line number from the numbered source>, "excerpt": "<the cited code>"}}],
  "confidence": <your real confidence, 0.0-1.0>
}}
Return [] if you find nothing worth surfacing — an empty result is a valid, honest answer."""


def brief_specialist(llm: Any, dimension: str, sources: dict[str, list[str]]) -> list[dict]:
    """One specialist pass over the numbered sources. Fails open per dimension:
    a specialist that errors or returns unparseable output contributes nothing
    (logged), it never fails the whole scan or fabricates findings."""
    messages = [
        SystemMessage(content=_SYSTEM_PROMPT.format(dimension=dimension)),
        HumanMessage(
            content=f"Repository sources (line-numbered):\n\n{_numbered(sources)}"
        ),
    ]
    try:
        response = llm.with_retry(stop_after_attempt=2).invoke(messages)
        raw = response.content if isinstance(response.content, str) else ""
        clean = re.sub(r"```(?:json)?\n?|```$", "", raw, flags=re.MULTILINE).strip()
        parsed = json.loads(clean)
    except Exception as exc:
        _logger.warning("scan: %s specialist failed (%s) — contributing nothing", dimension, exc)
        return []
    return parsed if isinstance(parsed, list) else []


def _grounded(finding: dict, sources: dict[str, list[str]]) -> bool:
    """The deterministic critic gate: real kind, real confidence, and EVERY
    evidence ref resolving to an existing file + in-range line."""
    if finding.get("kind") not in ("issue", "opportunity"):
        return False
    if not finding.get("title") or not finding.get("detail"):
        return False
    confidence = finding.get("confidence")
    if not isinstance(confidence, (int, float)) or not (0 <= float(confidence) <= 1):
        return False
    evidence = finding.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        return False
    for ref in evidence:
        if not isinstance(ref, dict):
            return False
        path, line = ref.get("path"), ref.get("line")
        lines = sources.get(path)
        if lines is None:
            return False
        if not isinstance(line, int) or not (1 <= line <= len(lines)):
            return False
    return True


def run_scan(
    req: ScanRequest,
    llms: dict[str, Any],
    repo_root: Path = DEFAULT_REPOS_ROOT,
) -> ScanResponse:
    """Graph export → top files → checkout reads → six specialist briefings →
    deterministic grounding gate → honest ScanResponse."""
    graph = build_graph_export(req.installation_id)  # GraphExportError → 503 upstream

    repo_dir = repo_root / str(req.installation_id) / req.repo_slug.replace("/", "__")
    if not repo_dir.is_dir():
        raise ScanUnavailableError(
            f"No cached checkout for {req.repo_slug} (installation {req.installation_id}) — "
            "the repo has not been indexed yet."
        )

    sources = _read_sources(repo_dir, select_files(graph))
    if not sources:
        return ScanResponse(status="no_findings", findings=[])

    fallback_llm = next(iter(llms.values()), None)
    findings: list[ScanFinding] = []
    for dimension in DIMENSIONS:
        llm = llms.get(dimension, fallback_llm)
        if llm is None:
            continue
        for raw in brief_specialist(llm, dimension, sources):
            if not isinstance(raw, dict) or not _grounded(raw, sources):
                continue
            findings.append(
                ScanFinding(
                    kind=raw["kind"],
                    title=str(raw["title"]),
                    detail=str(raw["detail"]),
                    evidence=[
                        {
                            "path": ref["path"],
                            "line": ref["line"],
                            "excerpt": ref.get("excerpt"),
                        }
                        for ref in raw["evidence"]
                    ],
                    dimension=dimension,
                    confidence=float(raw["confidence"]),
                )
            )

    return ScanResponse(
        status="complete" if findings else "no_findings",
        findings=findings,
    )
