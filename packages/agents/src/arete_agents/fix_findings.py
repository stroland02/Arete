"""Findings-first gate (Phase 2 Task 7, obs-phase-2 plan, healing-loop safety).

Spec §3: "Findings-first gate: terminal actions require a prior structured
findings report." Before fix_pipeline.author_patch is ever called, this run
must have at least one grounded, structured statement of *what is wrong and
on what evidence* -- not merely whatever confidence the caller's item
asserts. `fix_pipeline._run_fix_inner` used to go straight from checkout to
`author_patch` with no such check; a caller could hand it a high-confidence
item pointing at evidence that does not exist and the pipeline would author
a patch anyway.

Confidence is 0-1 in this codebase and stays 0-1 (scope decision recorded in
docs/superpowers/plans/2026-07-21-obs-phase-2-healing-alerting.md Task 7):
five existing consumers assume a 0-1 float -- FixItem.confidence
(models/fix.py), AgentStatus (models/review.py), StatusReport, WorkItem, and
escalationTier() -- and the dashboard renders `confidence * 100`. Do NOT
introduce the spec's illustrative 0-10 scale here; only its *criteria* are
adopted, anchored on the existing scale.

Evidence verification mirrors fix_pipeline._ground_files exactly: every
path must resolve as a real file in the checkout, mechanically, never
trusting the model's self-report. Unlike _ground_files (which invalidates
the WHOLE authored patch on one bad file, because patch files can be
causally linked -- see fix_pipeline.py's module docstring), findings are
independent statements like /scan's own findings: one ungrounded finding
does not sink a grounded sibling.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from arete_agents.models.fix import FixItem

# The calibrated confidence rubric (0.0-1.0 -- see the module docstring on
# why this codebase never moves to a 0-10 scale). Findings below
# MIN_GROUNDED_CONFIDENCE are "speculative" per the rubric and can never
# satisfy the findings-first gate, however well-grounded their evidence.
MIN_GROUNDED_CONFIDENCE = 0.4

FIX_FINDINGS_RUBRIC = """Confidence rubric (0.0-1.0 scale -- calibrate honestly; never round up):
- 0.9-1.0: a verbatim quote from a file read THIS run, AND an observed/reproduced failure
  (test output, CI log, stack trace).
- 0.7-0.9: a verbatim quote from a file read this run; the failure is inferred, not reproduced.
- 0.4-0.7: grounded in the checkout but paraphrased, or the causal link is argued rather than shown.
- 0.3 or below: speculative -- no quote, or the quote does not resolve in the checkout.

Evidence format is mandatory: a `path:line` plus a fenced verbatim quote from that file. A finding
with no quote, or whose quote cannot be found verbatim in the file, is rejected before any fix is
authored -- it can never reach 0.4 no matter what confidence is claimed for it."""


class FixFindingEvidence(BaseModel):
    """path:line plus a MANDATORY verbatim quote -- deliberately stricter
    than FixEvidenceRef.excerpt (models/fix.py), which is optional. A
    finding cannot be graded above "speculative" per the rubric without one."""

    model_config = ConfigDict(populate_by_name=True)

    path: str
    line: int
    quote: str = Field(min_length=1)


class FixFinding(BaseModel):
    """One structured statement of what is wrong and on what evidence -- the
    thing the findings-first gate requires exist before author_patch runs."""

    model_config = ConfigDict(populate_by_name=True)

    title: str
    detail: str
    dimension: str
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: list[FixFindingEvidence] = Field(default_factory=list)


class FixFindingsReport(BaseModel):
    """The structured findings report for one /fix run. An empty
    `findings` list is "no report at all" in the gate's own terms."""

    model_config = ConfigDict(populate_by_name=True)

    findings: list[FixFinding] = Field(default_factory=list)


def from_fix_item(item: FixItem) -> FixFindingsReport:
    """Build this run's findings report directly from the FixRequest's own
    `item` -- the caller's structured statement of what is wrong and on
    what evidence, which is exactly what the gate requires exist. Evidence
    entries with no excerpt cannot satisfy the mandatory verbatim-quote
    requirement and are dropped here (not carried through as ungrounded) so
    `ground_findings` never has to special-case a missing quote."""
    evidence = [
        FixFindingEvidence(path=ref.path, line=ref.line, quote=ref.excerpt)
        for ref in item.evidence
        if ref.excerpt
    ]
    return FixFindingsReport(
        findings=[
            FixFinding(
                title=item.title,
                detail=item.detail,
                dimension=item.dimension,
                confidence=item.confidence,
                evidence=evidence,
            )
        ]
    )


def ground_findings(report: FixFindingsReport, repo_dir: Path) -> tuple[list[FixFinding], list[str]]:
    """The deterministic gate: every evidence path must resolve as a real
    file in the checkout AND its quote must actually appear in that file's
    CURRENT content -- mechanical verification, never trusting the model's
    self-reported citation. A finding with no evidence at all fails too (a
    confidence claim with nothing behind it is not a finding).

    Returns (grounded_findings, violations). Unlike
    fix_pipeline._ground_files, one ungrounded finding does NOT invalidate
    the whole report -- findings are independent statements (see module
    docstring)."""
    grounded: list[FixFinding] = []
    violations: list[str] = []

    for finding in report.findings:
        if not finding.evidence:
            violations.append(f"finding {finding.title!r}: no evidence at all")
            continue

        finding_ok = True
        for ev in finding.evidence:
            target = repo_dir / ev.path
            if not target.is_file():
                violations.append(f"{ev.path}: does not exist in the checkout")
                finding_ok = False
                continue
            try:
                content = target.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                violations.append(f"{ev.path}: could not be read this run ({exc})")
                finding_ok = False
                continue
            if ev.quote not in content:
                violations.append(f"{ev.path}: quoted text does not appear verbatim in the file read this run")
                finding_ok = False

        if finding_ok:
            grounded.append(finding)

    return grounded, violations


def has_qualifying_finding(findings: list[FixFinding], min_confidence: float = MIN_GROUNDED_CONFIDENCE) -> bool:
    """True iff at least one finding meets the rubric's grounded bar
    (>= 0.4). ALWAYS call this on the list `ground_findings` already
    produced, never on a report's raw findings -- an ungrounded finding
    must never pass this check regardless of its claimed confidence."""
    return any(f.confidence >= min_confidence for f in findings)
