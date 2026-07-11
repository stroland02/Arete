# Design Spec: Areté Agent Eval Harness

**Date:** 2026-07-11
**Status:** Approved design — pending user review before planning
**Lane:** `packages/agents/` + `docs/` only (zero conflict with active `webhook`/`dashboard` agents)
**Related:** [research synthesis](../research/2026-07-11-code-review-agent-quality-research.md), [platform proposal](../../proposal/TYME-platform-proposal.md)

---

## 1. Goal

A deterministic, offline-capable harness that measures each review agent's **Precision / Recall / F1 and false-positive rate** against a hand-authored golden fixture set — so any prompt/model/harness change gets a truth signal, regressions are gated in CI, and we obtain a headline benchmark number to claim parity-plus against CodeRabbit (Martian F1 51.2%) / Qodo (F1 60.1%).

**Why first:** the research (see synthesis doc) shows the industry leaders' quality came from harness + context + a critic stage — but every one of them *measured* their way there. Eval is the instrument that de-risks and proves every later change (critic stage, deeper context, and eventually multi-solution fix generation).

## 2. Existing capability (dedup check)

- **Fix suggestions already exist:** each agent embeds a single ` ```suggestion ` block per finding (`agents/base.py`). One inline fix per comment; no alternatives.
- **Not present:** multi-solution generation, agent-to-agent fix debate, user-selectable candidate solutions, per-role model routing, or any evaluation/scoring of agent output.
- **Model wiring today:** `config.py` selects one provider globally (default Gemini); all six agents share it — no heterogeneous setup yet.

The harness does not duplicate anything. The **multi-solution fix-generation feature is explicitly deferred** to its own brainstorm (see §11); this harness is its prerequisite and is forward-designed to later score fix quality.

## 3. Scope

**In scope (v1):**
- Golden fixture format + loader (hand-authored synthetic diffs with planted defects)
- Runner that executes real agents over fixtures
- Hybrid matcher: deterministic localization gate + cross-model LLM description judge
- Scorer + Markdown/JSON report (per-agent + overall P/R/F1, false-positive rate)
- CLI entry point + baseline file + regression gate
- Offline unit tests + a mandatory live verification run

**Out of scope (YAGNI for v1):**
- Real-PR defect-injection pipeline (Qodo-style) — future expansion
- The runtime critic/verification stage in the orchestrator (Step 2 of the roadmap)
- Multi-solution fix generation / user selection (§11 — separate brainstorm)
- Graph/AST retrieval, dashboard visualization, CI infra wiring beyond the script

## 4. Design principles (from user refinements)

1. **Additive, non-damaging.** New `eval/` module + fixture data + tests. No changes to the agents' live `review_file` path or the orchestrator graph. Any `config.py` addition is optional and backward-compatible (existing behavior unchanged when new settings are absent).
2. **Best model per role, no bias.** Finder and judge are distinct roles with distinct providers. The description judge is **heterogeneous by default** (if finder = Claude, judge = Gemini, and vice-versa) to eliminate single-model "agreeableness bias" (research Theme 3). Both are configurable.
3. **Low-lag pipeline.** Eval is **offline/batch** — never in the live PR webhook path, so it adds **zero latency** to production reviews. Within eval, the cheap deterministic gate runs first; only gate-passing candidates reach the LLM judge, minimizing token spend and wall-clock.
4. **Tech-stack compliance.** Reuse existing `PRContext` / `FileChange` / `ReviewComment` Pydantic models, the existing LLM provider classes (`llm/`), and `uv` + `pytest`. No heavy new dependencies.

## 5. Architecture

New module `packages/agents/src/arete_agents/eval/`:

```
eval/
  __init__.py
  models.py       # PlantedDefect, EvalFixture, MatchResult, AgentScore, EvalReport
  loader.py       # load + validate fixtures from eval/fixtures/*.json
  runner.py       # run agent(s) over fixtures -> collected ReviewComments
  matcher.py      # hybrid: deterministic localization gate + LLM description judge
  scorer.py       # TP/FP/FN bookkeeping -> P/R/F1, FP-rate; baseline compare
  report.py       # render JSON + Markdown
  __main__.py     # CLI entry (python -m arete_agents.eval)
packages/agents/eval/fixtures/       # golden fixtures (data, JSON)
packages/agents/eval/baseline.json   # committed baseline scores
```

Data flow (per fixture, per agent):
```
fixture JSON -> EvalFixture -> runner: agent.review_file(file, pr) -> [ReviewComment]
   -> matcher: for each comment, localization gate (path ==, |line-planted| <= WINDOW, category == target_agent)
        -> if gate passes: LLM judge confirms body describes the planted defect
   -> scorer: defect w/ >=1 confirmed match = TP; comment matching nothing = FP; unmatched defect = FN
        -> clean fixture: any comment = FP
   -> report: per-agent + overall Precision, Recall, F1, FP-rate
```

## 6. Data model (`eval/models.py`)

```python
class PlantedDefect(BaseModel):
    id: str                       # stable id, e.g. "sqli-001"
    path: str                     # file the defect lives in
    line: int                     # expected line (matcher uses +/- WINDOW)
    target_agent: str             # agent_name expected to catch it (== ReviewComment.category)
    description: str              # ground-truth description of the defect
    severity: Literal["info", "warning", "error"]

class EvalFixture(BaseModel):
    id: str
    pr: PRContext                 # reuses existing model (files carry unified-diff patches)
    planted_defects: list[PlantedDefect] = []
    clean: bool = False           # True => no defects; any finding is a false positive

