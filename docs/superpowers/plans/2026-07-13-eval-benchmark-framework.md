# Reproducible Benchmark Framework (SP5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend the eval harness with stratified scoring (per-severity + clean-file false-alarm rate), a content-hashed dataset manifest, and a publishable "benchmark card" with an honest verified/unverified banner.

**Architecture:** Additive functions/models in the existing `eval/` subpackage. Full design + exact field lists and card structure are in `docs/superpowers/specs/2026-07-13-eval-benchmark-framework-design.md` — read it first; this plan sequences the work and pins the tests.

**Tech Stack:** Python 3.12, pydantic, pytest. Package lane: `packages/agents/src/arete_agents/eval/` only.

## Global Constraints

- **Additive & backward-compatible:** existing `AgentScore`, `score_agent`, `aggregate_overall`, `render_markdown`, `render_json`, and all existing eval tests stay green and unmodified. New `EvalReport` fields are defaulted.
- **`eval/` lane ONLY** — do NOT touch `base.py`, Synthesizer, or Critic (SP2's lane).
- **Determinism/honesty:** all new functions pure and deterministic (no network); the card's banner is "verified" ONLY when `judge != stub` AND `overall.errors == 0` — never present unverified numbers as verified (anti-fabrication).
- **Reuse existing helpers:** `_prf`, `_safe_div` in `scorer.py`; `_row` in `report.py`.
- **Severity order:** always `["error", "warning", "info"]`.
- **Test convention:** deterministic, stub judge / fake LLM, no key, no network. Run from `packages/agents/`, `uv sync --extra dev` first, `uv run pytest`.

---

### Task 1: New models

**Files:** Modify `packages/agents/src/arete_agents/eval/models.py`; Test `packages/agents/tests/test_eval_models.py`

**Produces:** `SeverityScore`, `CleanFileStats`, `DatasetComposition` (fields per spec §Components.1); `EvalReport` gains `per_severity: list[SeverityScore] = Field(default_factory=list)`, `clean_file: CleanFileStats | None = None`, `composition: DatasetComposition | None = None`; `FixtureAgentResult` gains `clean: bool = False`.

- [ ] **Step 1:** Add a test constructing each new model with valid data and asserting an existing `EvalReport(...)` (old call sites, no new fields) still validates (defaults apply). Run `uv run pytest tests/test_eval_models.py -v` → FAIL (models missing).
- [ ] **Step 2:** Add the models/fields exactly as the spec lists them. Run the test → PASS.
- [ ] **Step 3:** Commit: `feat(eval): add severity/clean-file/composition models`.

### Task 2: Stratified scoring

**Files:** Modify `eval/scorer.py`; Test `tests/test_eval_scorer.py`
**Consumes:** Task 1 models. **Produces:** `score_by_severity(results) -> list[SeverityScore]`, `clean_file_stats(results) -> CleanFileStats` (logic per spec §Components.2).

- [ ] **Step 1:** Write failing tests: build `FixtureAgentResult`s covering (a) a matched `error` defect (tp), a missed `warning` defect (fn), and an unmatched comment with `severity="info"` (fp) → assert the per-severity `SeverityScore`s; (b) one clean fixture (`clean=True`) whose agents produced a comment → flagged, one clean fixture with no comments → not flagged → assert `CleanFileStats`. Run → FAIL.
- [ ] **Step 2:** Implement both functions reusing `_prf`/`_safe_div`. Run → PASS.
- [ ] **Step 3:** Commit: `feat(eval): per-severity scores and clean-file false-alarm rate`.

### Task 3: Dataset manifest + hash

**Files:** Modify `eval/loader.py`; Test `tests/test_eval_loader.py`
**Consumes:** Task 1 `DatasetComposition`. **Produces:** `compute_composition(fixtures) -> DatasetComposition` (canonical sha256 per spec §Components.3).

- [ ] **Step 1:** Write failing tests: from a small in-memory `list[EvalFixture]` (mix of clean + defect), assert composition counts; assert `dataset_hash` is (a) identical across two calls, (b) identical when the input list order is shuffled, (c) different when a defect's description changes. Run → FAIL.
- [ ] **Step 2:** Implement `compute_composition` with the canonical `json.dumps(..., sort_keys=True, separators=(",",":"))` over id-sorted `model_dump()`s, sha256 hex. Run → PASS.
- [ ] **Step 3:** Commit: `feat(eval): dataset composition + reproducibility hash`.

### Task 4: Runner carries the clean flag

**Files:** Modify `eval/runner.py`; Test `tests/test_eval_runner.py` (extend or add)
**Produces:** `run_fixture` sets `clean=fixture.clean` on each `FixtureAgentResult`.

- [ ] **Step 1:** Write a failing test: run `run_fixture` on a `clean=True` fixture with a fake agent (stub judge) and assert every returned `FixtureAgentResult.clean is True`; and `False` for a defect fixture. Run → FAIL.
- [ ] **Step 2:** Add `clean=fixture.clean` to the `FixtureAgentResult(...)` construction. Run → PASS. Also run `tests/test_eval_runner.py` and `tests/test_eval_integration.py` to confirm no regression.
- [ ] **Step 3:** Commit: `feat(eval): runner records source fixture clean flag`.

### Task 5: Report population + benchmark card

**Files:** Modify `eval/report.py`; Test `tests/test_eval_report.py`
**Consumes:** Tasks 1–2 (`score_by_severity`, `clean_file_stats`), Task 1 composition. **Produces:** `build_report(results, meta=None, composition=None)` populates `per_severity`/`clean_file`/`composition`; `render_card(report, verified) -> str` (structure per spec §Components.5).

- [ ] **Step 1:** Write failing tests: `build_report(results, composition=comp)` populates the three new fields; `render_card(report, verified=True)` contains "✅ VERIFIED BASELINE" and the `dataset_hash`, a per-severity row, and the clean-file rate; `render_card(report, verified=False)` contains "⚠️ ILLUSTRATIVE" and the reason. Run → FAIL.
- [ ] **Step 2:** Implement the `build_report` additions (keep the signature backward-compatible — `composition` defaults to `None`) and `render_card`. Reuse `_row`. Run → PASS. Also run the existing `test_eval_report.py` cases to confirm `render_markdown`/`render_json` unchanged.
- [ ] **Step 3:** Commit: `feat(eval): populate stratified report + render benchmark card`.

### Task 6: CLI card mode

**Files:** Modify `eval/__main__.py`; Test `tests/test_eval_cli.py`
**Consumes:** Tasks 3 & 5. **Produces:** `--report {md,json,card}`, `--card-out PATH`, `verified = (judge_mode != "stub") and (report.overall.errors == 0)`, composition computed from loaded fixtures and passed to `build_report`.

- [ ] **Step 1:** Write failing tests (invoke `main([...])` with the stub judge over the real fixtures dir or a tmp fixture): `--report card` prints a card containing the banner; `--card-out <tmp>` writes that file; `--report json` still emits parseable JSON (backward compat). Run → FAIL.
- [ ] **Step 2:** Implement: add `"card"` to `--report` choices, add `--card-out`, compute `composition = compute_composition(fixtures)`, pass to `build_report`, compute `verified`, branch on `--report`, and write `--card-out` when set. Run → PASS.
- [ ] **Step 3:** Run the FULL suite `uv run pytest -q` — all green, no regressions.
- [ ] **Step 4:** Commit: `feat(eval): --report card and --card-out CLI benchmark output`.

---

## Self-Review

- **Spec coverage:** models §1→T1; scoring §2→T2; manifest §3→T3; runner §4→T4; report+card §5→T5; CLI §6→T6. ✅
- **Backward compat:** T1 defaults + T5 signature default keep old call sites and `render_markdown`/`render_json`/existing tests green (asserted in T4/T5/T6 steps). ✅
- **Type consistency:** `score_by_severity`/`clean_file_stats` (T2) consumed by `build_report` (T5); `compute_composition` (T3) consumed by CLI (T6) and passed to `build_report` (T5); `FixtureAgentResult.clean` set in T4, read in T2. Names align. ✅
- **No placeholders:** each task pins concrete tests + commands; exact code/fields live in the referenced spec sections. ✅
- **Anti-fabrication:** the `verified` gate (T5 card + T6 wiring) ensures a stub/errored run is labelled ILLUSTRATIVE. ✅
