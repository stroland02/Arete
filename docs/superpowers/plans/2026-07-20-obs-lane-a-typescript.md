# Observability Lane A — TypeScript (Phase 0 + Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-20-superlog-observability-integration-design.md` (§3 Phase 0/1, §5 conventions FROZEN, §6 security gates, §7 Lane A scope, §8 process). Agent B (Python + infra) runs in parallel on `stroland02/obs-py-infra`; the only shared seams are §5 conventions and `.env.example` env names.

**Goal:** Make the TypeScript services (webhook, worker, dashboard) fully observable — env-driven OTel traces/metrics/logs with redaction enforced in-process, `console.*` eliminated from webhook server code, the `agent_metrics` SSE dark wire lit — on top of trustworthy CI gates (Phase 0).

**Architecture:** A new workspace package `@arete/telemetry` owns the OTel NodeSDK bootstrap (loaded via `--import` before app code), resource builder, pino logger factory with redaction, an in-process span scrubber, and the `arete.*` metric instruments. The webhook package wires it into its two processes (`arete-webhook` server, `arete-worker` BullMQ consumer) with `bullmq-otel` propagating context through Redis; the dashboard gets a thin `@vercel/otel` `instrumentation.ts` plus a health route, sharing only conventions/redaction config.

**Tech Stack (research-pinned 2026-07-20 — do not substitute):**
- `@opentelemetry/api` ^1.9.1; `@opentelemetry/sdk-node` ^0.220.0; `@opentelemetry/sdk-trace-node`, `@opentelemetry/sdk-metrics`, `@opentelemetry/resources` ^2.9.0; `@opentelemetry/sdk-logs` + OTLP HTTP exporters ^0.220.0; `@opentelemetry/auto-instrumentations-node` ^0.78.0; `@opentelemetry/semantic-conventions` ^1.43.0; `import-in-the-middle` ^1.14.0
- SDK 2.x APIs: `resourceFromAttributes()` (NOT `new Resource()`); object-form views (`{ instrumentName, aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries } } }`); `ATTR_*` semconv exports
- `bullmq-otel` ^2.0.0 (`telemetry: new BullMQOtel(...)` on both `Queue` and `Worker`; context propagation automatic)
- `pino` ^10; `@opentelemetry/instrumentation-pino` ^0.66.0 (trace correlation + OTLP log bridge); pino built-in `redact`
- Dashboard: `@vercel/otel` ^2.1.3 in `instrumentation.ts` `register()`; NEVER `auto-instrumentations-node` inside Next
- Tests: vitest 2 (webhook/dashboard/telemetry), `tsx --test` (orchestration/net-guard), pytest via uv (agents)

## Global Constraints (from spec — every task)

- **Branch:** `stroland02/obs-ts`. Each work item: worktree → lane branch → PR into `integration-preview` with CI green + the §8 DoD checklist in the PR body → reviewed merge. `integration-preview` → serving branch at phase boundaries only.
- **DoD checklist (§8, verbatim in every PR body):** tests written first and green (TDD), no skipped/quarantined tests added; per-signal verification evidence pasted (status codes + partial-success check); no new bare `console.*` / `print` in server code; redaction tests updated if the attribute/log surface grew; conventions (§5) followed, cardinality rule checked for any new metric; docs/skills updated if behavior or conventions moved.
- **Conventions §5 are FROZEN** — copy names exactly; changes require a spec amendment:
  - `service.name`: `arete-webhook` | `arete-worker` | `arete-dashboard` | `arete-agents`; plus `service.version`, `deployment.environment.name` (default `development`), `service.instance.id`.
  - Span tree: `review.run` → `review.context.build`, `agent.review` (attr `agent.role`) → `llm.generate` → auto HTTP client spans, `review.synthesize`/`review.critique`, `review.publish`.
  - Metrics: `arete.review.runs` (counter: `outcome`, `trigger`), `arete.review.duration` (histogram), `arete.agent.duration` (histogram: `agent.role`), `gen_ai.client.token.usage` / `gen_ai.client.operation.duration`, `arete.queue.jobs` (counter: `queue`, `outcome`).
- **Cardinality rule (hard):** metric dimensions must be closed low-cardinality sets (role, outcome, provider, model). Repo names, PR numbers, installation ids, SHAs, tenant ids → span attributes only, never metric dimensions. Violation = review-blocking defect.
- **Redaction blocklist (all sinks):** keys `authorization`, `x-api-key`, `api_key`, `token`, `secret`, `password`, `cookie`, `set-cookie`; value patterns: bearer tokens, `sk-`/`ghs_`/`ghp_`-style key shapes, `[?&]key=`/`[?&]api_key=` in URLs. Credentials go in headers, never URLs.
- **Telemetry never crashes the app:** every init wrapped in try/catch, logs exactly one warning, returns a boolean; the service runs without telemetry on failure.
- **No new bare `console.*`** in server code (the single init-failure warning in `@arete/telemetry` is the documented exception).
- **Prompt/completion content NOT captured** (`gen_ai.input.messages`/`output.messages` off).
- **Env seam (shared with Agent B):** `OTEL_EXPORTER_OTLP_ENDPOINT` (**unset ⇒ telemetry is a graceful no-op — never a localhost default**; local stack uses `http://localhost:4318`), `OTEL_SEMCONV_STABILITY_OPT_IN=http/dup,gen_ai_latest_experimental`, `OTEL_SDK_DISABLED`, `DEPLOYMENT_ENVIRONMENT` — defined once in `.env.example`. These semantics are identical in `@arete/telemetry` and `arete_agents/observability.py`.
- **Histogram boundaries** for `arete.review.duration` / `arete.agent.duration`: `[1, 2, 5, 10, 30, 60, 120, 180, 300]` seconds.
- **Verification per signal, every time:** drive one span, one metric batch, one log through the real bootstrap; confirm HTTP 2xx per endpoint (`/v1/traces`, `/v1/logs`, `/v1/metrics`) AND inspect OTLP partial-success payloads.

**Ground-truth notes (read before executing — the code contradicts some spec-era assumptions):**
- `packages/webhook` is **ESM**, not CJS: `"type": "module"` + `module: nodenext` (`packages/webhook/package.json:5`, `tsconfig.json:4-5`). The stale comment at `packages/webhook/src/server.ts:10-13` claims "this package compiles to CJS" — it does not. Init is therefore loaded via `node --import` / `tsx --import`, never `--require`.
- Webhook server and worker are **two processes** (`src/index.ts` vs `src/worker.ts`, started by separate scripts) → two init entry files sharing one `initTelemetry()`; this resolves spec §10's open question.
- Webhook already has `/health` (`src/server.ts:341`); dashboard does not — only the dashboard health route is new.
- Live `console.*` count: 79 in `packages/webhook/src` (78 non-test) + 16 in `packages/dashboard/src` (11 files; 2 are client components which stay) — not the spec's 108; migrate what exists.
- CI (`.github/workflows/ci.yml:3-7`) only triggers on PRs into `main` — lane PRs target `integration-preview`, so Phase 0 must add that branch or no gate runs at all.
- `@arete/net-guard` exports raw `./src/index.ts`; do NOT copy that pattern for `@arete/telemetry` — webhook production runs compiled `dist/` under plain `node`, so telemetry follows `@arete/orchestration`'s built-`dist` pattern.

---

## Task 1 (Phase 0): CI jobs for orchestration, topology, net-guard, db + PR trigger fix

**Files:**
- Modify: `.github/workflows/ci.yml` (trigger block lines 3–7; append job after `test-dashboard`, line 156)

**Interfaces — Produces:** CI job `test-packages` (matrix over the four uncovered packages) gating every PR into `main` and `integration-preview`.

- [ ] **Step 1: Verify each package's gate command passes locally today** (this is the "failing test" for a config task — know the expected green before wiring CI):

```powershell
pnpm install --frozen-lockfile
pnpm --filter @arete/orchestration typecheck; pnpm --filter @arete/orchestration test
pnpm --filter @arete/topology typecheck; pnpm --filter @arete/topology test
pnpm --filter @arete/net-guard typecheck; pnpm --filter @arete/net-guard test
pnpm --filter @arete/db build; pnpm --filter @arete/db lint
```

Expected: all exit 0 (orchestration/net-guard run `tsx --test src/*.test.ts`; topology runs vitest + tsx; db has no tests — its gate is `prisma generate && tsc` + `tsc --noEmit`).

- [ ] **Step 2: Widen the CI triggers** so lane PRs are actually gated. Replace lines 3–7 of `.github/workflows/ci.yml`:

```yaml
on:
  push:
    branches: [main, develop, integration-preview]
  pull_request:
    branches: [main, integration-preview]
```

- [ ] **Step 3: Append the matrix job** at the end of `.github/workflows/ci.yml`:

```yaml
  test-packages:
    name: Package ${{ matrix.package }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - package: orchestration
            filter: "@arete/orchestration"
            commands: "typecheck test"
          - package: topology
            filter: "@arete/topology"
            commands: "typecheck test"
          - package: net-guard
            filter: "@arete/net-guard"
            commands: "typecheck test"
          - package: db
            filter: "@arete/db"
            commands: "build lint"
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run package gates
        run: |
          for cmd in ${{ matrix.commands }}; do
            pnpm --filter ${{ matrix.filter }} run "$cmd"
          done
```

- [ ] **Step 4: Verify the workflow YAML parses:**

```powershell
node -e "const fs=require('fs'); const yaml=require('yaml'); yaml.parse(fs.readFileSync('.github/workflows/ci.yml','utf8')); console.log('ci.yml OK')"
```

(`yaml` is already a webhook dependency and hoisted into the store; run from repo root with `pnpm --filter @arete/webhook exec node -e ...` if root resolution fails.) Expected output: `ci.yml OK`.

- [ ] **Step 5: Commit:**

```powershell
git add .github/workflows/ci.yml
git commit -m "ci: gate orchestration/topology/net-guard/db packages; run CI on integration-preview PRs"
```

---

## Task 2 (Phase 0): Root aggregate test script (one command, TS + Python)

**Files:**
- Modify: `package.json` (root, scripts block lines 5–15)

**Interfaces — Produces:** `pnpm test:all` — runs every workspace package's `test` script plus the Python agents suite via uv.

- [ ] **Step 1: Prove the two halves work independently** (expected: both exit 0; Python needs the same env CI uses):

```powershell
pnpm -r --if-present --workspace-concurrency=1 run test
$env:LLM_PROVIDER='gemini'; $env:GEMINI_API_KEY='test-key-not-real'; uv run --directory packages/agents --extra dev pytest tests/ --ignore=tests/test_e2e_smoke.py
```

- [ ] **Step 2: Add the scripts** to root `package.json` (inside `"scripts"`, after `"test:webhook"`):

```json
    "test:ts": "pnpm -r --if-present --workspace-concurrency=1 run test",
    "test:agents": "uv run --directory packages/agents --extra dev pytest tests/ --ignore=tests/test_e2e_smoke.py",
    "test:all": "pnpm run test:ts && pnpm run test:agents",
```

(`--if-present` skips `@arete/db`, which has no `test` script; `--workspace-concurrency=1` keeps output readable and avoids cross-package port/redis contention. `uv run --directory` sets cwd so `tests/` and `[tool.pytest.ini_options]` in `packages/agents/pyproject.toml` resolve; `--extra dev` supplies pytest per the `[project.optional-dependencies].dev` group.)

- [ ] **Step 3: Run the aggregate** — `pnpm test:all` (with `LLM_PROVIDER=gemini` and `GEMINI_API_KEY=test-key-not-real` exported, mirroring `.github/workflows/ci.yml:32-34`). Expected: every package suite runs, then pytest, overall exit 0.

- [ ] **Step 4: Commit:**

```powershell
git add package.json
git commit -m "build: root test:all aggregate (all TS packages + Python agents via uv)"
```

---

## Task 3 (Phase 0): ESLint flat config for packages/webhook

