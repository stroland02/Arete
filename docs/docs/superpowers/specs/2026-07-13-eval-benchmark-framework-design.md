# Reproducible Benchmark Framework (SP5a) — Design Spec

**Status:** Approved design, pending implementation plan
**Date:** 2026-07-13
**Builds on:** the existing eval harness (`packages/agents/src/arete_agents/eval/`)
**Package lane:** `agents` only (`eval/` subpackage + tests + a generated card). Additive.

## Goal

Turn Areté's existing agent-eval harness into a **rigorous, reproducible,
publishable benchmark**: stratified scoring (per-severity + clean-file
false-alarm rate), a content-hashed dataset manifest for reproducibility, and a
committed-quality markdown "benchmark card" with an honest verified/unverified
banner. This is the competitive moat — no competitor (CodeRabbit, Devin)
publishes a reproducible accuracy benchmark. SP5a is the framework; growing the
dataset (SP5b) and the cross-tier judge (SP5c) are separate later specs.

## Context: what already exists (do NOT rebuild)

- **Golden dataset:** `packages/agents/eval/fixtures/*.json` — 16 `EvalFixture`s
  (3 `clean=True`, plus 2 defect fixtures per agent domain), each with
  `PlantedDefect`s (`id`, `path`, `line`, `target_agent`, `description`,
  `severity`). Loaded by `loader.load_fixtures(dir)`.
- **Scoring:** `scorer.py` computes per-agent + overall `AgentScore` (tp/fp/fn/
  precision/recall/f1/fp_rate/errors), `collect_misses`, `collect_false_positives`,
  `f1_regressed`.
- **Matching:** `matcher.py` — localization (path + category + line window) then a
  `StubJudge`/`LLMJudge` confirmation → `MatchResult`.
- **Report:** `report.build_report` → `EvalReport`; `render_markdown` (per-agent +
  overall table, misses/FP counts, an errors warning), `render_json`.
- **Runner:** `runner.run_all` → `list[FixtureAgentResult]` (per fixture×agent,
  carrying `comments`, `relevant_defects`, `match_results`, `errors`).
- **CLI (`__main__.py`):** `--fixtures`, `--judge {gemini,anthropic,stub}`,
  `--report {md,json}`, `--window`, `--update-baseline`, `--baseline`; refuses to
  write a baseline when `overall.errors > 0` (honest — no fake zero-baseline).

## Non-goals (deferred)

- Growing the fixture dataset (**SP5b**).
- Cross-tier opus↔sonnet judge replacing Gemini (**SP5c**).
- Per-language breakdown (YAGNI for now), CI wiring, statistical confidence
  intervals.
- Any change outside `eval/` (no `base.py`/Synthesizer/Critic — that is SP2's
  lane).

## Components

### 1. New/extended models (`eval/models.py`)

```python
class SeverityScore(BaseModel):
    severity: Literal["info", "warning", "error"]
    tp: int
    fp: int
    fn: int
    precision: float
    recall: float
    f1: float
    fp_rate: float

class CleanFileStats(BaseModel):
    clean_fixtures: int          # fixtures with clean=True
    clean_fixtures_flagged: int  # of those, how many drew >=1 comment
    false_alarm_rate: float      # flagged / clean_fixtures (0.0 if none)

class DatasetComposition(BaseModel):
    total_fixtures: int
    clean_fixtures: int
    defect_fixtures: int
    total_defects: int
    by_category: dict[str, int]   # target_agent -> defect count
    by_severity: dict[str, int]   # severity -> defect count
    dataset_hash: str             # sha256 of canonical fixture content

# EvalReport gains (all defaulted for backward compatibility):
#   per_severity: list[SeverityScore] = Field(default_factory=list)
#   clean_file: CleanFileStats | None = None
#   composition: DatasetComposition | None = None
# FixtureAgentResult gains:
#   clean: bool = False   # mirrors the source fixture's clean flag
```

### 2. Stratified scoring (`eval/scorer.py`, additive functions)

- `score_by_severity(results: list[FixtureAgentResult]) -> list[SeverityScore]`:
  for each severity S, `tp(S)` = matched planted defects whose `severity == S`;
  `fn(S)` = unmatched planted defects of severity S; `fp(S)` = unmatched comments
  (`m.defect_id is None`) whose `comment.severity == S`. Reuse the existing
  `_prf` helper. Emit one `SeverityScore` per severity present, in fixed order
  `["error", "warning", "info"]`.
- `clean_file_stats(results: list[FixtureAgentResult]) -> CleanFileStats`:
  group results by `fixture_id`; a fixture is clean iff any of its
  `FixtureAgentResult`s has `clean is True`; `clean_fixtures_flagged` = clean
  fixtures where the summed `comments` across agents is non-empty;
  `false_alarm_rate = _safe_div(flagged, clean_fixtures)`.

Existing `score_agent`/`aggregate_overall` are unchanged.

### 3. Dataset manifest (`eval/loader.py`, additive)

