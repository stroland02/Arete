# Design Spec: Anthropic-Only Per-Role Model Tiers

**Date:** 2026-07-12
**Status:** Approved design — Phase 1 (production tiers) implementing now; Phase 2 (eval judge) deferred
**Lane:** `packages/agents/` + `docs/` only

> **Phasing (added during implementation).** Two refinements to keep the change safe and proportionate:
> - **Phase 1 (this change):** the production per-role Anthropic tier system — §4 (config, minus the eval-provider-field removal), §5, §6, §8. `ReviewOrchestrator` uses a **union constructor** (`BaseChatModel | dict[str, BaseChatModel]`) rather than the dict-only "replace" in §6, so all existing single-`llm` test call sites keep working; production passes the per-role dict.
> - **Phase 2 (deferred follow-up):** the eval-harness cross-tier judge (§7) and removing `eval_finder_provider`/`eval_judge_provider` from config. The eval harness is offline-only, its current stub/vendor judge modes still function untouched, and the cross-tier judge cannot be live-verified without a working key — so it is not worth the test churn now. Tracked for a later spec/plan.
**Related:** [eval harness spec](2026-07-11-agent-eval-harness-design.md), [research synthesis](../research/2026-07-11-code-review-agent-quality-research.md)

---

## 1. Goal

Standardize the Areté agent pipeline on **Anthropic Claude models only**, and assign each agent a **Claude model tier matched to its role's decision complexity**, so that nuanced-judgment roles get the strongest model and mechanical roles get a faster/cheaper one. This is the infrastructure layer; the richer role-specific *prompt/reasoning* content is a separate follow-up spec (see §9).

**Why:** Anthropic is the chosen frontier provider for all AI-driven decisions in the product (PR review, bug diagnosis, synthesis). Uniform provider + role-appropriate capability gives structured, correct decision logic per role instead of one global model doing every job.

## 2. Scope

**In scope:**
- Provider default flips to `anthropic`; a **two-tier** model system (`opus`, `sonnet`) selectable per role.
- Per-role tier configuration in `config.py`.
- Parameterized Anthropic builder + a role→LLM registry in `llm/`.
- Production wiring (`orchestrator.py`, `server.py`, `cli.py`) consumes the registry.
- Eval harness (`arete_agents.eval`) mirrors production tiers for the finder, and switches its cross-**vendor** judge to a cross-**tier** judge.
- A standalone smoke test that verifies the new Sonnet model ID actually works before it is wired anywhere.

**Out of scope (YAGNI / later):**
- Richer role-specific system prompts and structured per-role reasoning frameworks → **Spec 2** (§9).
- A third (Haiku) tier → natural follow-up once Sonnet is proven.
- Removing the Gemini code path → explicitly **kept dormant** (§4).
- The critic/verification orchestrator stage → still its own separate future effort.

## 3. Tier → role mapping

Two tiers, assigned by decision complexity:

| Role (`agent_name`) | Tier | Rationale |
|---|---|---|
| `security` | opus | Nuanced exploit/vulnerability reasoning |
| `business_logic` | opus | Subtle domain-correctness judgment |
| `deployment_safety` | opus | Breaking-change blast-radius reasoning |
| `ci_diagnostics` (CIAgent) | opus | Root-causing noisy, ambiguous CI logs |
| Synthesizer | opus | Final gate: catch contradictions, obey custom rules |
| `performance` | sonnet | Pattern-recognizable (N+1, complexity classes) |
| `quality` | sonnet | Largely pattern-based (naming, dead code, swallowed errors) |
| `test_coverage` | sonnet | Structural check (new branch → no test) |
| ChatAgent | sonnet | Conversational, not correctness-critical |

**Tier → model ID:**
- `opus` → `claude-opus-4-8` (already in use and confirmed working in `llm/anthropic.py`).
- `sonnet` → `claude-sonnet-5` (**must be smoke-tested first** — see §8, Task 1).

## 4. Config (`config.py`)