**Files:**
- Create: `packages/webhook/eslint.config.mjs`
- Modify: `packages/webhook/package.json` (scripts.lint line 12; devDependencies lines 28–36)

**Interfaces — Produces:** `pnpm --filter @arete/webhook lint` = real ESLint + `tsc --noEmit`. Rule `no-console: warn` now (79 existing sites); Task 13 flips it to `error` after the pino migration — the ratchet.

- [ ] **Step 1: Add devDependencies** to `packages/webhook/package.json`:

```json
    "@eslint/js": "^9.0.0",
    "eslint": "^9.0.0",
    "typescript-eslint": "^8.0.0",
```

and change the lint script (currently `"lint": "tsc --noEmit"`):

```json
    "lint": "eslint src && tsc --noEmit",
```

Then `pnpm install`.

- [ ] **Step 2: Write the failing check** — run `pnpm --filter @arete/webhook lint`. Expected failure: `Could not find config file` (eslint.config.mjs does not exist yet).

- [ ] **Step 3: Create `packages/webhook/eslint.config.mjs`:**

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      // Ratchet: 'warn' until the pino migration lands (obs plan Task 13
      // flips this to 'error'). Spec §8 DoD: no NEW bare console.* — new
      // warnings are review-blocking even while old ones burn down.
      'no-console': 'warn',
      // Pre-existing codebase style: Octokit payloads are cast via `any`
      // at the boundary (see server.ts). Not this initiative's fight.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'error',
    },
  },
  {
    files: ['src/**/*.test.ts'],
    rules: {
      'no-console': 'off',
    },
  },
)
```

- [ ] **Step 4: Run again** — `pnpm --filter @arete/webhook lint`. Expected: exits 0 with ~78 `no-console` warnings and zero errors. If any *errors* surface (e.g. genuine unused vars), fix them minimally in this task — the gate must end green.

- [ ] **Step 5: Commit:**

```powershell
git add packages/webhook/eslint.config.mjs packages/webhook/package.json pnpm-lock.yaml
git commit -m "chore(webhook): real ESLint flat config (no-console ratchet at warn)"
```

---

## Task 4 (Phase 0): De-flake pipeline.integration.test.ts (shared-mock order dependence)

**Files:**
- Modify: `packages/webhook/src/pipeline.integration.test.ts` (buildApp lines 213–284, afterEach lines 305–308, last two tests lines 604–658)

**Root cause (from reading the file):** the final two tests register `vi.doMock('./telemetry/fetch-telemetry-context.js')` (line 610) and `vi.doMock('./review-bridge.js')` (lines 619, 642) *outside* `buildApp`. `vi.resetModules()` clears the module cache but NOT the doMock registry, so these mocks leak into any test that runs after them — the file only passes because of the "Keep this test LAST" comment (lines 608–611). Any shuffled/parallel/reordered execution (or a future test appended below) flakes. Fix: `buildApp` owns the complete mock registry every time, with per-test overrides; nothing depends on order.

- [ ] **Step 1: Write the failing repro** — prove order dependence:

```powershell
pnpm --filter @arete/webhook exec vitest run src/pipeline.integration.test.ts --sequence.shuffle.tests=true --sequence.seed=1
pnpm --filter @arete/webhook exec vitest run src/pipeline.integration.test.ts --sequence.shuffle.tests=true --sequence.seed=2
pnpm --filter @arete/webhook exec vitest run src/pipeline.integration.test.ts --sequence.shuffle.tests=true --sequence.seed=3
```

Expected failure: at least one seed orders the telemetry-mock test before a full-pipeline test, which then sees the mocked `runReviewPipeline`/`fetchTelemetryContext` and fails its FastAPI/octokit assertions.

- [ ] **Step 2: Make buildApp own the whole registry.** Change the `buildApp` signature and add the two mock registrations at its top (immediately after `vi.resetModules()` at line 214):

```ts
type BuildOverrides = {
  /** When set, ./telemetry/fetch-telemetry-context.js resolves to this fixed value. */
  telemetryContext?: unknown[]
  /** When set, ./review-bridge.js runReviewPipeline is replaced by this mock. */
  runReviewPipeline?: ReturnType<typeof vi.fn>
}

async function buildApp(mocks: Mocks, overrides: BuildOverrides = {}): Promise<Application> {
  vi.resetModules()

  // EVERY module this file ever mocks is (re-)registered or explicitly
  // un-mocked here, unconditionally — vi.resetModules() clears the module
  // cache but not the doMock registry, so anything registered outside this
  // function would leak into later tests and make the file order-dependent.
  if (overrides.telemetryContext !== undefined) {
    const telemetryContext = overrides.telemetryContext
    vi.doMock('./telemetry/fetch-telemetry-context.js', () => ({
      fetchTelemetryContext: vi.fn().mockResolvedValue(telemetryContext),
    }))
  } else {
    vi.doUnmock('./telemetry/fetch-telemetry-context.js')
  }
  if (overrides.runReviewPipeline !== undefined) {
    const runReviewPipeline = overrides.runReviewPipeline
    vi.doMock('./review-bridge.js', () => ({ runReviewPipeline }))
  } else {
    vi.doUnmock('./review-bridge.js')
  }
```

(the rest of the existing body — the `@octokit/app`, `@octokit/webhooks`, `@arete/db`, `./queue.js`, `./github-auth.js` doMocks and `vi.stubGlobal('fetch', ...)` — is unchanged below this).

- [ ] **Step 3: Harden afterEach** (replace lines 305–308):

```ts
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('./telemetry/fetch-telemetry-context.js')
    vi.doUnmock('./review-bridge.js')
    vi.resetModules()
  })
```

- [ ] **Step 4: Convert the two order-sensitive tests.** In the telemetry-context test (line 604): delete the two standalone `vi.doMock(...)` blocks and the "Keep this test LAST" comment (lines 605–620), and build via overrides instead:

```ts
  it('fetches telemetry context and includes it in the PRContext sent to the Python pipeline', async () => {
    const runReviewPipelineMock = vi.fn().mockResolvedValue({
      pr_context: {}, file_reviews: [], overall_summary: 'ok', risk_level: 'low', total_comments: 0,
    })
    await buildApp(mocks, {
      telemetryContext: [
        { provider: 'github_actions', source_ref: 'acme/api', summary_text: 'ok', metrics: {}, links: [], fetched_at: '2026-07-10T00:00:00Z' },
      ],
      runReviewPipeline: runReviewPipelineMock,
    })

    const { processReviewJob } = await import('./worker.js')
    await processReviewJob({
      provider: 'github', kind: 'pull_request', owner: 'acme', repo: 'api',
      repositoryExternalId: 1, fullName: 'acme/api', installationId: 42, prNumber: 1, headSha: 'abc',
    })

    const sentContext = runReviewPipelineMock.mock.calls[0][0]
    expect(sentContext.telemetry).toEqual([
      { provider: 'github_actions', source_ref: 'acme/api', summary_text: 'ok', metrics: {}, links: [], fetched_at: '2026-07-10T00:00:00Z' },
    ])
  })
```

In the project-memories test (line 638): delete its standalone `vi.doMock('./review-bridge.js', ...)` and change `await buildApp(mocks)` to `await buildApp(mocks, { runReviewPipeline: runReviewPipelineMock })` (keep the local `runReviewPipelineMock` declaration).

- [ ] **Step 5: Run the repro matrix again** (same three seeded shuffle commands as Step 1) plus the plain run `pnpm --filter @arete/webhook test`. Expected: all green on every seed. No test is quarantined; no `.skip` added.

- [ ] **Step 6: Commit:**

```powershell
git add packages/webhook/src/pipeline.integration.test.ts
git commit -m "test(webhook): de-flake pipeline integration suite - buildApp owns the full mock registry, no order dependence"
```

---

## Task 5 (Phase 1): Scaffold @arete/telemetry + redaction core (TDD)

**Files:**
- Create: `packages/telemetry/package.json`, `packages/telemetry/tsconfig.json`, `packages/telemetry/tsconfig.build.json`, `packages/telemetry/vitest.config.ts`
- Create: `packages/telemetry/src/redaction.ts`, `packages/telemetry/src/redaction.test.ts`, `packages/telemetry/src/index.ts`

**Interfaces — Produces (consumed by Tasks 6–14):**
- `REDACT_KEYS: readonly string[]` — §5 key blocklist
- `SECRET_VALUE_PATTERNS: RegExp[]` — §5 value patterns
- `scrubText(text: string): string` — replaces secret-shaped values with `[REDACTED]`
- `stripUrlQuery(url: string): string` — drops the entire query string
- `PINO_REDACT_PATHS: string[]` — pino `redact.paths`

- [ ] **Step 1: Create the package skeleton.** `packages/telemetry/package.json` (dist-built like `@arete/orchestration`, NOT raw-src like net-guard — webhook prod runs plain `node dist/`):

```json
{
  "name": "@arete/telemetry",
  "version": "0.1.0",
  "private": true,
  "license": "Apache-2.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./logger": { "types": "./dist/logger.d.ts", "default": "./dist/logger.js" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "prepare": "pnpm run build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@opentelemetry/api": "^1.9.1",
    "@opentelemetry/auto-instrumentations-node": "^0.78.0",
    "@opentelemetry/exporter-logs-otlp-http": "^0.220.0",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.220.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.220.0",
    "@opentelemetry/instrumentation-pino": "^0.66.0",
    "@opentelemetry/resources": "^2.9.0",
    "@opentelemetry/sdk-logs": "^0.220.0",
    "@opentelemetry/sdk-metrics": "^2.9.0",
    "@opentelemetry/sdk-node": "^0.220.0",
    "@opentelemetry/sdk-trace-node": "^2.9.0",
    "@opentelemetry/semantic-conventions": "^1.43.0",
    "import-in-the-middle": "^1.14.0",
    "pino": "^10.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.1",
    "typescript": "^5.7.2",
    "vitest": "^2.1.9"
  }
}
```

`packages/telemetry/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`packages/telemetry/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

`packages/telemetry/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
})
```

Then `pnpm install` (pnpm-workspace.yaml already globs `packages/*`).

- [ ] **Step 2: Write the failing test** — `packages/telemetry/src/redaction.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { scrubText, stripUrlQuery, REDACT_KEYS, PINO_REDACT_PATHS } from './redaction.js'

// Fake canary secrets — never real values.
const CANARIES = [
  'Bearer ghs_FakeCanary1234567890abcdefghij',
  'sk-ant-canary00000000000000000000',
  'ghp_FakeCanary1234567890abcdefghij',
  'glpat-FakeCanary123456789',
  'whsec_FakeCanary1234567890',
]

describe('scrubText', () => {
  it.each(CANARIES)('redacts %s', (canary) => {
    const out = scrubText(`request failed: ${canary} while calling api`)
    expect(out).not.toContain(canary.split(' ').pop())
    expect(out).toContain('[REDACTED]')
  })

  it('redacts key-shaped query params but keeps the param name', () => {
    const out = scrubText('GET https://api.example.com/v1/models?key=AIzaFakeCanary123&x=1 failed')
    expect(out).not.toContain('AIzaFakeCanary123')
    expect(out).toContain('key=[REDACTED]')
  })

  it('leaves clean text untouched', () => {
    const text = 'reviewed acme/api#42 with 3 comments'
    expect(scrubText(text)).toBe(text)
  })
})

describe('stripUrlQuery', () => {
  it('strips the entire query string', () => {
    expect(stripUrlQuery('https://api.example.com/v1/generate?key=secret123&b=2'))
      .toBe('https://api.example.com/v1/generate')
  })
  it('returns non-URL input unchanged when it has no query separator', () => {
    expect(stripUrlQuery('not a url')).toBe('not a url')
  })
})

describe('blocklist completeness (spec §5 — frozen)', () => {
  it.each(['authorization', 'x-api-key', 'api_key', 'token', 'secret', 'password', 'cookie', 'set-cookie'])(
    'REDACT_KEYS contains %s', (key) => {
      expect(REDACT_KEYS).toContain(key)
    })
  it('pino paths cover nested headers for every key', () => {
    expect(PINO_REDACT_PATHS).toContain('req.headers.authorization')
    expect(PINO_REDACT_PATHS).toContain('req.headers["x-api-key"]')
    expect(PINO_REDACT_PATHS).toContain('*.installationToken')
  })
})
```

- [ ] **Step 3: Run it** — `pnpm --filter @arete/telemetry test`. Expected failure: `Cannot find module './redaction.js'`.

- [ ] **Step 4: Implement** `packages/telemetry/src/redaction.ts`:

```ts
/**
 * Redaction core — spec §5 blocklist, FROZEN. Shared by the pino logger
 * factory (log-creation time), the span scrubber (export time), and — by
 * convention only — Agent B's structlog censor and the collector redaction
 * processor. Changing keys/patterns requires a spec amendment.
 */