class MatchResult(BaseModel):
    defect_id: str | None         # None => unmatched comment (false positive)
    comment: ReviewComment
    localization_ok: bool
    description_ok: bool | None    # None when judge skipped (gate failed / stub mode)

class AgentScore(BaseModel):
    agent: str
    tp: int; fp: int; fn: int
    precision: float; recall: float; f1: float
    fp_rate: float                # FP / (TP + FP)

class EvalReport(BaseModel):
    per_agent: list[AgentScore]
    overall: AgentScore
    misses: list[PlantedDefect]           # FNs, for triage
    false_positives: list[ReviewComment]  # FPs, for triage
```

## 7. Matcher (hybrid scoring)

- **Localization gate (deterministic, cheap, first):** a `ReviewComment` is a *candidate* match for a `PlantedDefect` iff `comment.path == defect.path` **and** `abs(comment.line - defect.line) <= WINDOW` (default **WINDOW = 3**, configurable) **and** `comment.category == defect.target_agent`.
- **Description judge (LLM, cross-model, only on candidates):** a heterogeneous judge model receives `(comment.body, defect.description)` and returns a boolean "does this comment describe this defect?". This is the semantic half of the hit criterion (research: hit = accurate description **and** correct localization).
- **Judge modes:** `--judge gemini|anthropic` (real) or `--judge stub` (localization-only, deterministic, zero-token — used for CI gating and unit tests).
- **Bookkeeping:** defect with ≥1 confirmed match = **TP**; comment matching no defect = **FP**; defect with no match = **FN**; on a `clean` fixture every comment = **FP**.

## 8. Model roles (no bias)

- **Finder** = the production reviewer model (proposal targets `claude-opus-4-8` for PR analysis; harness reads provider from settings).
- **Judge** = a **different** provider from the finder by default (Claude↔Gemini). Built via the existing `llm/` provider classes. The harness instantiates finder and judge LLMs independently; it does **not** change the global single-provider default used by production.
- Optional additive settings (defaults preserve current behavior): `eval_finder_provider`, `eval_judge_provider`.

## 9. CLI + regression gate

`uv run python -m arete_agents.eval` with:
- `--agent NAME` (default: all six)
- `--fixtures PATH` (default: `eval/fixtures/`)
- `--judge {gemini,anthropic,stub}` (default: heterogeneous to finder)
- `--report {md,json}` (default: md to stdout)
- `--update-baseline` (write `baseline.json`)
- Exit non-zero if overall F1 drops more than THRESHOLD (default 0.05) below baseline → CI-gateable.

## 10. Fixture set v1 (hand-authored)

~12 defective fixtures (≈2 per agent) + ~3 clean fixtures:

| Target agent | Planted defects |
|---|---|
| Security | SQL injection via string-formatted query; hardcoded secret/API key |
| Performance | N+1 query in a loop; unbounded/quadratic loop over request data |
| Quality | Swallowed exception / missing error handling; dead/unreachable code |
| TestCoverage | New branch with no corresponding test |
| DeploymentSafety | Schema change with no migration; breaking public API signature change |
| BusinessLogic | Off-by-one / inverted business rule (e.g. discount applied wrong) |
| (clean x3) | Correct diffs across languages — must produce **zero** findings |

Each fixture is a small unified-diff `patch` inside a `PRContext`. Languages spread across Python/TS/SQL to exercise `FileChange.language`.

## 11. Deferred: multi-solution fix generation (separate brainstorm)

The user's idea — agents propose **multiple candidate fixes with descriptions/tradeoffs**, optionally debating, and the user selects one — is valuable and **not** a duplicate (today we have single inline suggestions only). It maps to the proposal's Phase-3 "improvement proposals / Act stage." It is deferred because:
- It's a materially larger feature (candidate generation, tradeoff synthesis, selection UI in the `dashboard`/`webhook` lanes — currently occupied).
- It should be **measured**, and this harness is the prerequisite instrument. The harness's fixture/scoring model extends naturally to scoring *fix* quality (candidate correctness) later.

Recommendation: brainstorm it as its own spec after the eval harness lands.

## 12. Testing & mandatory verification

**Offline unit tests (added to pytest suite, no API keys required):**
- `loader`: valid/invalid fixture parsing.
- `matcher`: deterministic gate on synthetic comment/defect pairs (exact/within-window/out-of-window/wrong-category/wrong-path) with `--judge stub`.
- `scorer`: P/R/F1/FP-rate math on hand-constructed TP/FP/FN counts (including divide-by-zero guards and the all-clean case).

**Mandatory live verification (user requirement — "run tests to verify correct metrics"):**
- Run the harness end-to-end on a *self-check* fixture whose expected outcome is known (a fixture where a specific comment is engineered to match, and a clean fixture that must score zero FPs), and confirm the reported P/R/F1 equal the hand-computed expected values. This run is required before the work is considered complete (per the verification-before-completion discipline).
- Must not regress the existing pytest baseline (29 passed, per `.claude/ade-coordination.md`).

## 13. Risks & mitigations

- **LLM judge non-determinism** -> deterministic gate carries pass/fail localization; judge only refines description match; `--judge stub` gives a fully reproducible CI signal.
- **Fixture overfitting** (agents tuned to pass 12 fixtures, not real PRs) -> v1 is explicitly a regression floor, not a quality ceiling; §3 flags the real-PR pipeline as the planned expansion.
- **Small-sample metrics noise** -> report raw TP/FP/FN alongside ratios; treat F1 movements below threshold as noise.
- **Model/provider drift** -> provider + model id recorded in the report header for reproducibility.