- `compute_composition(fixtures: list[EvalFixture]) -> DatasetComposition`:
  counts as above; `dataset_hash = sha256` over a canonical serialization —
  `json.dumps([f.model_dump() for f in sorted(fixtures, key=lambda x: x.id)],
  sort_keys=True, separators=(",", ":"))` encoded utf-8. Stable across runs and
  machines (order- and whitespace-independent), so a published number is
  verifiable against a dataset hash.

### 4. Runner (`eval/runner.py`, one-line addition)

`run_fixture` sets `clean=fixture.clean` on each `FixtureAgentResult` it builds.
No other behavior change.

### 5. Report + benchmark card (`eval/report.py`)

- `build_report(results, meta=None, composition=None)` — also populate
  `per_severity` (via `score_by_severity`), `clean_file` (via
  `clean_file_stats`), and `composition` (passed through).
- `render_card(report: EvalReport, verified: bool) -> str` — the publishable
  benchmark card, markdown:
  1. **Banner:** if `verified` → `> ✅ VERIFIED BASELINE`; else
     `> ⚠️ ILLUSTRATIVE — not a verified baseline` with the reason
     (stub judge and/or `overall.errors > 0`). Never present unverified numbers
     as verified (anti-fabrication).
  2. **Methodology:** one short paragraph — planted-defect fixtures, localization
     window + judge confirmation, P/R/F1/FP-rate definitions.
  3. **Dataset composition:** table from `composition` (totals, by_category,
     by_severity, `dataset_hash`). Honest empty-state line if `composition is
     None`.
  4. **Results:** the existing per-agent+overall table (reuse `_row`), then a
     per-severity table, then the clean-file false-alarm rate.
  5. **Limitations:** fixed honest text — synthetic planted defects, dataset
     size (`total_fixtures`), judge is an LLM, numbers pending a verified run
     when unverified.
- `render_markdown`/`render_json` unchanged (backward compatible).

### 6. CLI (`eval/__main__.py`)

- `--report` choices become `{md, json, card}`.
- Before `build_report`, compute `composition = compute_composition(fixtures)`
  and pass it in.
- `verified = (judge_mode != "stub") and (report.overall.errors == 0)`.
- `--report card` → `print(render_card(report, verified))`.
- New optional `--card-out PATH` → also write the card to that path (e.g.
  `eval/BENCHMARK.md`) so the benchmark is a committed artifact. Writing is
  independent of `--report` so `--report json --card-out eval/BENCHMARK.md`
  works.
- `md`/`json` paths and the baseline/regression logic are unchanged.

## Data flow

`load_fixtures` → `compute_composition` (hash + counts) → `run_all` (each
`FixtureAgentResult` now carries `clean`) → `build_report` (per-agent + overall +
per-severity + clean-file + composition) → `render_card`/`render_markdown`/
`render_json` → stdout and/or `--card-out` file.

## Error handling / honesty

- Reuses the harness's existing honesty: baseline write still refused on errors;
  the card's banner is **unverified** whenever the judge is `stub` or any agent
  errored, with the reason shown. A key-blocked run (stub judge) therefore
  produces an honestly-labelled illustrative card, never a fake "verified"
  number — directly satisfying the anti-fabrication house standard.
- All new functions are pure/deterministic given inputs; no network.

## Testing (extend the existing eval test suite; fake LLM + stub judge)

- `tests/test_eval_scorer.py` (extend) — `score_by_severity` math (a mixed
  fixture set: a matched error defect, a missed warning defect, an unmatched
  info comment → expected per-severity tp/fp/fn); `clean_file_stats` (a clean
  fixture with comments → flagged; a clean fixture with none → not flagged).
- `tests/test_eval_loader.py` (extend) — `compute_composition` counts; and
  `dataset_hash` is stable across two calls and **order-independent** (shuffled
  input list → same hash), and changes when a defect changes.
- `tests/test_eval_report.py` (extend) — `render_card` shows the ✅ banner when
  `verified=True`, the ⚠️ banner + reason when `verified=False`, includes the
  dataset hash, per-severity rows, and the clean-file rate.
- `tests/test_eval_cli.py` (extend) — `--report card` prints a card; `--card-out`
  writes the file; `--report json` output still parses (backward compat). All
  run with the stub judge (no key, deterministic).

## Implementation note (branch hygiene)

Implemented in worktree `C:/Users/strol/arete-eval-benchmark` (branch
`feat/eval-benchmark-framework`, off `origin/main` `025103a`). Merge via remote
fast-forward, no `checkout main` in the shared worktree
([[feedback-multiagent-branch-hazard]]). SP2 is in flight on `base.py`/
Synthesizer/Critic — this touches only `eval/`, so no collision.

## Provenance

SP5a of the competitor master plan. The "publish a rigorous, reproducible P/R/F1
+ false-positive benchmark" move is the single clearest gap across CodeRabbit and
Devin (contested/self-reported numbers, no reproducible benchmark). The
clean-file false-alarm rate and dataset hash are what make ours credible and
verifiable.