export const REDACT_KEYS = [
  'authorization',
  'x-api-key',
  'api_key',
  'apikey',
  'token',
  'secret',
  'password',
  'cookie',
  'set-cookie',
] as const

/**
 * Value-shape patterns (spec §5): bearer tokens, provider key shapes
 * (sk-*, gh?_*, glpat-*, whsec_*), and key-ish URL query params.
 * The query-param pattern keeps the `name=` prefix (capture group 1) so
 * scrubbed URLs stay debuggable.
 */
export const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bglpat-[A-Za-z0-9_-]{10,}/g,
  /\bwhsec_[A-Za-z0-9]{10,}/g,
  /([?&](?:key|api_key|apikey|token|access_token|client_secret)=)[^&\s'"]+/gi,
]

export const REDACTED = '[REDACTED]'

/** Replace every secret-shaped substring with [REDACTED]. Idempotent. */
export function scrubText(text: string): string {
  let out = text
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, (match, prefix?: string) =>
      typeof prefix === 'string' ? `${prefix}${REDACTED}` : REDACTED
    )
  }
  return out
}

/** Drop the entire query string from a URL-ish string (spec §5: query strings
 *  never reach span attributes — credentials-in-URLs are audited, not assumed). */
export function stripUrlQuery(url: string): string {
  const i = url.indexOf('?')
  return i === -1 ? url : url.slice(0, i)
}

/** pino redact.paths — key blocklist at top level, one wildcard level deep,
 *  and under req/res headers. `installationToken` is Areté-specific: PRContext
 *  carries a live GitHub App installation token (worker.ts buildCloneContext). */
export const PINO_REDACT_PATHS: string[] = [
  ...REDACT_KEYS.flatMap((k) => {
    const seg = /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `["${k}"]`
    const top = seg.startsWith('.') ? seg.slice(1) : seg
    return [top, `*${seg}`, `req.headers${seg}`, `res.headers${seg}`, `headers${seg}`]
  }),
  'apiKey', '*.apiKey',
  'privateKey', '*.privateKey',
  'installationToken', '*.installationToken',
  'webhookSecret', '*.webhookSecret',
]
```

and `packages/telemetry/src/index.ts` (grows in later tasks):

```ts
export {
  REDACT_KEYS,
  SECRET_VALUE_PATTERNS,
  REDACTED,
  scrubText,
  stripUrlQuery,
  PINO_REDACT_PATHS,
} from './redaction.js'
```

- [ ] **Step 5: Run again** — `pnpm --filter @arete/telemetry test` → all green; `pnpm --filter @arete/telemetry build` → emits `dist/`.

- [ ] **Step 6: Commit:**

```powershell
git add packages/telemetry pnpm-lock.yaml
git commit -m "feat(telemetry): scaffold @arete/telemetry with frozen redaction blocklist + scrubbers (TDD)"
```

---

## Task 6 (Phase 1): In-process span scrubber + TS canary scrub test (spec §6 gate 2)

**Files:**
- Create: `packages/telemetry/src/scrub-processor.ts`
- Create: `packages/telemetry/src/scrub-processor.test.ts` (this IS the CI canary scrub test for the TS side)
- Modify: `packages/telemetry/src/index.ts`

**Interfaces — Produces:** `class ScrubbingSpanProcessor implements SpanProcessor` — registered BEFORE the batch exporter processor in Task 7 so every exported span is already scrubbed. Strips URL query strings on `http.url`/`url.full`, redacts blocklisted attribute keys, scans every string attribute, exception events, and span status messages for secret patterns.

- [ ] **Step 1: Write the failing canary test** — `packages/telemetry/src/scrub-processor.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NodeTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } from '@opentelemetry/sdk-trace-node'
import { ScrubbingSpanProcessor } from './scrub-processor.js'

// Fake canary secret — the §6 gate: injected into a span attribute, a URL
// query string, and a thrown exception; must NEVER reach the exporter.
const CANARY = 'sk-canary-a1b2c3d4e5f6g7h8'

describe('ScrubbingSpanProcessor (canary scrub test — spec §6 gate 2)', () => {
  let exporter: InMemorySpanExporter
  let provider: NodeTracerProvider

  beforeEach(() => {
    exporter = new InMemorySpanExporter()
    provider = new NodeTracerProvider({
      spanProcessors: [
        new ScrubbingSpanProcessor(),          // runs first: mutates on end
        new SimpleSpanProcessor(exporter),     // then exports the scrubbed span
      ],
    })
  })

  afterEach(async () => {
    await provider.shutdown()
  })

  it('a secret in a span attribute, a URL query, and a thrown error never reaches the exporter', () => {
    const tracer = provider.getTracer('canary')
    const span = tracer.startSpan('llm.generate')
    span.setAttribute('http.url', `https://generativelanguage.googleapis.com/v1/models?key=${CANARY}`)
    span.setAttribute('url.full', `https://api.example.com/v1/chat?api_key=${CANARY}`)
    span.setAttribute('arete.debug.note', `failed with Bearer ${CANARY}`)
    span.setAttribute('authorization', `Bearer ${CANARY}`)
    span.recordException(new Error(`401 from provider: key ${CANARY} rejected`))
    span.setStatus({ code: 2, message: `request with ${CANARY} failed` })
    span.end()

    const exported = exporter.getFinishedSpans()
    expect(exported).toHaveLength(1)
    const serialized = JSON.stringify(exported, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    expect(serialized).not.toContain(CANARY)

    const attrs = exported[0].attributes
    // Query strings stripped entirely on url attributes (spec §5)
    expect(attrs['http.url']).toBe('https://generativelanguage.googleapis.com/v1/models')
    expect(attrs['url.full']).toBe('https://api.example.com/v1/chat')
    // Blocklisted key fully redacted
    expect(attrs['authorization']).toBe('[REDACTED]')
    // Free-text attribute pattern-scrubbed, message retained
    expect(attrs['arete.debug.note']).toContain('[REDACTED]')
  })

  it('leaves clean spans untouched', () => {
    const tracer = provider.getTracer('canary')
    const span = tracer.startSpan('review.run')
    span.setAttribute('arete.repo.full_name', 'acme/api')
    span.setAttribute('arete.pr.number', 42)
    span.end()
    const [exported] = exporter.getFinishedSpans()
    expect(exported.attributes['arete.repo.full_name']).toBe('acme/api')
    expect(exported.attributes['arete.pr.number']).toBe(42)
  })
})
```

- [ ] **Step 2: Run it** — `pnpm --filter @arete/telemetry test src/scrub-processor.test.ts`. Expected failure: `Cannot find module './scrub-processor.js'`.

- [ ] **Step 3: Implement** `packages/telemetry/src/scrub-processor.ts`:

```ts
import type { Context } from '@opentelemetry/api'
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-node'
import { REDACT_KEYS, REDACTED, scrubText, stripUrlQuery } from './redaction.js'

const URL_ATTRIBUTES = new Set(['http.url', 'url.full', 'http.target', 'url.path'])
const BLOCKED_KEY_SET = new Set<string>(REDACT_KEYS)

function isBlockedKey(key: string): boolean {
  const lower = key.toLowerCase()
  if (BLOCKED_KEY_SET.has(lower)) return true
  // Matches http.request.header.authorization, arete.config.api_key, etc.
  return [...BLOCKED_KEY_SET].some((k) => lower.endsWith(`.${k}`) || lower.endsWith(`_${k}`))
}

/**
 * In-process span scrubber (spec §5 redaction, §6 gate 2). Registered BEFORE
 * the exporting BatchSpanProcessor, so its onEnd mutation is visible to the
 * exporter. Defense-in-depth with the collector's redaction processor
 * (Agent B) — this one guarantees secrets never even leave the process.
 */
export class ScrubbingSpanProcessor implements SpanProcessor {
  onStart(_span: Span, _parentContext: Context): void {}

  onEnd(span: ReadableSpan): void {
    const attrs = span.attributes as Record<string, unknown>
    for (const key of Object.keys(attrs)) {
      const value = attrs[key]
      if (isBlockedKey(key)) {
        attrs[key] = REDACTED
        continue
      }
      if (typeof value !== 'string') continue
      if (URL_ATTRIBUTES.has(key)) {
        attrs[key] = stripUrlQuery(value)
        continue
      }
      attrs[key] = scrubText(value)
    }

    for (const event of span.events) {
      const eventAttrs = event.attributes as Record<string, unknown> | undefined
      if (!eventAttrs) continue
      for (const key of Object.keys(eventAttrs)) {
        const value = eventAttrs[key]
        if (typeof value === 'string') eventAttrs[key] = scrubText(value)
      }
    }

    if (span.status.message) {
      ;(span.status as { message?: string }).message = scrubText(span.status.message)
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve()
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}
```

Append to `packages/telemetry/src/index.ts`:

```ts
export { ScrubbingSpanProcessor } from './scrub-processor.js'
```

- [ ] **Step 4: Run again** — `pnpm --filter @arete/telemetry test` → green (redaction + scrub-processor suites).

- [ ] **Step 5: Commit:**

```powershell
git add packages/telemetry/src
git commit -m "feat(telemetry): in-process span scrubber + canary scrub test (secrets never reach the exporter)"
```

---

## Task 7 (Phase 1): Resource builder + env-driven NodeSDK init (never crashes) + views

**Files:**
- Create: `packages/telemetry/src/resource.ts`, `packages/telemetry/src/init.ts`, `packages/telemetry/src/init.test.ts`
- Modify: `packages/telemetry/src/index.ts`

**Interfaces — Produces:**
- `buildResource(serviceName: AreteServiceName, serviceVersion: string): Resource` — §5 resource attrs
- `initTelemetry(serviceName: AreteServiceName, serviceVersion?: string): boolean` — env-driven, idempotent, try/catch-wrapped, one warning on failure, returns whether telemetry is live
- `shutdownTelemetry(): Promise<void>`
- `registerEsmHook(): void` — import-in-the-middle loader registration for pure-ESM libs (@octokit/*)
- `DURATION_HISTOGRAM_BOUNDARIES: number[]`
- `type AreteServiceName = 'arete-webhook' | 'arete-worker' | 'arete-dashboard'`

- [ ] **Step 1: Write the failing test** — `packages/telemetry/src/init.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { buildResource } from './resource.js'
import { initTelemetry, shutdownTelemetry, DURATION_HISTOGRAM_BOUNDARIES } from './init.js'

describe('buildResource (§5 resource attributes)', () => {
  it('stamps the four frozen resource attributes', () => {
    const resource = buildResource('arete-worker', '0.1.0')
    expect(resource.attributes[ATTR_SERVICE_NAME]).toBe('arete-worker')
    expect(resource.attributes[ATTR_SERVICE_VERSION]).toBe('0.1.0')
    expect(resource.attributes['deployment.environment.name']).toBe('development')
    expect(resource.attributes['service.instance.id']).toBeTruthy()
  })

  it('deployment.environment.name honors the env override', () => {
    vi.stubEnv('DEPLOYMENT_ENVIRONMENT', 'production')
    const resource = buildResource('arete-webhook', '0.1.0')
    expect(resource.attributes['deployment.environment.name']).toBe('production')
    vi.unstubAllEnvs()
  })
})

describe('initTelemetry (never crashes the app — spec §3)', () => {
  afterEach(async () => {
    await shutdownTelemetry()
    vi.unstubAllEnvs()
  })

  it('returns false and does not throw when OTEL_SDK_DISABLED=true', () => {
    vi.stubEnv('OTEL_SDK_DISABLED', 'true')
    expect(initTelemetry('arete-webhook')).toBe(false)
  })

  // Shared seam with Lane B: unset endpoint => graceful no-op, NOT a
  // localhost default. Exporting at a collector that isn't running makes
  // every dev/CI run retry and log. Both lanes must agree here.
  it('returns false when OTEL_EXPORTER_OTLP_ENDPOINT is unset', () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '')
    expect(initTelemetry('arete-webhook')).toBe(false)
  })

  it('does not throw even with a garbage endpoint; second call is an idempotent no-op', () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:1')
    let result: boolean | undefined
    expect(() => { result = initTelemetry('arete-webhook') }).not.toThrow()
    expect(typeof result).toBe('boolean')
    expect(initTelemetry('arete-webhook')).toBe(result)
  })

  it('defaults OTEL_SEMCONV_STABILITY_OPT_IN to http/dup', () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:1')
    initTelemetry('arete-webhook')
    expect(process.env.OTEL_SEMCONV_STABILITY_OPT_IN).toBe('http/dup')
  })
})

