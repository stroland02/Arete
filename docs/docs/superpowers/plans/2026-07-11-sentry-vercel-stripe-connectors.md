# Sentry, Vercel, Stripe Telemetry Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three more telemetry connectors (Sentry error tracking, Vercel deploy events, Stripe revenue) to the existing telemetry pipeline, reusing all infrastructure already built for GitHub Actions and PostHog (SSRF guard, credential encryption, TTL cache, circuit breaker, `fetchTelemetryContext` orchestrator).

**Architecture:** Each new connector is a standalone file matching the exact shape of `packages/webhook/src/telemetry/posthog-connector.ts` (the canonical template): fixed hardcoded API host, `assertAllowedTelemetryHost` SSRF check, `AbortController` timeout, returns `ConnectorResult` (`ok`/`no-data`/`error`), never throws. No new shared infrastructure is built — only new connector files plus the dispatch wiring in `fetch-telemetry-context.ts`.

**Tech Stack:** TypeScript, vitest, existing `packages/webhook/src/telemetry/` modules.

## Global Constraints

- Static API keys only, no OAuth — matches the existing v1 constraint. All three services support bearer-token/API-key auth without an OAuth flow (verified against official docs).
- Any connector failure/timeout/missing-config must never block the review — same `ConnectorResult` contract as existing connectors.
- No customer-supplied URLs — every host is a hardcoded constant, added to the SSRF guard's allowlist.
- TDD throughout. Conventional commits.

## Verified API details (from documentation research — use these exact values)

**Sentry:** `GET https://sentry.io/api/0/organizations/{org}/issues/?statsPeriod=7d&project={project}` — `Authorization: Bearer <token>` (Org Token or Internal Integration token). Response: JSON array of issues with `title`, `count`, `lastSeen`, `permalink`, `shortId`.

