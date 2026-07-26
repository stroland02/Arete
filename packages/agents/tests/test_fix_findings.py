"""Findings-first gate (Phase 2 Task 7): terminal actions (author_patch)
require a prior structured findings report whose evidence is mechanically
verified against the checkout, never trusted on the model's self-report.

Confidence stays 0-1 in this codebase (five existing consumers assume it —
FixItem.confidence, AgentStatus, StatusReport, WorkItem.confidence,
escalationTier()). See docs/superpowers/plans/2026-07-21-obs-phase-2-healing-alerting.md
Task 7 for the calibrated rubric this pins.

Two layers of tests:
- unit tests against fix_findings.py's model + deterministic gate directly
  (mirrors fix_pipeline._ground_files' own test style: no LLM, no mocks
  needed for the gate itself).
- pipeline integration tests proving the gate actually sits in front of
  author_patch inside _run_fix_inner (mirrors test_fix_pipeline.py's own
  ensure_repo_checked_out-patching convention).
"""

from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from arete_agents.config import Settings
from arete_agents.fix_findings import (
    FixFinding,
    FixFindingEvidence,
    FixFindingsReport,
    from_fix_item,
    ground_findings,
    has_qualifying_finding,
)
from arete_agents.fix_pipeline import run_fix
from arete_agents.models.fix import FixItem, FixRepo, FixRequest


def _finding(confidence, evidence, dimension="security"):
    return FixFinding(title="t", detail="d", dimension=dimension, confidence=confidence, evidence=evidence)


def _write(repo_dir, path, content):
    target = repo_dir / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return target


# --- ground_findings: mechanical evidence verification ----------------------


def test_evidence_path_that_does_not_exist_in_checkout_is_rejected(tmp_path):
    finding = _finding(0.8, [FixFindingEvidence(path="missing.ts", line=1, quote="x")])
    grounded, violations = ground_findings(FixFindingsReport(findings=[finding]), tmp_path)

    assert grounded == []
    assert any("missing.ts" in v for v in violations)


def test_evidence_quote_not_present_in_the_file_read_this_run_is_rejected(tmp_path):
    _write(tmp_path, "a.ts", "export function f() {}\n")
    finding = _finding(0.8, [FixFindingEvidence(path="a.ts", line=1, quote="this text is nowhere in the file")])
    grounded, violations = ground_findings(FixFindingsReport(findings=[finding]), tmp_path)

    assert grounded == []
    assert violations


def test_finding_with_no_evidence_at_all_is_rejected(tmp_path):
    finding = _finding(0.9, [])
    grounded, violations = ground_findings(FixFindingsReport(findings=[finding]), tmp_path)

    assert grounded == []
    assert violations


def test_valid_evidence_resolves_and_is_grounded(tmp_path):
    _write(tmp_path, "a.ts", "export function f() {}\n")
    finding = _finding(0.8, [FixFindingEvidence(path="a.ts", line=1, quote="export function f")])
    grounded, violations = ground_findings(FixFindingsReport(findings=[finding]), tmp_path)

    assert grounded == [finding]
    assert violations == []


def test_one_bad_finding_does_not_sink_a_sibling_good_finding(tmp_path):
    # Findings are independent statements (like /scan's per-finding drop),
    # NOT causally linked like an authored patch's files -- see
    # fix_pipeline.py's own module docstring on why patch-file grounding is
    # whole-patch but findings grounding must not be.
    _write(tmp_path, "a.ts", "export function f() {}\n")
    good = _finding(0.8, [FixFindingEvidence(path="a.ts", line=1, quote="export function f")])
    bad = _finding(0.9, [FixFindingEvidence(path="missing.ts", line=1, quote="x")])
    grounded, violations = ground_findings(FixFindingsReport(findings=[good, bad]), tmp_path)

    assert grounded == [good]
    assert any("missing.ts" in v for v in violations)


# --- has_qualifying_finding: the >= 0.4 rubric bar ---------------------------


def test_only_speculative_findings_do_not_qualify(tmp_path):
    _write(tmp_path, "a.ts", "x\n")
    low = _finding(0.3, [FixFindingEvidence(path="a.ts", line=1, quote="x")])
    grounded, _ = ground_findings(FixFindingsReport(findings=[low]), tmp_path)

    assert has_qualifying_finding(grounded) is False


def test_a_grounded_finding_at_the_bar_qualifies(tmp_path):
    _write(tmp_path, "a.ts", "x\n")
    ok = _finding(0.4, [FixFindingEvidence(path="a.ts", line=1, quote="x")])
    grounded, _ = ground_findings(FixFindingsReport(findings=[ok]), tmp_path)

    assert has_qualifying_finding(grounded) is True


def test_an_ungrounded_high_confidence_finding_never_qualifies(tmp_path):
    # The whole point of the gate: a high self-reported confidence must
    # never substitute for evidence that actually resolves in the checkout.
    finding = _finding(0.95, [FixFindingEvidence(path="missing.ts", line=1, quote="x")])
    grounded, _ = ground_findings(FixFindingsReport(findings=[finding]), tmp_path)

    assert has_qualifying_finding(grounded) is False


def test_empty_findings_list_has_no_qualifying_finding():
    assert has_qualifying_finding([]) is False


# --- confidence stays 0-1 and is validated at construction -------------------


def test_confidence_above_one_is_a_validation_error():
    with pytest.raises(ValidationError):
        FixFinding(title="t", detail="d", dimension="security", confidence=1.5, evidence=[])


