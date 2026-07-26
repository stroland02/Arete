# Integration Gate Runbook → PR #1 (2026-07-16)

**Purpose:** when the user says "go," execute this verbatim — no improvisation at the
gate. Collects every lane onto `integration`, runs the FULL matrix, drives the real
flow on localhost, opens ONE PR. **Human merges — never the PM.**

**Preconditions (check, don't assume):**
- [ ] Eng1 foundations landed on `stroland02/Engineer-1`: `ModelConnection` +
      `/api/model-connections` route + review-job resolve; `IssueContainer` +
      `loadApprovedContainer` real read (404/`not_found`); durable account↔installation
      ownership rows; security gate (`/api/webhooks/endpoints` cross-tenant fix) present.
- [ ] Eng2 tiered-comms Tasks 1–5 on `feat/wave2-fix-ui` (suite green in their report).
- [ ] Eng3 on `stroland02/Engineer-3`: per-request `/review` model + Ollama provider;
      `tools.py` cli rewire; `AgentStatus` (Task 6).
- [ ] Localhost: Ollama installed + `qwen2.5-coder` pulled (`ollama list`).
- [ ] Working tree clean; dev servers noted (do gate merges in a WORKTREE, never the
      tree a dev server runs from).

## 1. Merge order (dependency-driven, least→most dependent)

Base: `integration` @ `68118aa` (already carries main + P1.1 + Sensorium + glass-box session line).

1. `stroland02/Engineer-1` — db schema + webhook + routes (everything downstream depends on it).
   Run `pnpm --filter @arete/db generate` + migrate dev against local PG before anything else.
2. `feat/approval-exec-worker` — Eng1's worker (P1.3 pair, merge together with 3).
3. `stroland02/Engineer-3` — agents: per-request model, apply/resume, tools rewire, AgentStatus.
4. `feat/orchestration-study` — `packages/orchestration` (if not already inside 5's history).
5. `feat/wave2-fix-ui` — Eng2's dashboard line (driver, SSE, gate UI, AI Models UI, tiered comms).

After each merge: resolve conflicts **in favor of the owning lane** (schema → Eng1,
agents → Eng3, dashboard/orchestration → Eng2); commit the merge before the next.

## 2. Full matrix (all from the worktree root)

```
pnpm install
pnpm -r typecheck        # or per-package tsc where no script exists
pnpm --filter @arete/orchestration test
pnpm --filter @arete/dashboard test
pnpm --filter @arete/webhook test
pnpm --filter @arete/db test      # if present
python -m pytest packages/agents -q
pnpm -r lint             # note pre-existing failures separately; do not fix unrelated lint at the gate
```

ALL suites green (or failures triaged to their owning engineer and fixed) before §3.

## 3. Real-flow drive (localhost, the testable milestone)

1. Point the dev servers at the integration worktree (coordinate with the user — this
   restarts their localhost).
2. Sign in as the REAL tenant (Google, stroland02@gmail.com — see
   memory `connection-reset-root-cause`: dev@arete.local is a stray empty tenant).
3. `/connections` → AI Models → connect **Local · Ollama** → Test passes → Connected badge.
4. Drive one real review on `stroland02/beancount-sandbox` end-to-end through the
   connected model; verify findings post + surface LIVE on `/agents` + `/overview`
   (not the seed — seed/live never mix in a tenant).
5. `/services` → Fix → live Synth stream shows StatusReports + board → approve
   (`ready → solution_approved`, server-enforced 409-if-not-ready) → staged PR view →
   **Send PR** (only now wired end-to-end) → PR opens on the sandbox repo via the App.
6. Logout/login — everything persists (durable ownership rows; the reset bug's regression check).

## 4. Security & integrity spot-checks (gating)

- Adversarial cross-tenant: second user cannot read the first tenant's model
  connections, containers, webhooks (esp. `/api/webhooks/endpoints`).
- No secrets in logs: grep dev-server + agents logs for key/token substrings.
- HITL: driver alone never crosses `ready`; approve endpoint rejects non-ready (409);
  staging rejects unapproved (409) and unknown (404).
- `migrate deploy` from a scratch database succeeds (migration-history repair check).

## 5. Ship

- One PR: `integration` → `main`, body = feature summary + deferred items carried
  verbatim + test evidence. **The human merges.** Nothing pushed before user go.