**Vercel:** `GET https://api.vercel.com/v6/deployments?projectId={id}&limit=20` (append `&teamId={id}` only if the credential config supplies one — optional, personal accounts don't need it) — `Authorization: Bearer <token>` (Vercel Access Token). Response: `{ deployments: [{ uid, state, readyState, createdAt, url }], pagination: {...} }`. `readyState` enum includes `READY`, `ERROR`, `CANCELED`, `BUILDING`, etc.

**Stripe:** `GET https://api.stripe.com/v1/charges?created[gte]={unix_ts}&limit=100` — `Authorization: Bearer <secret_or_restricted_key>` (documented as valid alongside HTTP Basic Auth). Response: `{ data: [{ amount, status, created }], has_more }`. Amounts are integers in minor units (cents). Sum `amount` where `status === "succeeded"`.

---

### Task 1: Extend types and SSRF guard for the three new providers

**Files:**
- Modify: `packages/webhook/src/types.ts`
- Modify: `packages/webhook/src/telemetry/ssrf-guard.ts`
- Modify: `packages/webhook/src/telemetry/ssrf-guard.test.ts`

**Interfaces:**
- Produces: `TelemetryConnectorConfig['provider']` widened to include `'sentry' | 'vercel' | 'stripe'`; `assertAllowedTelemetryHost`'s provider union widened to match.

- [ ] **Step 1: Write the failing tests**

Add to `packages/webhook/src/telemetry/ssrf-guard.test.ts`:

```typescript
it('allows the sentry api host', () => {
  expect(() => assertAllowedTelemetryHost('sentry', 'https://sentry.io/api/0/organizations/acme/issues/')).not.toThrow()
})

it('allows the vercel api host', () => {
  expect(() => assertAllowedTelemetryHost('vercel', 'https://api.vercel.com/v6/deployments')).not.toThrow()
})

it('allows the stripe api host', () => {
  expect(() => assertAllowedTelemetryHost('stripe', 'https://api.stripe.com/v1/charges')).not.toThrow()
})

it('rejects sentry provider for a vercel host', () => {
  expect(() => assertAllowedTelemetryHost('sentry', 'https://api.vercel.com/v6/deployments')).toThrow(/not an allowed host/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arete/webhook exec vitest run src/telemetry/ssrf-guard.test.ts`
Expected: FAIL — `assertAllowedTelemetryHost` doesn't accept `'sentry'`/`'vercel'`/`'stripe'` as a provider type (TypeScript error at test-compile time inside vitest, or the allowlist lookup returns `undefined` and every call throws).

- [ ] **Step 3: Implement**

In `packages/webhook/src/telemetry/ssrf-guard.ts`, widen the provider type and allowlist:

```typescript
const ALLOWED_HOSTS: Record<'github_actions' | 'posthog' | 'sentry' | 'vercel' | 'stripe', string[]> = {
  github_actions: ['api.github.com'],
  posthog: ['app.posthog.com', 'us.posthog.com', 'eu.posthog.com'],
  sentry: ['sentry.io'],
  vercel: ['api.vercel.com'],
  stripe: ['api.stripe.com'],
}
```

```typescript
export function assertAllowedTelemetryHost(
  provider: 'github_actions' | 'posthog' | 'sentry' | 'vercel' | 'stripe',
  url: string
): void {
  const parsed = new URL(url)
  if (isPrivateOrMetadataIPv4(parsed.hostname) || parsed.hostname === 'localhost') {
    throw new Error(`Telemetry connector blocked: "${parsed.hostname}" resolves to a private/internal address`)
  }
  const allowed = ALLOWED_HOSTS[provider]
  if (!allowed.includes(parsed.hostname)) {
    throw new Error(`Telemetry connector blocked: "${parsed.hostname}" is not an allowed host for provider "${provider}"`)
  }
}
```

(Only the `ALLOWED_HOSTS` map and the function's parameter type change — the private-IP check and the throw logic are unchanged from the existing file.)

In `packages/webhook/src/types.ts`, widen `TelemetryConnectorConfig`:

```typescript
export interface TelemetryConnectorConfig {
  provider: 'github_actions' | 'posthog' | 'sentry' | 'vercel' | 'stripe'
  service?: string
  project?: string
  /** Sentry: organization slug. Vercel: team ID (optional, personal accounts omit it). */
  org?: string
}
```

(Adds the `'sentry' | 'vercel' | 'stripe'` union members and one new optional `org` field — needed because Sentry's endpoint requires an org slug and Vercel's optionally takes a team ID. Everything else in the interface is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arete/webhook exec vitest run src/telemetry/ssrf-guard.test.ts && pnpm --filter @arete/webhook exec tsc --noEmit`
Expected: all pass, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add packages/webhook/src/types.ts packages/webhook/src/telemetry/ssrf-guard.ts packages/webhook/src/telemetry/ssrf-guard.test.ts
git commit -m "feat(webhook): extend telemetry types and SSRF allowlist for Sentry, Vercel, Stripe"
```

---

### Task 2: Sentry connector

**Files:**
- Create: `packages/webhook/src/telemetry/sentry-connector.ts`
- Create: `packages/webhook/src/telemetry/sentry-connector.test.ts`

**Interfaces:**
- Consumes: `assertAllowedTelemetryHost`, `ConnectorResult` (Task 1 + existing).
- Produces: `fetchSentrySnapshot(credentials: SentryCredentials, org: string, project: string): Promise<ConnectorResult>`, `SentryCredentials { token: string }`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/webhook/src/telemetry/sentry-connector.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchSentrySnapshot } from './sentry-connector.js'

describe('fetchSentrySnapshot', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('summarizes recent Sentry issues', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { title: 'TypeError: x is undefined', count: '42', shortId: 'ACME-1', permalink: 'https://acme.sentry.io/issues/1' },
        { title: 'NullPointerException', count: '7', shortId: 'ACME-2', permalink: 'https://acme.sentry.io/issues/2' },
      ]),
    }) as any

    const result = await fetchSentrySnapshot({ token: 'tok' }, 'acme', 'backend')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.snapshot.provider).toBe('sentry')
      expect(result.snapshot.source_ref).toBe('acme/backend')
      expect(result.snapshot.summary_text).toContain('TypeError')
      expect(result.snapshot.links).toContain('https://acme.sentry.io/issues/1')
    }
  })

  it('returns no-data when there are zero issues', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ([]) }) as any
    const result = await fetchSentrySnapshot({ token: 'tok' }, 'acme', 'backend')
    expect(result.status).toBe('no-data')
  })

  it('returns error (never throws) on a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as any
    const result = await fetchSentrySnapshot({ token: 'bad' }, 'acme', 'backend')
    expect(result.status).toBe('error')
  })

  it('returns error (never throws) when the request times out', async () => {
    global.fetch = vi.fn().mockImplementation(
      () => new Promise((_resolve, reject) => {
        setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 10)
      })
    ) as any
    const result = await fetchSentrySnapshot({ token: 'tok' }, 'acme', 'backend')
    expect(result.status).toBe('error')
  })

  it('queries the org-level issues endpoint with a 7-day statsPeriod and project filter', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ([]) }) as any
    await fetchSentrySnapshot({ token: 'tok' }, 'acme', 'backend')
    const calledUrl = new URL((global.fetch as any).mock.calls[0][0] as string)
    expect(calledUrl.hostname).toBe('sentry.io')
    expect(calledUrl.pathname).toBe('/api/0/organizations/acme/issues/')
    expect(calledUrl.searchParams.get('statsPeriod')).toBe('7d')
    expect(calledUrl.searchParams.get('project')).toBe('backend')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arete/webhook exec vitest run src/telemetry/sentry-connector.test.ts`
Expected: FAIL — cannot find module `./sentry-connector.js`

- [ ] **Step 3: Implement**

```typescript
// packages/webhook/src/telemetry/sentry-connector.ts
import type { ConnectorResult } from './connector-result.js'
import { assertAllowedTelemetryHost } from './ssrf-guard.js'

