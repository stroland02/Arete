# Cross-Tier Eval Judge (SP5c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the eval harness's cross-*vendor* Gemini judge with a cross-*tier* Anthropic judge (finder on one tier, judge on a different tier), and remove the now-dead Gemini/provider config. Default: **opus finder → sonnet judge** — the grader is a different model than the finder, reducing same-model bias and making the SP5a benchmark numbers more credible (mirrors the CriticAgent's opus↔sonnet independence).

**Architecture (approved design):** Both finder and judge are Anthropic; tiers come from new config `eval_finder_tier` (default `opus`) / `eval_judge_tier` (default `sonnet`). `build_anthropic_llm(api_key, tier=...)` already maps `opus→claude-opus-4-8`, `sonnet→claude-sonnet-5`. Gemini is removed from the **eval** path ONLY — the dormant `llm_provider=gemini` app path and `gemini_api_key` stay. `--judge stub` remains for keyless deterministic tests.

**Tech Stack:** Python 3.12, pydantic-settings, pytest. Package lane: `packages/agents` (`eval/` + eval-only `config.py` fields). No overlap with SP2 (`base.py`/Synthesizer/Critic).

## Global Constraints

- **Lane:** only `config.py` (eval-only fields), `eval/matcher.py`, `eval/__main__.py`, and their tests. Do NOT touch `base.py`, Synthesizer, Critic, the `llm_provider=gemini` app path, or `gemini_api_key`.
- **Keep `--judge stub`** (keyless, deterministic) — all tests run with it or fake LLMs; no network, no real key.
- **Preserve SP5a honesty:** `report.meta["judge_mode"]` must still carry `"stub"` vs `"cross-tier"` so `render_card`'s unverified banner keeps working; the CLI `verified = (judge_mode != "stub") and (overall.errors == 0)` gate is unchanged in spirit.
- **Backward-compat within eval:** existing report/scorer/loader/runner untouched; only the finder/judge construction and its config change.
- Setup: `cd packages/agents && uv sync --extra dev`; `uv run pytest`.

---

### Task 1: Config — provider fields → tier fields

**Files:** Modify `packages/agents/src/arete_agents/config.py`; Test `packages/agents/tests/test_config.py`

**Change:** remove `eval_finder_provider` and `eval_judge_provider`; add:
```python
    eval_finder_tier: Literal["opus", "sonnet"] = "opus"
    eval_judge_tier: Literal["opus", "sonnet"] = "sonnet"
```
(`eval_f1_threshold` stays.)

- [ ] **Step 1:** In `test_config.py` add a test asserting `Settings(...).eval_finder_tier == "opus"` and `eval_judge_tier == "sonnet"` by default, and that both accept `"sonnet"`/`"opus"`. If an existing test references `eval_finder_provider`/`eval_judge_provider`, update it to the new fields (search first). Run `uv run pytest tests/test_config.py -v` → FAIL.
- [ ] **Step 2:** Apply the config change. Run → PASS.
- [ ] **Step 3:** Commit: `feat(eval): cross-tier eval config (finder/judge tiers, drop provider fields)`.

### Task 2: `matcher.build_judge` — cross-tier Anthropic, drop Gemini

**Files:** Modify `eval/matcher.py`; Test `tests/test_eval_matcher.py`

**New signature/behavior:**
```python
def build_judge(
    mode: str,
    anthropic_api_key: str = "",
    judge_tier: str = "sonnet",
) -> tuple[object, bool]:
    if mode == "stub":
        return StubJudge(), True
    if mode == "cross-tier":
        from arete_agents.llm.anthropic import build_anthropic_llm
        return LLMJudge(build_anthropic_llm(anthropic_api_key, tier=judge_tier)), False
    raise ValueError(f"Unknown judge mode: {mode!r}")
```
Remove the `gemini` and old `anthropic` branches. `StubJudge`/`LLMJudge`/`match_comments` are unchanged.