describe('histogram boundaries (§5 — 300s ceiling)', () => {
  it('is the frozen 9-bucket list', () => {
    expect(DURATION_HISTOGRAM_BOUNDARIES).toEqual([1, 2, 5, 10, 30, 60, 120, 180, 300])
  })
})
```

- [ ] **Step 2: Run it** — `pnpm --filter @arete/telemetry test src/init.test.ts`. Expected failure: modules not found.

- [ ] **Step 3: Implement** `packages/telemetry/src/resource.ts`:

```ts
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { defaultResource, resourceFromAttributes, type Resource } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

/** §5 frozen service names (Lane A's three; arete-agents is Agent B's). */
export type AreteServiceName = 'arete-webhook' | 'arete-worker' | 'arete-dashboard'

/** SDK 2.x: resourceFromAttributes(), NOT `new Resource()` (removed API). */
export function buildResource(serviceName: AreteServiceName, serviceVersion: string): Resource {
  return defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      // production ONLY when explicitly set (spec §5)
      'deployment.environment.name': process.env.DEPLOYMENT_ENVIRONMENT ?? 'development',
      'service.instance.id':
        process.env.SERVICE_INSTANCE_ID ?? `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`,
    })
  )
}
```

and `packages/telemetry/src/init.ts`:

```ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node'
import { PeriodicExportingMetricReader, AggregationType } from '@opentelemetry/sdk-metrics'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { buildResource, type AreteServiceName } from './resource.js'
import { ScrubbingSpanProcessor } from './scrub-processor.js'

/** §5 frozen: review/agent durations bucketed up to 300 s — the default 10 s
 *  ceiling silently corrupts p95/p99 exactly where LLM latency lives. */
export const DURATION_HISTOGRAM_BOUNDARIES = [1, 2, 5, 10, 30, 60, 120, 180, 300]

let sdk: NodeSDK | null = null
let started = false

/**
 * Env-driven OTel bootstrap. Loaded from a dedicated init file via
 * `node --import` / `tsx --import` BEFORE any app code (ESM; --require is
 * for CJS builds and does not apply here — webhook is "type": "module").
 *
 * MUST NEVER take the app down (spec §3): fully try/catch-wrapped, logs
 * exactly one warning on failure, returns whether telemetry is live.
 */