const SENTRY_BASE_URL = 'https://sentry.io/api/0'
const FETCH_TIMEOUT_MS = 8_000
const MAX_ISSUES_IN_SUMMARY = 5

export interface SentryCredentials {
  token: string
}

interface SentryIssue {
  title: string
  count: string
  shortId: string
  permalink: string
}

/**
 * Fetches recent unresolved issues for a Sentry project over the last 7
 * days. Never throws — a project with zero recent issues resolves to
 * 'no-data', any real failure (auth error, timeout, network error)
 * resolves to 'error'. Matches the posthog-connector.ts contract exactly.
 */
export async function fetchSentrySnapshot(
  credentials: SentryCredentials,
  org: string,
  project: string
): Promise<ConnectorResult> {
  const url = new URL(`${SENTRY_BASE_URL}/organizations/${org}/issues/`)
  url.searchParams.set('statsPeriod', '7d')
  url.searchParams.set('project', project)

  assertAllowedTelemetryHost('sentry', url.toString())

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${credentials.token}` },
      signal: controller.signal,
    })

    if (!res.ok) return { status: 'error' }

    const issues = (await res.json()) as SentryIssue[]
    if (issues.length === 0) return { status: 'no-data' }

    const top = issues.slice(0, MAX_ISSUES_IN_SUMMARY)
    const summary = top.map((i) => `${i.title} (${i.count}x)`).join(', ')

    return {
      status: 'ok',
      snapshot: {
        provider: 'sentry',
        source_ref: `${org}/${project}`,
        summary_text: `Recent Sentry issues over the last 7 days — ${summary}.`,
        metrics: { issue_count: issues.length },
        links: top.map((i) => i.permalink).filter(Boolean),
        fetched_at: new Date().toISOString(),
      },
    }
  } catch {
    return { status: 'error' }
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arete/webhook exec vitest run src/telemetry/sentry-connector.test.ts`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add packages/webhook/src/telemetry/sentry-connector.ts packages/webhook/src/telemetry/sentry-connector.test.ts
git commit -m "feat(webhook): add Sentry telemetry connector"
```

---

### Task 3: Vercel connector

**Files:**
- Create: `packages/webhook/src/telemetry/vercel-connector.ts`
- Create: `packages/webhook/src/telemetry/vercel-connector.test.ts`

**Interfaces:**
- Consumes: `assertAllowedTelemetryHost`, `ConnectorResult`.
- Produces: `fetchVercelSnapshot(credentials: VercelCredentials, projectId: string, teamId?: string): Promise<ConnectorResult>`, `VercelCredentials { token: string }`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/webhook/src/telemetry/vercel-connector.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchVercelSnapshot } from './vercel-connector.js'

describe('fetchVercelSnapshot', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('summarizes recent deployment health', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        deployments: [
          { uid: 'd1', readyState: 'READY', createdAt: 1720000000000, url: 'app-1.vercel.app' },
          { uid: 'd2', readyState: 'READY', createdAt: 1720000001000, url: 'app-2.vercel.app' },
          { uid: 'd3', readyState: 'ERROR', createdAt: 1720000002000, url: 'app-3.vercel.app' },
        ],
      }),
    }) as any

    const result = await fetchVercelSnapshot({ token: 'tok' }, 'prj_123')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.snapshot.provider).toBe('vercel')
      expect(result.snapshot.source_ref).toBe('prj_123')
      expect(result.snapshot.summary_text).toContain('2')
      expect(result.snapshot.summary_text).toContain('3')
      expect(result.snapshot.metrics.failure_rate).toBeCloseTo(1 / 3)
    }
  })

  it('returns no-data when there are zero deployments', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deployments: [] }) }) as any
    const result = await fetchVercelSnapshot({ token: 'tok' }, 'prj_123')
    expect(result.status).toBe('no-data')
  })

  it('returns error (never throws) on a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 }) as any
    const result = await fetchVercelSnapshot({ token: 'bad' }, 'prj_123')
    expect(result.status).toBe('error')
  })

  it('returns error (never throws) when the request times out', async () => {
    global.fetch = vi.fn().mockImplementation(
      () => new Promise((_resolve, reject) => {
        setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 10)
      })
    ) as any
    const result = await fetchVercelSnapshot({ token: 'tok' }, 'prj_123')
    expect(result.status).toBe('error')
  })

  it('includes teamId in the query only when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deployments: [] }) }) as any
    await fetchVercelSnapshot({ token: 'tok' }, 'prj_123', 'team_abc')
    const calledUrl = new URL((global.fetch as any).mock.calls[0][0] as string)
    expect(calledUrl.hostname).toBe('api.vercel.com')
    expect(calledUrl.pathname).toBe('/v6/deployments')
    expect(calledUrl.searchParams.get('projectId')).toBe('prj_123')
    expect(calledUrl.searchParams.get('teamId')).toBe('team_abc')
  })

  it('omits teamId from the query when not provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deployments: [] }) }) as any
    await fetchVercelSnapshot({ token: 'tok' }, 'prj_123')
    const calledUrl = new URL((global.fetch as any).mock.calls[0][0] as string)
    expect(calledUrl.searchParams.has('teamId')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arete/webhook exec vitest run src/telemetry/vercel-connector.test.ts`
Expected: FAIL — cannot find module `./vercel-connector.js`

- [ ] **Step 3: Implement**

```typescript
// packages/webhook/src/telemetry/vercel-connector.ts
import type { ConnectorResult } from './connector-result.js'
import { assertAllowedTelemetryHost } from './ssrf-guard.js'

const VERCEL_BASE_URL = 'https://api.vercel.com'
const FETCH_TIMEOUT_MS = 8_000
const RECENT_DEPLOYMENTS_TO_SAMPLE = 20

export interface VercelCredentials {
  token: string
}

interface VercelDeployment {
  uid: string
  readyState: 'READY' | 'ERROR' | 'CANCELED' | 'BUILDING' | 'QUEUED' | 'INITIALIZING' | string
  createdAt: number
}

/**
 * Fetches recent deployment health for a Vercel project. Never throws — a
 * project with zero deployments resolves to 'no-data', any real failure
 * resolves to 'error'. Matches the posthog-connector.ts contract exactly.
 */
export async function fetchVercelSnapshot(
  credentials: VercelCredentials,
  projectId: string,
  teamId?: string
): Promise<ConnectorResult> {
  const url = new URL(`${VERCEL_BASE_URL}/v6/deployments`)
  url.searchParams.set('projectId', projectId)
  url.searchParams.set('limit', String(RECENT_DEPLOYMENTS_TO_SAMPLE))
  if (teamId) url.searchParams.set('teamId', teamId)

  assertAllowedTelemetryHost('vercel', url.toString())

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${credentials.token}` },
      signal: controller.signal,
    })

    if (!res.ok) return { status: 'error' }

    const data = (await res.json()) as { deployments?: VercelDeployment[] }
    const deployments = data.deployments ?? []
    if (deployments.length === 0) return { status: 'no-data' }

    const failures = deployments.filter((d) => d.readyState === 'ERROR').length
    const total = deployments.length
    const successes = total - failures

    return {
      status: 'ok',
      snapshot: {
        provider: 'vercel',
        source_ref: projectId,
        summary_text: `${successes} of ${total} recent deployments succeeded (${failures} failed).`,
        metrics: { failure_rate: failures / total },
        links: [],
        fetched_at: new Date().toISOString(),
      },
    }
  } catch {
    return { status: 'error' }
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arete/webhook exec vitest run src/telemetry/vercel-connector.test.ts`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add packages/webhook/src/telemetry/vercel-connector.ts packages/webhook/src/telemetry/vercel-connector.test.ts
git commit -m "feat(webhook): add Vercel telemetry connector"
```

---

### Task 4: Stripe connector

**Files:**
- Create: `packages/webhook/src/telemetry/stripe-telemetry-connector.ts` (named to avoid collision with the existing `stripe-handler.ts` billing-webhook file)
- Create: `packages/webhook/src/telemetry/stripe-telemetry-connector.test.ts`

**Interfaces:**
- Consumes: `assertAllowedTelemetryHost`, `ConnectorResult`.
- Produces: `fetchStripeSnapshot(credentials: StripeTelemetryCredentials): Promise<ConnectorResult>`, `StripeTelemetryCredentials { secretKey: string }`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/webhook/src/telemetry/stripe-telemetry-connector.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchStripeSnapshot } from './stripe-telemetry-connector.js'