def test_confidence_below_zero_is_a_validation_error():
    with pytest.raises(ValidationError):
        FixFinding(title="t", detail="d", dimension="security", confidence=-0.1, evidence=[])


def test_confidence_of_ten_is_a_validation_error_not_a_valid_top_score():
    # Regression guard for the scope decision: this codebase is 0-1, NOT
    # 0-10 (the spec's illustrative scale). 10 must be rejected, not clamped.
    with pytest.raises(ValidationError):
        FixFinding(title="t", detail="d", dimension="security", confidence=10, evidence=[])


# --- from_fix_item: FixRequest.item -> FixFindingsReport ---------------------


def test_from_fix_item_maps_excerpt_to_the_mandatory_quote_field():
    item = FixItem(
        kind="issue",
        title="t",
        detail="d",
        dimension="security",
        confidence=0.8,
        evidence=[{"path": "a.ts", "line": 1, "excerpt": "db.raw(q)"}],
    )
    report = from_fix_item(item)

    assert len(report.findings) == 1
    assert report.findings[0].confidence == 0.8
    assert report.findings[0].evidence[0].quote == "db.raw(q)"


def test_from_fix_item_drops_evidence_with_no_excerpt():
    # A verbatim quote is mandatory -- an evidence ref with no excerpt cannot
    # satisfy it and must not silently pass through as grounded.
    item = FixItem(
        kind="issue",
        title="t",
        detail="d",
        dimension="security",
        confidence=0.8,
        evidence=[{"path": "a.ts", "line": 1}],
    )
    report = from_fix_item(item)

    assert report.findings[0].evidence == []


def test_from_fix_item_with_no_evidence_at_all_produces_no_report():
    item = FixItem(kind="issue", title="t", detail="d", dimension="security", confidence=0.8, evidence=[])
    report = from_fix_item(item)

    assert report.findings[0].evidence == []


# --- pipeline integration: the gate sits in front of author_patch -----------


def _checkout(tmp_path, installation_id=42, repo_slug="acme/shop"):
    repo_dir = tmp_path / str(installation_id) / repo_slug
    target = repo_dir / "app" / "api" / "reports.ts"
    target.parent.mkdir(parents=True)
    target.write_text(
        "import { db } from '../data/db'\nexport function reports(q) {\n  return db.raw(q)\n}\n",
        encoding="utf-8",
    )
    return repo_dir


def _request(confidence=0.8, evidence=None, **overrides):
    if evidence is None:
        evidence = [{"path": "app/api/reports.ts", "line": 3, "excerpt": "db.raw(q)"}]
    base = dict(
        containerId="cont_1",
        installationId=42,
        repo=FixRepo(fullName="acme/shop", defaultBranch="main", token="tok"),
        item=FixItem(
            kind="issue",
            title="SQL built from raw request input",
            detail="reports() passes q straight into db.raw.",
            dimension="security",
            confidence=confidence,
            evidence=evidence,
        ),
    )
    base.update(overrides)
    return FixRequest(**base)


def _run(tmp_path, req, llm=None):
    checkout = _checkout(tmp_path)
    llm = llm or MagicMock()
    with patch("arete_agents.fix_pipeline.ensure_repo_checked_out", return_value=checkout), patch(
        "arete_agents.fix_pipeline.author_patch"
    ) as author_mock:
        result = run_fix(
            req,
            {"security": llm},
            verify_settings=Settings(llm_provider="anthropic", anthropic_api_key="sk-test"),
            repo_root=tmp_path,
        )
    return result, author_mock


def test_run_with_no_evidence_at_all_returns_fix_failed_no_grounded_findings(tmp_path):
    req = _request(evidence=[])
    result, author_mock = _run(tmp_path, req)

    assert result.status == "fix_failed"
    assert result.reason == "no_grounded_findings"
    author_mock.assert_not_called()


def test_run_with_only_speculative_confidence_does_not_reach_author_patch(tmp_path):
    req = _request(confidence=0.2)
    result, author_mock = _run(tmp_path, req)

    assert result.status == "fix_failed"
    assert result.reason == "no_grounded_findings"
    author_mock.assert_not_called()


def test_run_with_evidence_path_absent_from_checkout_does_not_reach_author_patch(tmp_path):
    req = _request(evidence=[{"path": "does/not/exist.ts", "line": 1, "excerpt": "whatever"}])
    result, author_mock = _run(tmp_path, req)

    assert result.status == "fix_failed"
    assert result.reason == "no_grounded_findings"
    author_mock.assert_not_called()


def test_run_with_a_valid_grounded_finding_proceeds_to_author_patch(tmp_path):
    checkout = _checkout(tmp_path)
    req = _request()
    llm = MagicMock()
    llm.with_retry.return_value = llm

    with patch("arete_agents.fix_pipeline.ensure_repo_checked_out", return_value=checkout), patch(
        "arete_agents.fix_pipeline.author_patch", return_value={"files": [], "summary": "no fix produced"}
    ) as author_mock:
        result = run_fix(
            req,
            {"security": llm},
            verify_settings=Settings(llm_provider="anthropic", anthropic_api_key="sk-test"),
            repo_root=tmp_path,
        )

    author_mock.assert_called_once()
    assert result.status == "fix_failed"
    assert result.reason != "no_grounded_findings"
    assert result.reason == "no fix produced"