export function initTelemetry(serviceName: AreteServiceName, serviceVersion = '0.1.0'): boolean {
  if (started) return sdk !== null
  started = true
  if (process.env.OTEL_SDK_DISABLED === 'true') return false
  try {
    // JS SDK emits legacy http semconv until v3; http/dup bridges (spec §4).
    process.env.OTEL_SEMCONV_STABILITY_OPT_IN ??= 'http/dup'
    // Shared seam with Lane B (arete_agents/observability.py): unset endpoint
    // is a graceful no-op, never a localhost default.
    const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim().replace(/\/$/, '')
    if (!endpoint) {
      console.warn('[telemetry] OTEL_EXPORTER_OTLP_ENDPOINT is not set; running without telemetry')
      return false
    }

    sdk = new NodeSDK({
      resource: buildResource(serviceName, serviceVersion),
      spanProcessors: [
        new ScrubbingSpanProcessor(), // scrub BEFORE export — order matters
        new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })),
      ],
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        exportIntervalMillis: 10_000,
      }),
      logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter({ url: `${endpoint}/v1/logs` }))],
      views: [
        {
          instrumentName: 'arete.review.duration',
          aggregation: {
            type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
            options: { boundaries: DURATION_HISTOGRAM_BOUNDARIES },
          },
        },
        {
          instrumentName: 'arete.agent.duration',
          aggregation: {
            type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
            options: { boundaries: DURATION_HISTOGRAM_BOUNDARIES },
          },
        },
      ],
      instrumentations: [
        getNodeAutoInstrumentations({
          // fs spans are pure noise for a webhook service
          '@opentelemetry/instrumentation-fs': { enabled: false },
          // ioredis: suppress BullMQ blocking-poll noise (spec §4) — brpoplpush
          // etc. produce a span per poll tick otherwise.
          '@opentelemetry/instrumentation-ioredis': {
            requireParentSpan: true,
          },
          // pino: trace_id/span_id stamping + OTLP log bridge
          '@opentelemetry/instrumentation-pino': { enabled: true },
        }),
      ],
    })
    sdk.start()
    return true
  } catch (err) {
    sdk = null
    // The ONE permitted bare console call (spec §3: "failure logs one warning
    // and the service runs without telemetry").
    console.warn(`[telemetry] init failed — running without telemetry: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

export async function shutdownTelemetry(): Promise<void> {
  const s = sdk
  sdk = null
  started = false
  if (!s) return
  try {
    await s.shutdown()
  } catch {
    // shutdown failures are never fatal
  }
}

/**
 * Registers the import-in-the-middle ESM loader hook so pure-ESM packages
 * (@octokit/*) can be instrumented. CJS deps (express, ioredis, pino, bullmq)
 * are patched via require-in-the-middle regardless. Call this FIRST in the
 * boot file, before initTelemetry. Safe no-op on failure.
 */
export function registerEsmHook(): void {
  try {
    // Dynamic to avoid a hard crash on very old Node without module.register.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { register } = require('node:module') as typeof import('node:module')
    register('import-in-the-middle/hook.mjs', import.meta.url)
  } catch {
    // Hook unavailable — manual spans and CJS auto-instrumentation still work.
  }
}
```

Append to `packages/telemetry/src/index.ts`:

```ts
export { buildResource, type AreteServiceName } from './resource.js'
export {
  initTelemetry,
  shutdownTelemetry,
  registerEsmHook,
  DURATION_HISTOGRAM_BOUNDARIES,
} from './init.js'
```

(Note: `require('node:module')` inside an ESM file fails under vitest/node — replace with the top-of-file static form if the test complains: `import { register } from 'node:module'` and call `register('import-in-the-middle/hook.mjs', import.meta.url)` inside the try/catch. Prefer the static import; it is available on Node ≥ 20.6, and this repo's CI runs Node 22.)

- [ ] **Step 4: Run again** — `pnpm --filter @arete/telemetry test` → green; `pnpm --filter @arete/telemetry build` → clean.

- [ ] **Step 5: Commit:**

```powershell
git add packages/telemetry/src
git commit -m "feat(telemetry): env-driven NodeSDK init (never crashes), §5 resource attrs, 300s histogram views"
```

---

## Task 8 (Phase 1): Pino logger factory with redaction + component field

**Files:**
- Create: `packages/telemetry/src/logger.ts`, `packages/telemetry/src/logger.test.ts`
- Modify: `packages/telemetry/src/index.ts`

**Interfaces — Produces:**
- `createLogger(service: string, opts?: { level?: string; destination?: pino.DestinationStream }): pino.Logger` — redact-configured; callers derive per-module loggers via `logger.child({ component })` (the `[tag]` → `component` mapping, spec §10 resolved here). Trace correlation (`trace_id`/`span_id`) and OTLP shipping come from `@opentelemetry/instrumentation-pino`, activated by Task 7's init — verified live in Task 15.

- [ ] **Step 1: Write the failing test** — `packages/telemetry/src/logger.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Writable } from 'node:stream'
import { createLogger } from './logger.js'

const CANARY = 'ghs_FakeLogCanary1234567890abcdef'

function collect(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk))
      cb()
    },
  })
  return { stream, lines: () => chunks.join('').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) }
}

describe('createLogger (canary scrub — log sink, spec §6 gate 2)', () => {
  it('redacts blocklisted keys at every level', () => {
    const { stream, lines } = collect()
    const log = createLogger('webhook', { destination: stream })
    log.info(
      {
        authorization: `Bearer ${CANARY}`,
        installationToken: CANARY,
        req: { headers: { 'x-api-key': CANARY, cookie: `session=${CANARY}` } },
        nested: { token: CANARY },
      },
      'boot'
    )
    const [line] = lines()
    const raw = JSON.stringify(line)
    expect(raw).not.toContain(CANARY)
    expect(line.authorization).toBe('[REDACTED]')
  })

  it('stamps service and passes structured component through child()', () => {
    const { stream, lines } = collect()
    const log = createLogger('webhook', { destination: stream }).child({ component: 'worker' })
    log.info({ prNumber: 42 }, 'posted review')
    const [line] = lines()
    expect(line.service).toBe('webhook')
    expect(line.component).toBe('worker')
    expect(line.prNumber).toBe(42)
    expect(line.msg).toBe('posted review')
  })
})
```

- [ ] **Step 2: Run it** — `pnpm --filter @arete/telemetry test src/logger.test.ts`. Expected failure: `Cannot find module './logger.js'`.

- [ ] **Step 3: Implement** `packages/telemetry/src/logger.ts`:

```ts
import { pino } from 'pino'
import { PINO_REDACT_PATHS, REDACTED } from './redaction.js'

export interface CreateLoggerOptions {
  level?: string
  /** Test seam: capture output in-memory. Defaults to stdout. */
  destination?: pino.DestinationStream
}

/**
 * Structured logger factory (spec §3: "Real libraries: pino"). Redaction is
 * applied at log-creation time — secrets never reach ANY sink (console, file,
 * or the OTLP bridge). trace_id/span_id stamping + OTLP log shipping are
 * added transparently by @opentelemetry/instrumentation-pino when
 * initTelemetry() ran in this process; without it this is a plain JSON
 * console logger (telemetry-off degradation, never a crash).
 *
 * Convention (§5 / §10): the old `[tag]` console prefixes become a structured
 * `component` field — always derive per-module loggers via
 * `logger.child({ component: 'worker' })`.
 */
export function createLogger(service: string, opts: CreateLoggerOptions = {}): pino.Logger {
  const options: pino.LoggerOptions = {
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    base: { service },
    redact: { paths: [...PINO_REDACT_PATHS], censor: REDACTED },
    timestamp: pino.stdTimeFunctions.isoTime,
  }
  return opts.destination ? pino(options, opts.destination) : pino(options)
}
```

Append to `packages/telemetry/src/index.ts`:

```ts
export { createLogger, type CreateLoggerOptions } from './logger.js'
```

- [ ] **Step 4: Run again** — `pnpm --filter @arete/telemetry test` → green (all four suites). Then full gate: `pnpm --filter @arete/telemetry build`.

- [ ] **Step 5: Commit:**

```powershell
git add packages/telemetry/src
git commit -m "feat(telemetry): pino factory - redact-at-creation, service base, component-field convention"
```

---

## Task 9 (Phase 1): Webhook + worker boot wiring (--import init before app code)

**Files:**
- Create: `packages/webhook/src/otel.ts` (server init), `packages/webhook/src/otel-worker.ts` (worker init)
- Modify: `packages/webhook/package.json` (scripts lines 6–13, dependencies lines 14–27)
- Modify: `.github/workflows/ci.yml` (webhook smoke-test step, line ~91)
- Modify: `.env.example` (append OTel block — the §7 shared seam; coordinate wording with Agent B, values are frozen in §5)

**Interfaces — Consumes:** `registerEsmHook`, `initTelemetry` from `@arete/telemetry`. **Produces:** two boot files; `service.name` split `arete-webhook`/`arete-worker` via separate entry files (no env juggling — resolves spec §10's open question: two processes, two inits, one shared SDK module).

- [ ] **Step 1: Add dependencies** to `packages/webhook/package.json` `"dependencies"`:

```json
    "@arete/telemetry": "workspace:*",
    "@opentelemetry/api": "^1.9.1",
    "bullmq-otel": "^2.0.0",
```

Then `pnpm install`.

- [ ] **Step 2: Create the two init files.** `packages/webhook/src/otel.ts`:

```ts
/**
 * OTel bootstrap for the webhook HTTP server process. This file is loaded
 * via `--import` (ESM package — NOT --require) so the SDK and the
 * import-in-the-middle hook are active before the first app module resolves.
 * Prod:  node --import ./dist/otel.js dist/index.js
 * Dev:   tsx --import ./src/otel.ts src/index.ts
 */
import { registerEsmHook, initTelemetry } from '@arete/telemetry'

registerEsmHook()
initTelemetry('arete-webhook', process.env.npm_package_version ?? '0.1.0')
```

`packages/webhook/src/otel-worker.ts`:

```ts
/**
 * OTel bootstrap for the BullMQ worker process. Separate file (not an env
 * switch) so `service.name` is structurally correct per process — the §5
 * resource attribute arete-worker vs arete-webhook.
 */
import { registerEsmHook, initTelemetry } from '@arete/telemetry'

registerEsmHook()
initTelemetry('arete-worker', process.env.npm_package_version ?? '0.1.0')
```

- [ ] **Step 3: Wire the scripts.** In `packages/webhook/package.json` replace the scripts block:

```json
  "scripts": {
    "dev": "tsx --import ./src/otel.ts src/index.ts",
    "worker": "tsx watch --import ./src/otel-worker.ts src/worker.ts",
    "start": "node --import ./dist/otel.js dist/index.js",
    "start:worker": "node --import ./dist/otel-worker.js dist/worker.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc",
    "lint": "eslint src && tsc --noEmit"
  },
```

(Known limitation, documented here on purpose: under `tsx` the IITM hook competes with tsx's own loader, so ESM-only libs (@octokit) may not emit auto-spans in dev; CJS libs (express, ioredis, pino, bullmq) instrument fine in both modes, and the compiled `node --import` path is the verified one.)

- [ ] **Step 4: Update the CI smoke test** to boot through the init file — in `.github/workflows/ci.yml`, in the `Smoke test compiled artifact` step, change the line `node dist/index.js &` to:

```yaml
          node --import ./dist/otel.js dist/index.js &
```

This proves in CI, on every PR, that telemetry init cannot take the service down (no collector runs in CI — exporters fail silently, `/health` must still serve 200).

- [ ] **Step 5: Append the OTel env block to `.env.example`** (after the REDIS_URL block, line ~36).
  **Shared-seam rule (both lanes edit this file):** this lane owns the canonical block.
  If Lane B's Task 5 landed first the block already exists (grep for
  `OTEL_EXPORTER_OTLP_ENDPOINT`) — in that case do **not** duplicate it, just confirm
  the values below match. Keep exactly these names:

```bash
# -----------------------------------------------------------------------------
# OpenTelemetry (all services) — spec: 2026-07-20-superlog-observability §5
# -----------------------------------------------------------------------------

# OTLP/HTTP endpoint of the local collector (default infra stack once Lane B
# promotes it; infra/docker-compose-otel.yml before that).
# Signal paths /v1/traces, /v1/logs, /v1/metrics are appended per exporter.
# UNSET => telemetry is a graceful no-op in every service (never a localhost
# default) — the semantics are identical in @arete/telemetry and observability.py.
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Comma-separated opt-in tokens. `http/dup` bridges the JS HTTP semconv
# migration (JS SDK emits legacy http.* names until v3; http/dup emits both).
# `gen_ai_latest_experimental` selects current gen_ai attribute names in the
# Python genai instrumentations (Lane B). Each SDK ignores tokens it does not
# recognize, so both live here together.
OTEL_SEMCONV_STABILITY_OPT_IN=http/dup,gen_ai_latest_experimental

# Set to "true" to run any service with telemetry fully off.
OTEL_SDK_DISABLED=

# deployment.environment.name resource attribute. Default: development.
# Set to "production" ONLY in production.
DEPLOYMENT_ENVIRONMENT=
```

- [ ] **Step 6: Verify** — build and boot the compiled artifact exactly like CI:

```powershell
pnpm --filter @arete/webhook build
$env:GITHUB_APP_ID='12345'; $env:GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----`ntest`n-----END RSA PRIVATE KEY-----`n"; $env:GITHUB_WEBHOOK_SECRET='ci-smoke'; $env:STRIPE_SECRET_KEY='sk_test_ci_smoke'; $env:PORT='3000'
Start-Process node -ArgumentList '--import','./dist/otel.js','dist/index.js' -WorkingDirectory 'packages/webhook'
curl.exe -sf http://localhost:3000/health
```

Expected: `{"status":"ok"}` — with NO collector running (proves graceful degradation). Also `pnpm --filter @arete/webhook lint` and `pnpm --filter @arete/webhook test` stay green. Stop the node process afterwards.

- [ ] **Step 7: Commit:**

```powershell
git add packages/webhook/src/otel.ts packages/webhook/src/otel-worker.ts packages/webhook/package.json .github/workflows/ci.yml .env.example pnpm-lock.yaml
git commit -m "feat(webhook): OTel bootstrap via --import for server + worker processes; env seam in .env.example"
```

---

## Task 10 (Phase 1): BullMQ telemetry on Queue + Worker (bullmq-otel)

**Files:**
- Modify: `packages/webhook/src/queue.ts` (getReviewQueue/getApprovalQueue, lines 95–110)
- Modify: `packages/webhook/src/worker.ts` (startReviewWorker, lines 293–316)
- Test: `packages/webhook/src/queue.test.ts` (append)

**Interfaces — Consumes:** `BullMQOtel` from `bullmq-otel`. **Produces:** producer→consumer trace context propagated through Redis automatically (spec §4: first-party telemetry, no traceparent-in-job-data hacks).

- [ ] **Step 1: Write the failing test** — append to `packages/webhook/src/queue.test.ts`:

```ts
describe('queue telemetry (bullmq-otel)', () => {
  it('constructs every Queue with a BullMQOtel telemetry instance', async () => {
    vi.resetModules()
    const queueCtorOpts: any[] = []
    vi.doMock('bullmq', () => ({
      Queue: class {
        constructor(_name: string, opts: unknown) {
          queueCtorOpts.push(opts)
        }
        async add() { return { id: 'job-1' } }
        async close() {}
      },
    }))
    vi.doMock('ioredis', () => ({ Redis: class { quit = async () => {} } }))

    const { getReviewQueue, getApprovalQueue } = await import('./queue.js')
    getReviewQueue('fast')
    getReviewQueue('heavy')
    getApprovalQueue()

    expect(queueCtorOpts).toHaveLength(3)
    for (const opts of queueCtorOpts) {
      expect(opts.telemetry).toBeDefined()
      expect(opts.telemetry.constructor.name).toBe('BullMQOtel')
    }

    vi.doUnmock('bullmq')
    vi.doUnmock('ioredis')
    vi.resetModules()
  })
})
```

- [ ] **Step 2: Run it** — `pnpm --filter @arete/webhook exec vitest run src/queue.test.ts`. Expected failure: `opts.telemetry` is `undefined` on all three.

- [ ] **Step 3: Implement in `queue.ts`.** Add the import at the top (after the ioredis import, line 7):

```ts
import { BullMQOtel } from 'bullmq-otel'
```

Add one shared instance next to the connection singleton (after line 89):

```ts
// First-party BullMQ telemetry (spec §4): producer-side span on enqueue,
// context propagated through Redis to the worker automatically.
const bullmqTelemetry = new BullMQOtel('arete-webhook')
```

Then thread it into all three constructors:

```ts
export function getApprovalQueue(): Queue<ApprovalExecutionJobData> {
  if (!queueApproval) {
    queueApproval = new Queue<ApprovalExecutionJobData>(APPROVAL_QUEUE_NAME, {
      connection: getConnection(),
      telemetry: bullmqTelemetry,
    })
  }
  return queueApproval
}

export function getReviewQueue(lane: 'fast' | 'heavy' = 'fast'): Queue<ReviewJobData> {
  if (lane === 'fast') {
    if (!queueFast) queueFast = new Queue<ReviewJobData>(REVIEW_QUEUE_NAME, { connection: getConnection(), telemetry: bullmqTelemetry })
    return queueFast
  } else {
    if (!queueHeavy) queueHeavy = new Queue<ReviewJobData>(REVIEW_QUEUE_HEAVY_NAME, { connection: getConnection(), telemetry: bullmqTelemetry })
    return queueHeavy
  }
}
```

- [ ] **Step 4: Wire the consumer side in `worker.ts`.** Add `import { BullMQOtel } from 'bullmq-otel'` to the imports, then in `startReviewWorker()` extend the Worker options (lines 302–305):

```ts
    {
      connection,
      concurrency: REVIEW_QUEUE_CONCURRENCY,
      telemetry: new BullMQOtel('arete-worker'),
    }
```

- [ ] **Step 5: Run again** — `pnpm --filter @arete/webhook exec vitest run src/queue.test.ts src/worker.test.ts` → green; full `pnpm --filter @arete/webhook test` → green (pipeline test mocks `./queue.js`, unaffected).

- [ ] **Step 6: Commit:**

```powershell
git add packages/webhook/src/queue.ts packages/webhook/src/worker.ts packages/webhook/src/queue.test.ts
git commit -m "feat(webhook): bullmq-otel telemetry on all queues + review worker (auto context propagation)"
```

---

## Task 11 (Phase 1): review.run span tree + arete.* metrics in the worker

**Files:**
- Create: `packages/webhook/src/observability.ts`, `packages/webhook/src/observability.test.ts`
- Modify: `packages/webhook/src/worker.ts` (processReviewJob lines 261–284; sub-span wraps in processGitHubPullRequest lines 59–73 and 88, processGitLabMergeRequest lines 225–227; completed/failed handlers lines 308–314)

**Interfaces — Produces:**
- `runWithReviewSpan(attrs: ReviewSpanAttrs, fn: () => Promise<void>): Promise<void>` — opens the §5 root span `review.run`, records `arete.review.runs` + `arete.review.duration` with closed-set dims, re-throws
- `withChildSpan<T>(name: 'review.context.build' | 'review.publish', fn: () => Promise<T>): Promise<T>`
- `recordQueueJob(queue: string, outcome: 'completed' | 'failed'): void` — `arete.queue.jobs`
- `type ReviewSpanAttrs = { provider: 'github' | 'gitlab'; trigger: 'pull_request' | 'check_run' | 'merge_request'; repoFullName: string; prNumber: number }`

Cardinality (§5, hard rule): metric dims are ONLY `outcome` ∈ {success, failure} and `trigger` ∈ {pull_request, check_run, merge_request} (and `queue` name for `arete.queue.jobs`). `repoFullName`/`prNumber` go on the SPAN only.

- [ ] **Step 1: Write the failing test** — `packages/webhook/src/observability.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { trace } from '@opentelemetry/api'
import { NodeTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } from '@opentelemetry/sdk-trace-node'
import { runWithReviewSpan, withChildSpan } from './observability.js'

describe('runWithReviewSpan (§5 span tree root)', () => {
  let exporter: InMemorySpanExporter
  let provider: NodeTracerProvider

  beforeEach(() => {
    exporter = new InMemorySpanExporter()
    provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
    trace.setGlobalTracerProvider(provider)
  })

  afterEach(async () => {
    await provider.shutdown()
    trace.disable()
  })

  it('wraps the job in a review.run root span with §5 attributes and success status', async () => {
    await runWithReviewSpan(
      { provider: 'github', trigger: 'pull_request', repoFullName: 'acme/api', prNumber: 42 },
      async () => {
        await withChildSpan('review.context.build', async () => {})
        await withChildSpan('review.publish', async () => {})
      }
    )
    const spans = exporter.getFinishedSpans()
    const names = spans.map((s) => s.name).sort()
    expect(names).toEqual(['review.context.build', 'review.publish', 'review.run'])
    const root = spans.find((s) => s.name === 'review.run')!
    expect(root.attributes['arete.provider']).toBe('github')
    expect(root.attributes['arete.trigger']).toBe('pull_request')
    expect(root.attributes['arete.repo.full_name']).toBe('acme/api')
    expect(root.attributes['arete.pr.number']).toBe(42)
    // children parented under review.run
    for (const child of spans.filter((s) => s.name !== 'review.run')) {
      expect(child.parentSpanContext?.spanId).toBe(root.spanContext().spanId)
    }
  })

  it('marks the span errored and re-throws on failure', async () => {
    await expect(
      runWithReviewSpan(
        { provider: 'gitlab', trigger: 'merge_request', repoFullName: 'acme/gitlab-api', prNumber: 5 },
        async () => {
          throw new Error('pipeline exploded')
        }
      )
    ).rejects.toThrow('pipeline exploded')
    const root = exporter.getFinishedSpans().find((s) => s.name === 'review.run')!
    expect(root.status.code).toBe(2) // SpanStatusCode.ERROR
    expect(root.events.some((e) => e.name === 'exception')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it** — `pnpm --filter @arete/webhook exec vitest run src/observability.test.ts`. Expected failure: module not found.

- [ ] **Step 3: Implement** `packages/webhook/src/observability.ts`:

```ts
import { trace, metrics, SpanStatusCode, type Counter, type Histogram } from '@opentelemetry/api'

/**
 * Worker-side observability helpers — the §5 span tree (review.run root,
 * review.context.build / review.publish children; agent.review + llm.generate
 * live in the Python agents service) and the §5 arete.* metrics.
 *
 * Cardinality rule (§5, hard): metric dimensions are closed sets only —
 * outcome, trigger, queue. Repo names / PR numbers / installation ids go on
 * SPAN attributes, never metric dimensions.
 */

const tracer = trace.getTracer('arete-worker')

export interface ReviewSpanAttrs {
  provider: 'github' | 'gitlab'
  trigger: 'pull_request' | 'check_run' | 'merge_request'
  repoFullName: string
  prNumber: number
}

interface AreteMetrics {
  reviewRuns: Counter
  reviewDuration: Histogram
  queueJobs: Counter
}

let cached: AreteMetrics | null = null
function areteMetrics(): AreteMetrics {
  if (!cached) {
    const meter = metrics.getMeter('arete-worker')
    cached = {
      reviewRuns: meter.createCounter('arete.review.runs', {
        description: 'PR review runs by outcome and trigger',
      }),
      reviewDuration: meter.createHistogram('arete.review.duration', {
        unit: 's',
        description: 'End-to-end PR review duration (view: explicit buckets to 300s)',
      }),
      queueJobs: meter.createCounter('arete.queue.jobs', {
        description: 'BullMQ jobs by queue and outcome',
      }),
    }
  }
  return cached
}

export async function runWithReviewSpan(attrs: ReviewSpanAttrs, fn: () => Promise<void>): Promise<void> {
  const started = Date.now()
  return tracer.startActiveSpan(
    'review.run',
    {
      attributes: {
        'arete.provider': attrs.provider,
        'arete.trigger': attrs.trigger,
        'arete.repo.full_name': attrs.repoFullName,
        'arete.pr.number': attrs.prNumber,
      },
    },
    async (span) => {
      let outcome: 'success' | 'failure' = 'success'
      try {
        await fn()
        span.setStatus({ code: SpanStatusCode.OK })
      } catch (err) {
        outcome = 'failure'
        span.recordException(err instanceof Error ? err : new Error(String(err)))
        span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) })
        throw err
      } finally {
        const m = areteMetrics()
        m.reviewRuns.add(1, { outcome, trigger: attrs.trigger })
        m.reviewDuration.record((Date.now() - started) / 1000, { outcome, trigger: attrs.trigger })
        span.end()
      }
    }
  )
}

export async function withChildSpan<T>(
  name: 'review.context.build' | 'review.publish',
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await fn()
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw err
    } finally {
      span.end()
    }
  })
}

export function recordQueueJob(queue: string, outcome: 'completed' | 'failed'): void {
  areteMetrics().queueJobs.add(1, { queue, outcome })
}
```

- [ ] **Step 4: Wire it into `worker.ts`.** (a) Import at top: `import { runWithReviewSpan, withChildSpan, recordQueueJob } from './observability.js'`. (b) Wrap the dispatch in `processReviewJob` (keep the poison guard OUTSIDE the span — an unrecoverable reject is not a review run):

```ts
export async function processReviewJob(data: ReviewJobData): Promise<void> {
  if (!data || !data.provider) {
    throw new UnrecoverableError('PoisonMessage: Job data is empty or missing provider')
  }
  if (data.provider === 'github' && (!data.headSha || !data.prNumber || !data.owner || !data.repo)) {
    throw new UnrecoverableError('PoisonMessage: GitHub job missing critical identifier fields')
  }

  const attrs =
    data.provider === 'github'
      ? { provider: 'github' as const, trigger: data.kind, repoFullName: data.fullName, prNumber: data.prNumber }
      : { provider: 'gitlab' as const, trigger: 'merge_request' as const, repoFullName: String(data.projectId), prNumber: data.mrIid }

  return runWithReviewSpan(attrs, async () => {
    if (data.provider === 'github') {
      const app = createApp()
      const octokit = await getInstallationOctokit(app, data.installationId)
      const installationToken = await getInstallationToken(app, data.installationId)
      if (data.kind === 'pull_request') {
        await processGitHubPullRequest(octokit, installationToken, data)
      } else {
        await processGitHubCheckRun(octokit, installationToken, data)
      }
      return
    }
    await processGitLabMergeRequest(data)
  })
}
```

(c) In `processGitHubPullRequest`, wrap the context assembly (lines 59–73) and the publish call:

```ts
  const prContext = await withChildSpan('review.context.build', async () => {
    const ctx = await fetchPRContext(octokit, owner, repo, prNumber)
    ctx.telemetry = await fetchTelemetryContext(octokit, 'github', installationId, owner, repo, ctx.telemetryConnectors ?? [])
    ctx.projectMemories = await fetchProjectMemories('github', repositoryExternalId)
    Object.assign(ctx, buildCloneContext(fullName, installationId, installationToken))
    return ctx
  })
```

and change `await postReview(octokit, owner, repo, prNumber, result)` to:

```ts
    await withChildSpan('review.publish', () => postReview(octokit, owner, repo, prNumber, result))
```

Apply the same `review.publish` wrap to `postGitLabReview(...)` in `processGitLabMergeRequest` (line 227). (d) In `startReviewWorker()`'s event handlers add the queue counter:

```ts
  worker.on('completed', (job) => {
    recordQueueJob(REVIEW_QUEUE_NAME, 'completed')
    console.log(`[worker] Job ${job.id} completed`)
  })
  worker.on('failed', (job, err) => {
    recordQueueJob(REVIEW_QUEUE_NAME, 'failed')
    console.error(`[worker] Job ${job?.id} failed:`, err)
  })
```

(the console lines fall to Task 13's migration; do not pre-convert here — one concern per task).

- [ ] **Step 5: Run the full suite** — `pnpm --filter @arete/webhook test`. Expected: green. The pipeline integration test exercises the real `processReviewJob`; with no SDK registered the API falls back to no-op tracers/meters, so wrapping is invisible to existing assertions.

- [ ] **Step 6: Commit:**

```powershell
git add packages/webhook/src/observability.ts packages/webhook/src/observability.test.ts packages/webhook/src/worker.ts
git commit -m "feat(webhook): review.run span tree + arete.* metrics in worker (closed-set dims only)"
```

---

## Task 12 (Phase 1): agent_metrics Redis publisher (light the SSE dark wire)

**Files:**
- Create: `packages/webhook/src/agent-metrics.ts`, `packages/webhook/src/agent-metrics.test.ts`
- Modify: `packages/webhook/src/observability.ts` (emit lifecycle events from runWithReviewSpan)

**Interfaces — Consumes:** `sse-handler.ts:22-35` — subscribes channel `agent_metrics`, forwards each published message verbatim as an SSE `data:` line, so the published payload must be a single-line JSON string. **Produces:**

```ts
type AgentMetricsEvent = {
  ts: string                                   // ISO 8601
  event: 'review.started' | 'review.completed' | 'review.failed'
  provider: 'github' | 'gitlab'
  repo: string
  prNumber: number
  trigger: 'pull_request' | 'check_run' | 'merge_request'
  durationMs?: number                          // completed/failed only
  traceId?: string                             // correlates SSE → Jaeger
}
publishAgentMetricsEvent(event: AgentMetricsEvent): void   // fire-and-forget, never throws
```

- [ ] **Step 1: Write the failing test** — `packages/webhook/src/agent-metrics.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAgentMetricsPublisher, type AgentMetricsEvent } from './agent-metrics.js'

const EVENT: AgentMetricsEvent = {
  ts: '2026-07-20T12:00:00.000Z',
  event: 'review.completed',
  provider: 'github',
  repo: 'acme/api',
  prNumber: 42,
  trigger: 'pull_request',
  durationMs: 61000,
  traceId: 'abc123abc123abc123abc123abc12345',
}

describe('agent_metrics publisher (SSE dark wire — sse-handler.ts contract)', () => {
  let publish: ReturnType<typeof vi.fn>

  beforeEach(() => {
    publish = vi.fn().mockResolvedValue(1)
  })

  it('publishes single-line JSON to the agent_metrics channel', () => {
    const publisher = createAgentMetricsPublisher({ publish } as never)
    publisher(EVENT)
    expect(publish).toHaveBeenCalledTimes(1)
    const [channel, message] = publish.mock.calls[0]
    expect(channel).toBe('agent_metrics')
    expect(message).not.toContain('\n') // SSE data: framing requirement
    expect(JSON.parse(message)).toEqual(EVENT)
  })

  it('never throws when redis publish rejects (fire-and-forget)', async () => {
    publish.mockRejectedValue(new Error('redis down'))
    const publisher = createAgentMetricsPublisher({ publish } as never)
    expect(() => publisher(EVENT)).not.toThrow()
    await new Promise((r) => setImmediate(r)) // rejection settles without unhandled-rejection crash
  })
})
```

- [ ] **Step 2: Run it** — `pnpm --filter @arete/webhook exec vitest run src/agent-metrics.test.ts`. Expected failure: module not found.

- [ ] **Step 3: Implement** `packages/webhook/src/agent-metrics.ts`:

```ts
import { Redis as IORedis } from 'ioredis'

/**
 * Publisher side of the Redis SSE dark wire (spec §3 Phase 1): the worker
 * publishes review-lifecycle events to the `agent_metrics` PubSub channel
 * that sse-handler.ts already subscribes to and forwards verbatim as SSE
 * `data:` lines — so payloads MUST be single-line JSON.
 *
 * Cardinality note: this is an event stream, not a metric — repo/prNumber
 * are fine here (they'd be forbidden as metric dimensions per §5).
 */

export const AGENT_METRICS_CHANNEL = 'agent_metrics'

export interface AgentMetricsEvent {
  ts: string
  event: 'review.started' | 'review.completed' | 'review.failed'
  provider: 'github' | 'gitlab'
  repo: string
  prNumber: number
  trigger: 'pull_request' | 'check_run' | 'merge_request'
  durationMs?: number
  traceId?: string
}

type PublishClient = Pick<IORedis, 'publish'>

/** Factory (test seam). Fire-and-forget: SSE liveness must never fail a review. */
export function createAgentMetricsPublisher(client: PublishClient): (event: AgentMetricsEvent) => void {
  return (event: AgentMetricsEvent) => {
    try {
      void client.publish(AGENT_METRICS_CHANNEL, JSON.stringify(event)).catch(() => {})
    } catch {
      // never let a metrics publish break the pipeline
    }
  }
}

let defaultPublisher: ((event: AgentMetricsEvent) => void) | null = null

/** Lazy singleton over a dedicated Redis connection (subscribe-mode conns
 *  can't publish, so this must not share sse-handler's subscriber). */
export function publishAgentMetricsEvent(event: AgentMetricsEvent): void {
  if (!defaultPublisher) {
    try {
      const client = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
        lazyConnect: false,
      })
      defaultPublisher = createAgentMetricsPublisher(client)
    } catch {
      defaultPublisher = () => {}
    }
  }
  defaultPublisher(event)
}
```

- [ ] **Step 4: Emit from the worker span wrapper.** In `packages/webhook/src/observability.ts`, add imports and wire events into `runWithReviewSpan` (started before `fn()`, completed/failed in the handlers):

```ts
import { publishAgentMetricsEvent } from './agent-metrics.js'
```

Inside the `startActiveSpan` callback, before `try`:

```ts
      const base = {
        provider: attrs.provider,
        repo: attrs.repoFullName,
        prNumber: attrs.prNumber,
        trigger: attrs.trigger,
        traceId: span.spanContext().traceId,
      }
      publishAgentMetricsEvent({ ts: new Date().toISOString(), event: 'review.started', ...base })
```

After `await fn()` (success path): `publishAgentMetricsEvent({ ts: new Date().toISOString(), event: 'review.completed', durationMs: Date.now() - started, ...base })`. In the catch, before `throw err`: `publishAgentMetricsEvent({ ts: new Date().toISOString(), event: 'review.failed', durationMs: Date.now() - started, ...base })`.

- [ ] **Step 5: Run** — `pnpm --filter @arete/webhook test`. The pipeline integration test now triggers real `publishAgentMetricsEvent` calls; if its lazy IORedis connection attempt is unwanted in tests, guard the singleton: at the top of `publishAgentMetricsEvent` add `if (process.env.NODE_ENV === 'test' && !defaultPublisher) { defaultPublisher = () => {} }` — vitest sets NODE_ENV=test. Expected: green, no redis connection attempts logged during tests.

- [ ] **Step 6: Commit:**

```powershell
git add packages/webhook/src/agent-metrics.ts packages/webhook/src/agent-metrics.test.ts packages/webhook/src/observability.ts
git commit -m "feat(webhook): agent_metrics Redis publisher - worker lifecycle events light the SSE dark wire"
```

---

## Task 13 (Phase 1): console.* → pino across webhook + flip no-console to error

**Files:**
- Create: `packages/webhook/src/logger.ts`
- Modify: all 22 non-test `packages/webhook/src/**` files with `console.*` (79 sites; per-file counts: webhook-handler.ts 10, worker.ts 11, server.ts 10, gitlab-handler.ts 8, stripe-handler.ts 5, index.ts 4, backfill.ts 4, chat-handler.ts 3, context-map-index.ts 3, fix/trigger.ts 3, persistence.ts 3, approval-worker.ts 2, pr-fetcher.ts 2, staging/send-handler.ts 2, and 1 each in context-map/file-handler.ts, gitlab-comment-poster.ts, context-map/file-content.ts, review-bridge.ts, sse-handler.ts, scan/trigger.ts, telemetry/fetch-telemetry-context.ts, outbound/retry-worker.ts)
- Modify: `packages/webhook/eslint.config.mjs` (`no-console` → `error`)

**Interfaces — Produces:** `logger` (pino, service `webhook`) + convention `const log = logger.child({ component: '<old-tag>' })`. The `[tag]` → `component` mapping (§10 resolved): `[server]`→`server`, `[handler]`→`webhook-handler`, `[worker]`→`worker`, `[gitlab]`→`gitlab-handler`, `[stripe]`→`stripe-handler`, `[sse]`→`sse`, `[scan]`→`scan`, `[fix]`→`fix`, `[approvals]`→`approvals`, `[backfill]`→`backfill`, `[chat]`→`chat`, `[telemetry]`→`telemetry-context`, `[outbound]`→`outbound`, `[context-map]`→`context-map`; untagged calls take the file's basename.

- [ ] **Step 1: Ratchet first (the failing test).** In `packages/webhook/eslint.config.mjs` change `'no-console': 'warn'` to `'no-console': 'error'`, then run `pnpm --filter @arete/webhook exec eslint src`. Expected failure: exactly 78 `no-console` errors — this is the migration's completion checklist.

- [ ] **Step 2: Create the shared logger** — `packages/webhook/src/logger.ts`:

```ts
import { createLogger } from '@arete/telemetry'

/**
 * Process-wide pino logger. service.name on OTLP records comes from the SDK
 * resource (arete-webhook vs arete-worker per boot file); this base field is
 * for local console/file output. trace_id/span_id are stamped automatically
 * by instrumentation-pino whenever a span is active.
 *
 * Convention: per-module child loggers carry the old [tag] as `component`:
 *   const log = logger.child({ component: 'worker' })
 */
export const logger = createLogger('webhook')
```

- [ ] **Step 3: Migrate file by file** (run `pnpm --filter @arete/webhook exec eslint src` after each file; the error count must only go down). The three canonical shapes — apply mechanically everywhere:

`src/index.ts` (4 sites) becomes:

```ts
import { createServer } from './server.js'
import { getConfig } from './config.js'
import { logger } from './logger.js'

const log = logger.child({ component: 'index' })
const config = getConfig()

createServer()
  .then((app) => {
    app.listen(config.port, () => {
      log.info({ port: config.port }, 'Areté webhook server listening')
      log.info({ endpoint: `POST http://localhost:${config.port}/webhook` }, 'webhook endpoint ready')
      log.info({ endpoint: `GET http://localhost:${config.port}/health` }, 'health check ready')
    })
  })
  .catch((err) => {
    log.error({ err }, 'Failed to start server')
    process.exit(1)
  })
```

Tagged error shape — `src/server.ts:29` `console.error('[server] Error handling pull_request event:', err)` becomes (with `const log = logger.child({ component: 'server' })` once near the top of `createServer`):

```ts
      log.error({ err }, 'Error handling pull_request event')
```

Interpolated info shape — `src/worker.ts:141` `` console.log(`[worker] Posted review — risk: ${result.risk_level}, comments: ${result.total_comments}`) `` becomes (module-level `const log = logger.child({ component: 'worker' })`):

```ts
  log.info({ riskLevel: result.risk_level, comments: result.total_comments }, 'Posted review')
```

Rules: values move into the structured object (never string-interpolate ids/counts); errors always pass as `{ err }` (pino serializes stack); `console.warn`→`log.warn`; ids like `workItemId`, `approvalId`, `jobId` become fields. Never log tokens/keys — redaction catches slips, but don't rely on it.

- [ ] **Step 4: Verify the ratchet closed** — `pnpm --filter @arete/webhook lint` → 0 problems; `pnpm --filter @arete/webhook test` → green (tests assert behavior, not console output — `pr-fetcher.test.ts`'s own console call is covered by the test-file override); `pnpm --filter @arete/webhook build` → clean.

- [ ] **Step 5: Commit:**

```powershell
git add packages/webhook/src packages/webhook/eslint.config.mjs
git commit -m "refactor(webhook): console.* -> pino with structured component fields; no-console now an error"
```

---

## Task 14 (Phase 1): Dashboard — instrumentation.ts (@vercel/otel) + /api/health

**Files:**
- Create: `packages/dashboard/src/instrumentation.ts` (Next 16 App Router, `src/` layout → this exact path; the `instrumentationHook` flag is gone, stable since 15 — check `node_modules/next/dist/docs/` per `packages/dashboard/AGENTS.md` before deviating)
- Create: `packages/dashboard/src/app/api/health/route.ts`, `packages/dashboard/src/app/api/health/route.test.ts`
- Modify: `packages/dashboard/package.json` (dependencies)

**Interfaces — Produces:** `register()` export consumed by the Next runtime at boot; `GET /api/health` → `200 {"status":"ok","service":"arete-dashboard"}`.

- [ ] **Step 1: Add the dependency** — in `packages/dashboard/package.json` dependencies add:

```json
    "@vercel/otel": "^2.1.3",
```

Then `pnpm install`. (Do NOT add `auto-instrumentations-node` here — monkey-patching inside Next bundles is unreliable, spec §4.)

- [ ] **Step 2: Write the failing health-route test** — `packages/dashboard/src/app/api/health/route.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { GET } from './route'

describe('GET /api/health', () => {
  it('returns 200 with the service identity', async () => {
    const res = GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'ok', service: 'arete-dashboard' })
  })
})
```

Run `pnpm --filter @arete/dashboard exec vitest run src/app/api/health/route.test.ts`. Expected failure: cannot resolve `./route`.

- [ ] **Step 3: Implement the route** — `packages/dashboard/src/app/api/health/route.ts`:

```ts
/**
 * Liveness probe (spec §3 exit criteria: /health on all three services).
 * force-dynamic so `next build` never prerenders it into a static 200 —
 * a cached health check is a lie.
 */
export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json({ status: 'ok', service: 'arete-dashboard' })
}
```

- [ ] **Step 4: Create** `packages/dashboard/src/instrumentation.ts`:

```ts
import { registerOTel } from '@vercel/otel'

/**
 * Next.js instrumentation hook (stable — runs once per server boot in each
 * runtime). @vercel/otel reads OTEL_EXPORTER_OTLP_ENDPOINT and friends from
 * the environment; conventions/redaction are shared with @arete/telemetry by
 * config only (spec decision: the dashboard deliberately does NOT load the
 * NodeSDK — auto-instrumentations don't survive Next bundling).
 * Telemetry must never take the dashboard down (spec §3).
 */
export function register(): void {
  try {
    registerOTel({
      serviceName: 'arete-dashboard',
      attributes: {
        'deployment.environment.name': process.env.DEPLOYMENT_ENVIRONMENT ?? 'development',
      },
    })
  } catch (err) {
    // The one permitted warning — same contract as @arete/telemetry init.
    // eslint-disable-next-line no-console
    console.warn(`[telemetry] dashboard init failed — running without telemetry: ${err instanceof Error ? err.message : String(err)}`)
  }
}
```

- [ ] **Step 5: Run** — `pnpm --filter @arete/dashboard exec vitest run src/app/api/health/route.test.ts` → green; `pnpm --filter @arete/dashboard lint` → clean; full `pnpm --filter @arete/dashboard test` → green. (The `next build` gate runs in CI's `test-dashboard` job with its Postgres service; don't block locally on it.)

- [ ] **Step 6: Commit:**

```powershell
git add packages/dashboard/src/instrumentation.ts packages/dashboard/src/app/api/health packages/dashboard/package.json pnpm-lock.yaml
git commit -m "feat(dashboard): @vercel/otel instrumentation.ts + /api/health liveness route"
```

---

## Task 15 (Phase 1): `instrument-every-feature` skill (policy-as-code)

**Files:**
- Create: `.claude/skills/instrument-every-feature/SKILL.md`
- Create: `packages/telemetry/AGENTS.md` (steering pointer, matching the repo's AGENTS.md-per-package convention — cf. `packages/dashboard/AGENTS.md`)

**Interfaces — Produces:** agent-readable policy consumed by every future feature PR; encodes §5 conventions + cardinality + redaction + per-signal verification. (Agent B delivers the sibling `debug-from-telemetry` skill — do not create it here.)

- [ ] **Step 1: Create `.claude/skills/instrument-every-feature/SKILL.md`:**

````markdown
---
name: instrument-every-feature
description: Use when adding or changing any feature in Areté (TS or Python) — new code must arrive with spans, metrics, and logs per the frozen conventions, with redaction and per-signal verification. Required by the PR DoD checklist.
---

# Instrument Every Feature

New behavior ships with telemetry in the same PR. "Works on my machine" is
not evidence; a span in Jaeger is. Source of truth:
`docs/superpowers/specs/2026-07-20-superlog-observability-integration-design.md`
(§5 conventions are FROZEN — changing a name requires a spec amendment).

## Spans (user intent → business op → transport)

Name spans after the business operation, parented under the user-intent root:
`review.run` → `review.context.build` / `agent.review` (attr `agent.role`) →
`llm.generate` → auto HTTP client spans; `review.synthesize`/`review.critique`,
`review.publish`. Same pattern for `scan.run`, `fix.run`, `chat.turn`.

TypeScript (webhook/worker): use `runWithReviewSpan`/`withChildSpan` from
`packages/webhook/src/observability.ts`, or `trace.getTracer(...)` +
`startActiveSpan` for new trees. Init is already wired via `--import`
(`src/otel.ts` / `src/otel-worker.ts`) — never re-init the SDK in app code.

## Metrics

Namespace `arete.*`: `arete.review.runs` (counter: `outcome`, `trigger`),
`arete.review.duration` (histogram, s), `arete.agent.duration` (histogram:
`agent.role`), `arete.queue.jobs` (counter: `queue`, `outcome`), plus semconv
`gen_ai.client.token.usage` / `gen_ai.client.operation.duration`.

**Cardinality rule (review-blocking):** metric dimensions must be CLOSED
low-cardinality sets (role, outcome, provider, model). Repo names, PR
numbers, installation ids, SHAs, tenant ids → span attributes ONLY, never
metric dimensions.

Durations that can exceed 10 s (anything touching an LLM) need explicit
bucket boundaries up to 300 s — see `DURATION_HISTOGRAM_BOUNDARIES` in
`@arete/telemetry` and register a view for any new duration histogram.

## Logs

No bare `console.*` / `print` in server code (ESLint enforces it in
packages/webhook). TS: `logger.child({ component: '<module>' })` from
`packages/webhook/src/logger.ts` (pino via `@arete/telemetry`); Python:
structlog per `arete_agents/observability.py`. Put values in structured
fields, never string interpolation; errors as `{ err }`. `trace_id`/`span_id`
stamping is automatic when a span is active.

## Redaction (spec §5 — all sinks)

Blocklist keys: `authorization`, `x-api-key`, `api_key`, `token`, `secret`,
`password`, `cookie`, `set-cookie`. Value shapes: bearer tokens,
`sk-`/`ghp_`/`ghs_`/`glpat-`/`whsec_` keys, `?key=`/`?api_key=` URL params.
Credentials go in HTTP headers, never URLs. If your change adds attributes or
log fields that could carry secrets, extend the canary tests
(`packages/telemetry/src/scrub-processor.test.ts`, `logger.test.ts`) in the
same PR.

## Per-signal verification (paste evidence in the PR body)

A green build says nothing about telemetry. Drive one span, one metric batch,
and one log through the REAL bootstrap and verify each endpoint:

```bash
# Collector lives in the default stack once Lane B's Task 11 promotes it;
# until then it is in infra/docker-compose-otel.yml — use whichever exists:
docker compose -f infra/docker-compose.yml up -d 2>/dev/null || docker compose -f infra/docker-compose-otel.yml up -d
# exercise your code path, then check each signal independently:
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4318/v1/traces  -H 'Content-Type: application/json' -d '{"resourceSpans":[]}'   # expect 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4318/v1/metrics -H 'Content-Type: application/json' -d '{"resourceMetrics":[]}'  # expect 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4318/v1/logs    -H 'Content-Type: application/json' -d '{"resourceLogs":[]}'     # expect 200
```

A 200 can still drop records: check the response body's `partialSuccess`
field — it must be empty/absent. Then confirm your spans appear in Jaeger
(http://localhost:16686) under the right `service.name`. "Traces work" says
nothing about logs — verify each signal you touched.
````

- [ ] **Step 2: Create `packages/telemetry/AGENTS.md`:**

```markdown
# @arete/telemetry

OTel bootstrap + pino factory + redaction core for all TS services. The §5
conventions (service names, span tree, metric namespace, redaction blocklist,
histogram boundaries) are FROZEN by
`docs/superpowers/specs/2026-07-20-superlog-observability-integration-design.md`
— do not rename anything here without a spec amendment.

Before instrumenting a feature, follow `.claude/skills/instrument-every-feature/SKILL.md`.

Rules of the package:
- `initTelemetry()` must NEVER throw — every code path try/catch-wrapped,
  one warning, boolean return. There is a test for this; keep it green.
- Anything exported here runs before app code via `--import`; keep imports
  side-effect-free except in `init.ts`.
- The canary scrub tests (`scrub-processor.test.ts`, `logger.test.ts`) are a
  Phase-1 security gate (spec §6): grow them whenever the redaction surface grows.
```

- [ ] **Step 3: Verify** — the skill loads as plain markdown (no build step). Sanity: `pnpm --filter @arete/telemetry test` still green (docs-only change).

- [ ] **Step 4: Commit:**

```powershell
git add .claude/skills/instrument-every-feature/SKILL.md packages/telemetry/AGENTS.md
git commit -m "docs(skills): instrument-every-feature policy-as-code + telemetry package steering"
```

---

## Task 16 (Phase 1): Full DoD run + per-signal verification evidence

**Files:**
- No source changes. Output: verification evidence pasted into the phase PR body (per §8 DoD). If any check fails, fix in the owning task's files and re-run — do not close with red evidence.

- [ ] **Step 1: Full gates** (all must exit 0):

```powershell
pnpm install --frozen-lockfile
pnpm --filter @arete/webhook lint          # ESLint (no-console=error) + tsc
pnpm --filter @arete/dashboard lint
$env:LLM_PROVIDER='gemini'; $env:GEMINI_API_KEY='test-key-not-real'
pnpm test:all                              # every TS package + Python agents
pnpm --filter @arete/webhook build
```

- [ ] **Step 2: Flake re-check** — the Task 4 seeded shuffle matrix (seeds 1, 2, 3) on `pipeline.integration.test.ts`: three green runs.

- [ ] **Step 3: Boot the local collector stack** (Agent B may have promoted it into the default compose by now; either file works — the endpoint contract is the same):

```powershell
# After Lane B's Task 11 the collector is in the default stack; before it,
# the standalone file still exists. Use whichever is present:
if (Select-String -Path infra/docker-compose.yml -Pattern 'otel-collector' -Quiet) { $compose = 'infra/docker-compose.yml' } else { $compose = 'infra/docker-compose-otel.yml' }
docker compose -f $compose up -d
docker compose -f $compose ps   # collector must be Up with 4318 mapped
```

- [ ] **Step 4: Endpoint contract check (per signal, BEFORE app traffic)** — status code AND partial-success body for each endpoint:

```powershell
curl.exe -s -w "`ntraces_status=%{http_code}`n"  -X POST http://localhost:4318/v1/traces  -H "Content-Type: application/json" -d "{\"resourceSpans\":[]}"
curl.exe -s -w "`nmetrics_status=%{http_code}`n" -X POST http://localhost:4318/v1/metrics -H "Content-Type: application/json" -d "{\"resourceMetrics\":[]}"
curl.exe -s -w "`nlogs_status=%{http_code}`n"    -X POST http://localhost:4318/v1/logs    -H "Content-Type: application/json" -d "{\"resourceLogs\":[]}"
```

Expected per line: body `{}` (or a `partialSuccess` object with **no** `rejectedSpans`/`rejectedDataPoints`/`rejectedLogRecords`) and `*_status=200`. A non-empty rejected count is a FAIL even at 200 — record the payload either way.

- [ ] **Step 5: Drive real signals through the real bootstrap.** Terminal A: start infra + webhook + worker (`pnpm infra:up`, then `pnpm --filter @arete/webhook start` and `pnpm --filter @arete/webhook start:worker` with the dev env from `.env`). Terminal B:

```powershell
# 1 span + 1 log minimum: the health hit produces an Express server span and a pino log
curl.exe -s http://localhost:3000/health
# SSE wire: subscribe, then trigger any review (or, for a wire-only check,
# publish one event by hand and watch it arrive):
curl.exe -N http://localhost:3000/metrics/stream
docker exec -it $(docker ps -qf name=redis) redis-cli PUBLISH agent_metrics "{\"ts\":\"2026-07-20T12:00:00Z\",\"event\":\"review.completed\",\"provider\":\"github\",\"repo\":\"acme/api\",\"prNumber\":1,\"trigger\":\"pull_request\",\"durationMs\":1000}"
# dashboard: pnpm dev:dashboard, then
curl.exe -s http://localhost:3001/api/health
```

Evidence to record: (a) the SSE client prints `event: connected` then the published JSON line; (b) Jaeger (http://localhost:16686) lists services `arete-webhook` (+ `arete-worker` after a review job) and shows the `review.run` tree with `review.context.build`/`review.publish` children after processing one job; (c) one exported log record carries `trace_id` (query the collector's logs pipeline or ClickHouse `otel_logs` if Agent B's DDL landed); (d) metrics: after ≥1 job, `arete.review.runs` and `arete.queue.jobs` visible in the collector's Prometheus endpoint or debug exporter with ONLY `outcome`/`trigger`/`queue` dims.

- [ ] **Step 6: Canary gate re-run (spec §6 gate 2):**

```powershell
pnpm --filter @arete/telemetry test
```

Expected: scrub-processor + logger canary suites green — fake secret in a log line, span attribute, URL query, and thrown exception provably absent from exporter output.

- [ ] **Step 7: Assemble the PR body** with the §8 DoD checklist, checking each item against the evidence above (status codes, partial-success payloads, Jaeger screenshot/trace id, SSE transcript, canary run). Push and open the PR:

```powershell
git push -u origin stroland02/obs-ts
gh pr create --base integration-preview --title "Observability Lane A: Phase 0 gates + TS instrumentation" --body-file <the assembled DoD body>
```

---

## Self-review checklist (done before this plan was saved)

- Lane-A spec coverage: Phase 0 — four CI packages (T1), aggregate script (T2), webhook ESLint (T3), flake fix not quarantine (T4). Phase 1 — telemetry package incl. env init/resource/pino-redact/scrubber/BullMQ wiring (T5–T8, T10), webhook server instrumentation via `--import` (T9), worker `review.run` tree + `arete.*` metrics (T11), `agent_metrics` publisher matching `sse-handler.ts` (T12), console→pino with `component` field (T13), dashboard `instrumentation.ts` + health (T14), skill (T15), canary scrub test (T6/T8, re-run T16), per-signal verification with partial-success (T16). Out of Lane A: ClickHouse SQL fix, coverage reporting, collector/compose/DDL, Python — Agent B.
- No placeholders: every code block complete; no TBD/“similar to”; the only deferred work is mechanical repetition explicitly enumerated with file/count lists (T13) whose completion is machine-checked by the ESLint ratchet.
- Name consistency: `initTelemetry`/`shutdownTelemetry`/`registerEsmHook`/`createLogger`/`ScrubbingSpanProcessor`/`runWithReviewSpan`/`withChildSpan`/`recordQueueJob`/`publishAgentMetricsEvent`/`AGENT_METRICS_CHANNEL`, env names, and §5 metric/span names used identically across tasks.