describe('fetchStripeSnapshot', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('summarizes recent successful revenue', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { amount: 5000, status: 'succeeded', created: 1720000000 },
          { amount: 2500, status: 'succeeded', created: 1720000001 },
          { amount: 1000, status: 'failed', created: 1720000002 },
        ],
        has_more: false,
      }),
    }) as any

    const result = await fetchStripeSnapshot({ secretKey: 'rk_test_x' })
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.snapshot.provider).toBe('stripe')
      expect(result.snapshot.metrics.revenue_cents).toBe(7500)
      expect(result.snapshot.metrics.successful_charge_count).toBe(2)
      expect(result.snapshot.metrics.failed_charge_count).toBe(1)
    }
  })

  it('returns no-data when there are zero charges', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [], has_more: false }) }) as any
    const result = await fetchStripeSnapshot({ secretKey: 'rk_test_x' })
    expect(result.status).toBe('no-data')
  })

  it('returns error (never throws) on a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as any
    const result = await fetchStripeSnapshot({ secretKey: 'bad' })
    expect(result.status).toBe('error')
  })

  it('returns error (never throws) when the request times out', async () => {
    global.fetch = vi.fn().mockImplementation(
      () => new Promise((_resolve, reject) => {
        setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 10)
      })
    ) as any
    const result = await fetchStripeSnapshot({ secretKey: 'rk_test_x' })
    expect(result.status).toBe('error')
  })

  it('queries the charges endpoint with a 7-day created[gte] filter using Bearer auth', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [], has_more: false }) }) as any
    await fetchStripeSnapshot({ secretKey: 'rk_test_x' })
    const calledUrl = new URL((global.fetch as any).mock.calls[0][0] as string)
    const calledOptions = (global.fetch as any).mock.calls[0][1]
    expect(calledUrl.hostname).toBe('api.stripe.com')
    expect(calledUrl.pathname).toBe('/v1/charges')
    expect(calledUrl.searchParams.has('created[gte]')).toBe(true)
    expect(calledOptions.headers.Authorization).toBe('Bearer rk_test_x')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arete/webhook exec vitest run src/telemetry/stripe-telemetry-connector.test.ts`
Expected: FAIL — cannot find module `./stripe-telemetry-connector.js`

- [ ] **Step 3: Implement**

```typescript
// packages/webhook/src/telemetry/stripe-telemetry-connector.ts
import type { ConnectorResult } from './connector-result.js'
import { assertAllowedTelemetryHost } from './ssrf-guard.js'