- [ ] **Step 1:** Update `tests/test_eval_matcher.py`: replace any `build_judge("gemini", ...)`/`build_judge("anthropic", ...)` cases with (a) `build_judge("stub")` → `(StubJudge, True)`; (b) `build_judge("cross-tier", "key", "sonnet")` → returns an `LLMJudge` whose wrapped LLM is a sonnet-tier Anthropic model (assert `is_stub is False`; patch/monkeypatch `build_anthropic_llm` to capture the `tier` arg = `"sonnet"`); (c) an unknown mode raises `ValueError`. Run → FAIL.
- [ ] **Step 2:** Apply the `build_judge` change. Run `uv run pytest tests/test_eval_matcher.py -v` → PASS.
- [ ] **Step 3:** Commit: `feat(eval): cross-tier Anthropic judge, remove Gemini judge path`.

### Task 3: CLI wiring — finder tier, judge mode, meta

**Files:** Modify `eval/__main__.py`; Test `tests/test_eval_cli.py`

**Changes:**
- Delete `resolve_providers`. Replace `build_finder_llm(provider, settings)` with:
  ```python
  def build_finder_llm(settings: Settings) -> BaseChatModel:
      from arete_agents.llm.anthropic import build_anthropic_llm
      return build_anthropic_llm(settings.anthropic_api_key, tier=settings.eval_finder_tier)
  ```
- `_parse_args`: `--judge` becomes `choices=["stub", "cross-tier"], default="cross-tier"`.
- `main`: `judge_mode = args.judge`; `finder_llm = build_finder_llm(settings)`;
  `judge, is_stub = build_judge(judge_mode, settings.anthropic_api_key, settings.eval_judge_tier)`.
- `meta` keys: replace `finder_provider`/`judge_mode` with
  `{"finder_tier": settings.eval_finder_tier, "judge_mode": judge_mode, "judge_tier": settings.eval_judge_tier, "window": ..., "fixtures": ...}`.
  (Keep `judge_mode` in meta so `render_card`'s stub-detection still works.)

- [ ] **Step 1:** Update `tests/test_eval_cli.py`: any patch/reference to `resolve_providers` or `build_finder_llm(provider, ...)` → the new no-arg-provider form; `--judge` default is `cross-tier`; assert `--judge stub` still yields the stub path; assert `main(["--report","json"])` still emits parseable JSON whose `meta` contains `finder_tier`/`judge_tier`. Keep the `_run_main_with_fake_pipeline` real-`EvalFixture` input (from SP5a). Run → FAIL.
- [ ] **Step 2:** Apply the `__main__.py` changes. Run `uv run pytest tests/test_eval_cli.py -v` → PASS.
- [ ] **Step 3:** Commit: `feat(eval): CLI uses cross-tier finder/judge; drop provider resolution`.

### Task 4: Full-suite green (integration stragglers)

**Files:** possibly `tests/test_eval_integration.py` (and any other caller surfaced by the suite).

- [ ] **Step 1:** Run the FULL suite `uv run pytest -q`. Fix any remaining references to the removed symbols (`resolve_providers`, `eval_finder_provider`, `eval_judge_provider`, old `build_judge`/`build_finder_llm` signatures) in tests ONLY — do not change product behavior. Keep every fix minimal and keyless (stub/fake).
- [ ] **Step 2:** Re-run `uv run pytest -q` → all green (baseline before this work: 229 passed / 1 skipped; count may shift as gemini-judge tests are replaced).
- [ ] **Step 3:** Commit (only if Step 1 changed files): `test(eval): update integration tests for cross-tier judge`.

---

## Self-Review

- **Coverage:** config §→T1; judge construction →T2; CLI wiring/meta →T3; integration →T4. ✅
- **Type consistency:** `build_judge(mode, anthropic_api_key, judge_tier)` (T2) is called by `__main__.main` (T3) with `(judge_mode, settings.anthropic_api_key, settings.eval_judge_tier)`; `build_finder_llm(settings)` (T3) reads `settings.eval_finder_tier` (T1). Names align. ✅
- **Honesty preserved:** `meta["judge_mode"]` retained (T3) so `render_card` stub-detection + the `verified` gate keep working. ✅
- **No placeholders:** every task has concrete code + commands. ✅
- **Lane discipline:** only eval + eval-config + eval tests; Gemini removed from eval path only. ✅