- `llm_provider` default changes `"gemini"` → `"anthropic"`. The field, `gemini_api_key`, and the `gemini_key_required` validator **remain in place, dormant** (user decision: keep, don't delete).
- Add one tier field per role, typed `Literal["opus", "sonnet"]`, defaulting to the §3 mapping so behavior is fully env-overridable but correct out of the box:
  - `security_tier="opus"`, `business_logic_tier="opus"`, `deployment_safety_tier="opus"`, `ci_tier="opus"`, `synthesizer_tier="opus"`
  - `performance_tier="sonnet"`, `quality_tier="sonnet"`, `test_coverage_tier="sonnet"`, `chat_tier="sonnet"`
- Remove `eval_finder_provider` and `eval_judge_provider` (vendor-selection settings) — vendor heterogeneity is replaced by **tier** heterogeneity derived from the per-role tier fields above. `eval_f1_threshold` stays.
- Existing validators for `anthropic_api_key` unchanged.

## 5. LLM builders (`llm/`)

- `build_anthropic_llm(api_key: str, tier: Literal["opus", "sonnet"] = "opus") -> ChatAnthropic`: parameterize the model. Keep `temperature=0.1`, `max_tokens=8192`, `timeout=DEFAULT_LLM_TIMEOUT_SECONDS`. A module-level `_TIER_MODEL_IDS = {"opus": "claude-opus-4-8", "sonnet": "claude-sonnet-5"}` maps tier → model. Default `tier="opus"` preserves the current signature's behavior for any existing caller.
- New in `llm/base.py`:
  - `ROLE_TIERS(settings) -> dict[str, str]`: the canonical role→tier map, keys = the nine role names (`security`, `performance`, `quality`, `test_coverage`, `deployment_safety`, `business_logic`, `ci_diagnostics`, `synthesizer`, `chat`), values read from the settings tier fields.
  - `get_llms_by_role(settings) -> dict[str, BaseChatModel]`: builds one Anthropic client **per distinct tier** and returns a role→client dict (roles sharing a tier share one client instance — only 2 clients created). Anthropic-only; does not consult `llm_provider`.
- `get_llm(settings)` is **kept** unchanged (dormant Gemini path still works for anyone who sets `llm_provider=gemini` explicitly), but production/eval no longer call it.

## 6. Production wiring

- `ReviewOrchestrator.__init__(self, llms: dict[str, BaseChatModel])` replaces the single-`llm` constructor. Each of the six review agents, `CIAgent`, and `SynthesizerAgent` is constructed with `llms[<its role key>]`. `CIAgent` uses `llms["ci_diagnostics"]`; the synthesizer uses `llms["synthesizer"]`.
- `server.py` and `cli.py`: replace `get_llm(settings)` with `llms = get_llms_by_role(settings)`; pass `llms` to `ReviewOrchestrator`; build `ChatAgent(llm=llms["chat"])` (its own Sonnet client rather than sharing the orchestrator's).
- `server.py`'s startup error message updates to reference the Anthropic-only requirement (drop the "gemini|anthropic" phrasing that implied a choice; still name `ANTHROPIC_API_KEY`).

## 7. Eval harness (`arete_agents.eval`)

- `runner.build_agents(llms: dict[str, BaseChatModel])` takes the same role→client dict and builds each agent at its production tier (the eval now measures each agent as it actually runs).
- **Judge: cross-tier instead of cross-vendor.** For a candidate comment produced by an agent whose tier is `T`, the judge uses the *opposite* tier (`opus`↔`sonnet`). Because there are exactly two tiers, the opposite is always well-defined. This preserves the anti-agreeableness property (finder and judge are different models) without a second vendor, and is decided **per candidate** using the finder agent's role tier.
- Matcher/CLI:
  - Replace `build_judge(mode, ...)` with a factory that, given `settings` (the tier map) + the finder agent's role, returns an `LLMJudge` on the opposite tier; `stub` mode is retained unchanged for deterministic CI.
  - CLI `--judge` choices become `{dynamic, stub}` (default `dynamic`); `resolve_providers()` and its vendor-heterogeneity logic are removed.
  - `run_all`/`run_fixture` thread the per-role tier through so the matcher can pick the opposite tier for each comment's originating agent.
- The `errors` tracking + `--update-baseline` refusal-on-errors safety (added 2026-07-12) is preserved as-is.

## 8. Verification-before-wiring (risk mitigation)

Only `claude-opus-4-8` is confirmed working in this codebase. The **plan's first task** is a standalone smoke test: one real `ChatAnthropic(model="claude-sonnet-5", ...)` `.invoke()` call, run and confirmed to return content, gated behind an env var / marked so it does not run in the offline unit suite. If the ID is wrong, it surfaces in one cheap call before any wiring. Every downstream task is offline/mocked and must not regress the existing pytest baseline (currently 145 passed + 1 skipped on `main`).

**Live acceptance:** after wiring, one real end-to-end review (or an eval run with a working key) confirms each tier's client instantiates and responds. If no working Anthropic key is available at implementation time, this live step is deferred and recorded (mirrors the eval-harness baseline situation) — the offline suite + smoke test stand as the deterministic proof.

## 9. Deferred: role-content rewrite (Spec 2)

Richer, authoritative role-specific system prompts (modeled on real SQE job roles) and structured per-role reasoning frameworks (OWASP categories for security, complexity-class checks for performance, etc.) are a separate spec. They are independent per-agent content work that should build on this tier infrastructure once settled, and would bloat this spec's review surface.

## 10. Risks & mitigations

- **Unverified Sonnet model ID** → §8 smoke test is the first task; nothing wires to it until it responds.
- **Fast-moving `main`** → implement on a branch off latest `origin/main`; dry-run merge in a throwaway worktree before the real merge; never check out another branch in the primary worktree.
- **Constructor signature change (`ReviewOrchestrator`)** → grep confirms only `server.py:33` and `cli.py:34` construct it; both are updated in the same task. Eval `build_agents` is the only other multi-agent construction site.
- **Cost/latency shift** → moving four roles to Sonnet should *reduce* cost vs all-Opus; Opus is retained only where judgment complexity warrants it.
- **Baseline invalidation** → the committed eval `baseline.json` is already a zero-floor placeholder (no real key), so no real baseline is invalidated by the tier change.