const STRIPE_BASE_URL = 'https://api.stripe.com'
const FETCH_TIMEOUT_MS = 8_000
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60

export interface StripeTelemetryCredentials {
  secretKey: string
}

interface StripeCharge {
  amount: number
  status: string
}

/**
 * Fetches successful/failed charge revenue for the last 7 days. Never
 * throws — zero charges resolves to 'no-data', any real failure resolves
 * to 'error'. Matches the posthog-connector.ts contract exactly. Amounts
 * are Stripe's native minor-unit integers (e.g. cents) — not converted to
 * a major currency unit here, since Stripe accounts can use different
 * currencies and the caller/prompt can format as needed.
 */
export async function fetchStripeSnapshot(credentials: StripeTelemetryCredentials): Promise<ConnectorResult> {
  const sinceUnix = Math.floor(Date.now() / 1000) - SEVEN_DAYS_SECONDS
  const url = new URL(`${STRIPE_BASE_URL}/v1/charges`)
  url.searchParams.set('created[gte]', String(sinceUnix))
  url.searchParams.set('limit', '100')

  assertAllowedTelemetryHost('stripe', url.toString())

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${credentials.secretKey}` },
      signal: controller.signal,
    })

    if (!res.ok) return { status: 'error' }

    const data = (await res.json()) as { data?: StripeCharge[] }
    const charges = data.data ?? []
    if (charges.length === 0) return { status: 'no-data' }

    const successful = charges.filter((c) => c.status === 'succeeded')
    const failed = charges.filter((c) => c.status !== 'succeeded')
    const revenueCents = successful.reduce((sum, c) => sum + c.amount, 0)

    return {
      status: 'ok',
      snapshot: {
        provider: 'stripe',
        source_ref: 'account',
        summary_text: `${successful.length} successful charges (${revenueCents} minor units) and ${failed.length} failed charges over the last 7 days.`,
        metrics: {
          revenue_cents: revenueCents,
          successful_charge_count: successful.length,
          failed_charge_count: failed.length,
        },
        links: [],
        fetched_at: new Date().toISOString(),
      },
    }
  } catch {
    return { status: 'error' }
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arete/webhook exec vitest run src/telemetry/stripe-telemetry-connector.test.ts`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add packages/webhook/src/telemetry/stripe-telemetry-connector.ts packages/webhook/src/telemetry/stripe-telemetry-connector.test.ts
git commit -m "feat(webhook): add Stripe telemetry connector"
```

---

### Task 5: Wire all three connectors into fetchTelemetryContext's dispatch

**Files:**
- Modify: `packages/webhook/src/telemetry/fetch-telemetry-context.ts`
- Modify: `packages/webhook/src/telemetry/fetch-telemetry-context.test.ts`

**Interfaces:**
- Consumes: `fetchSentrySnapshot`/`SentryCredentials` (Task 2), `fetchVercelSnapshot`/`VercelCredentials` (Task 3), `fetchStripeSnapshot`/`StripeTelemetryCredentials` (Task 4).

Read the CURRENT full content of `fetch-telemetry-context.ts` before editing — it already handles `github_actions` and `posthog` with the exact structure shown in this plan's context section above. Preserve everything for those two providers; only ADD the three new `else if` branches plus the `sourceRefFor` extension.

- [ ] **Step 1: Write the failing tests**

Add to `packages/webhook/src/telemetry/fetch-telemetry-context.test.ts` (follow the file's existing `vi.doMock` + dynamic import pattern used for the `github_actions`/`posthog` tests):

```typescript
it('dispatches to the Sentry connector for a sentry connector config', async () => {
  vi.doMock('./sentry-connector.js', () => ({
    fetchSentrySnapshot: vi.fn().mockResolvedValue({
      status: 'ok',
      snapshot: { provider: 'sentry', source_ref: 'acme/backend', summary_text: 'ok', metrics: {}, links: [], fetched_at: '2026-07-11T00:00:00Z' },
    }),
  }))
  vi.doMock('./credentials.js', () => ({ decryptCredentials: vi.fn().mockReturnValue({ token: 'tok' }) }))
  vi.doMock('../db.js', () => ({
    prisma: {
      installation: { findUnique: vi.fn().mockResolvedValue({ id: 'inst-uuid-1' }) },
      telemetryConnection: {
        findUnique: vi.fn().mockResolvedValue({ credentials: 'encrypted', config: { org: 'acme', project: 'backend' } }),
      },
    },
  }))

  const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
  const result = await fetchTelemetryContext({} as any, 'github', 42, 'acme', 'backend', [
    { provider: 'sentry', org: 'acme', project: 'backend' },
  ])
  expect(result).toHaveLength(1)
  expect(result[0].provider).toBe('sentry')
})

it('dispatches to the Vercel connector for a vercel connector config', async () => {
  vi.doMock('./vercel-connector.js', () => ({
    fetchVercelSnapshot: vi.fn().mockResolvedValue({
      status: 'ok',
      snapshot: { provider: 'vercel', source_ref: 'prj_123', summary_text: 'ok', metrics: {}, links: [], fetched_at: '2026-07-11T00:00:00Z' },
    }),
  }))
  vi.doMock('./credentials.js', () => ({ decryptCredentials: vi.fn().mockReturnValue({ token: 'tok' }) }))
  vi.doMock('../db.js', () => ({
    prisma: {
      installation: { findUnique: vi.fn().mockResolvedValue({ id: 'inst-uuid-1' }) },
      telemetryConnection: {
        findUnique: vi.fn().mockResolvedValue({ credentials: 'encrypted', config: { project: 'prj_123' } }),
      },
    },
  }))

  const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
  const result = await fetchTelemetryContext({} as any, 'github', 42, 'acme', 'backend', [
    { provider: 'vercel', project: 'prj_123' },
  ])
  expect(result).toHaveLength(1)
  expect(result[0].provider).toBe('vercel')
})

it('dispatches to the Stripe connector for a stripe connector config', async () => {
  vi.doMock('./stripe-telemetry-connector.js', () => ({
    fetchStripeSnapshot: vi.fn().mockResolvedValue({
      status: 'ok',
      snapshot: { provider: 'stripe', source_ref: 'account', summary_text: 'ok', metrics: {}, links: [], fetched_at: '2026-07-11T00:00:00Z' },
    }),
  }))
  vi.doMock('./credentials.js', () => ({ decryptCredentials: vi.fn().mockReturnValue({ secretKey: 'rk_test' }) }))
  vi.doMock('../db.js', () => ({
    prisma: {
      installation: { findUnique: vi.fn().mockResolvedValue({ id: 'inst-uuid-1' }) },
      telemetryConnection: {
        findUnique: vi.fn().mockResolvedValue({ credentials: 'encrypted', config: {} }),
      },
    },
  }))

  const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
  const result = await fetchTelemetryContext({} as any, 'github', 42, 'acme', 'backend', [
    { provider: 'stripe' },
  ])
  expect(result).toHaveLength(1)
  expect(result[0].provider).toBe('stripe')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arete/webhook exec vitest run src/telemetry/fetch-telemetry-context.test.ts -t "dispatches to the"`
Expected: FAIL — `fetchOneConnector` has no branch for `sentry`/`vercel`/`stripe`, so these connectors are silently skipped (result length 0, not 1)

- [ ] **Step 3: Implement**

In `packages/webhook/src/telemetry/fetch-telemetry-context.ts`:

Add the three new imports at the top (alongside the existing `fetchGitHubActionsSnapshot`/`fetchPostHogSnapshot` imports):

```typescript
import { fetchSentrySnapshot, type SentryCredentials } from './sentry-connector.js'
import { fetchVercelSnapshot, type VercelCredentials } from './vercel-connector.js'
import { fetchStripeSnapshot, type StripeTelemetryCredentials } from './stripe-telemetry-connector.js'
```

Update `sourceRefFor` to handle the new providers (Sentry uses `org/project`, Vercel uses the project id, Stripe has no meaningful per-PR source ref since it's account-wide):

```typescript
function sourceRefFor(owner: string, repo: string, connector: TelemetryConnectorConfig): string {
  if (connector.provider === 'github_actions') return `${owner}/${repo}`
  if (connector.provider === 'sentry') return `${connector.org}/${connector.project}`
  if (connector.provider === 'stripe') return 'account'
  return connector.project ?? connector.service ?? `${owner}/${repo}`
}
```

Add three new branches inside `fetchOneConnector`'s `try` block, after the existing `posthog` branch (each follows the identical shape: guard on `installationId`, look up the `TelemetryConnection` row scoped to that provider, decrypt, call the connector):

```typescript
    } else if (connector.provider === 'sentry') {
      if (!installationId) return null
      const connection = await prisma.telemetryConnection.findUnique({
        where: { installationId_provider: { installationId, provider: 'sentry' } },
      })
      if (!connection) return null
      const credentials = decryptCredentials<SentryCredentials>(connection.credentials)
      const org = connector.org ?? ''
      const project = connector.project ?? ''
      result = await fetchSentrySnapshot(credentials, org, project)
    } else if (connector.provider === 'vercel') {
      if (!installationId) return null
      const connection = await prisma.telemetryConnection.findUnique({
        where: { installationId_provider: { installationId, provider: 'vercel' } },
      })
      if (!connection) return null
      const credentials = decryptCredentials<VercelCredentials>(connection.credentials)
      result = await fetchVercelSnapshot(credentials, sourceRef, connector.org)
    } else if (connector.provider === 'stripe') {
      if (!installationId) return null
      const connection = await prisma.telemetryConnection.findUnique({
        where: { installationId_provider: { installationId, provider: 'stripe' } },
      })
      if (!connection) return null
      const credentials = decryptCredentials<StripeTelemetryCredentials>(connection.credentials)
      result = await fetchStripeSnapshot(credentials)
    }
```

(This sits as additional `else if` branches directly after the existing `} else if (connector.provider === 'posthog') { ... }` block — nothing about the `github_actions`/`posthog` branches changes.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arete/webhook exec vitest run src/telemetry/fetch-telemetry-context.test.ts && pnpm --filter @arete/webhook exec tsc --noEmit`
Expected: all pass (existing 9 + 3 new = 12), typecheck clean

- [ ] **Step 5: Run the full webhook suite and commit**

Run: `pnpm --filter @arete/webhook test`
Expected: all pass (baseline 123 + new tests from Tasks 1-5)

```bash
git add packages/webhook/src/telemetry/fetch-telemetry-context.ts packages/webhook/src/telemetry/fetch-telemetry-context.test.ts
git commit -m "feat(webhook): dispatch Sentry, Vercel, Stripe connectors in fetchTelemetryContext"
```

---

## After all 5 tasks

Run the full webhook test suite one more time to confirm the whole feature composes cleanly: `pnpm --filter @arete/webhook test`. Python side is untouched by this plan — no Python test run needed.

**Not in scope for this plan (tracked separately):** a connect flow for creating `TelemetryConnection` rows for these three new providers (same gap already flagged for PostHog); validating these exact API endpoint assumptions against real Sentry/Vercel/Stripe accounts (the next phase of work per the user's request — "test these one by one to make sure they function properly"); `.arete.yml` documentation for the new connector config shapes.
