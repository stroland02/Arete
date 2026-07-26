# Generic OAuth Connector Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A provider-agnostic OAuth 2.0 authorization-code engine (authorize URL → consent → callback → token exchange → encrypted storage → transparent refresh) that any telemetry connector can plug into, so real connectors (Vercel first, PostHog next) get a "Connect" button instead of a manual API-key paste — matching what SuperLog and other real platforms do.

**Architecture:** All new code lives in `packages/webhook/src/oauth/`. No new Prisma table — `TelemetryConnection.credentials` already stores an arbitrary encrypted JSON blob (built for exactly this kind of extensibility); OAuth tokens reuse it with a new `authMethod` discriminator column. CSRF `state` is a signed, self-contained token (HMAC'd with the existing `TELEMETRY_ENCRYPTION_KEY`) — no new server-side session/state store needed. Every piece is tested with mocked HTTP calls; this plan does not require real Vercel/PostHog OAuth app credentials to build or verify.

**Tech Stack:** TypeScript, Express, Prisma, vitest, existing `packages/webhook/src/telemetry/credentials.ts` (AES-256-GCM) and `config.ts` (zod env validation) patterns.

## Global Constraints

- No real OAuth provider credentials exist yet — every test mocks the HTTP token-exchange/refresh calls. Nothing in this plan makes a real network call to Vercel/PostHog.
- Reuse `encryptCredentials`/`decryptCredentials` from `packages/webhook/src/telemetry/credentials.ts` for token storage — do not build a second encryption path.
- `state` tokens must be self-contained (signed, not stored server-side) — Express workers should stay stateless between the authorize redirect and the callback.
- TDD throughout. Conventional commits.

---

### Task 1: `authMethod` schema field + CSRF state token module

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/webhook/src/oauth/oauth-state.ts`
- Create: `packages/webhook/src/oauth/oauth-state.test.ts`

**Interfaces:**
- Produces: `TelemetryConnection.authMethod: String @default("api_key")`; `signOAuthState(installationId: string, provider: string): string`, `verifyOAuthState(token: string): { installationId: string; provider: string } | null`.

- [ ] **Step 1: Add the schema field**

Add to `packages/db/prisma/schema.prisma`'s `TelemetryConnection` model (after the existing `credentials` field's doc comment, before `createdAt`):

```prisma
  /// "api_key" | "oauth" — which shape `credentials` holds. api_key rows
  /// store { apiKey/secretKey/token: "..." }; oauth rows store
  /// { accessToken, refreshToken, expiresAt, tokenType }.
  authMethod     String       @default("api_key")
```

Run: `pnpm --filter @arete/db exec prisma migrate dev --name add_telemetry_connection_auth_method`
(requires local Postgres running: `docker compose -f infra/docker-compose.yml up -d postgres` first if not already up)

- [ ] **Step 2: Write the failing tests for the state module**

```typescript
// packages/webhook/src/oauth/oauth-state.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('OAuth state token', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('TELEMETRY_ENCRYPTION_KEY', 'a'.repeat(64))
  })

  it('round-trips installationId and provider through sign/verify', async () => {
    const { signOAuthState, verifyOAuthState } = await import('./oauth-state.js')
    const token = signOAuthState('inst-123', 'vercel')
    const result = verifyOAuthState(token)
    expect(result).toEqual({ installationId: 'inst-123', provider: 'vercel' })
  })

  it('rejects a tampered token', async () => {
    const { signOAuthState, verifyOAuthState } = await import('./oauth-state.js')
    const token = signOAuthState('inst-123', 'vercel')
    const tampered = token.slice(0, -1) + (token.slice(-1) === 'a' ? 'b' : 'a')
    expect(verifyOAuthState(tampered)).toBeNull()
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'))
    const { signOAuthState, verifyOAuthState } = await import('./oauth-state.js')
    const token = signOAuthState('inst-123', 'vercel')
    vi.setSystemTime(new Date('2026-07-11T00:11:00Z')) // past the 10-minute TTL
    expect(verifyOAuthState(token)).toBeNull()
    vi.useRealTimers()
  })

  it('rejects malformed input without throwing', async () => {
    const { verifyOAuthState } = await import('./oauth-state.js')
    expect(verifyOAuthState('not-a-real-token')).toBeNull()
    expect(verifyOAuthState('')).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @arete/webhook exec vitest run src/oauth/oauth-state.test.ts`
Expected: FAIL — cannot find module `./oauth-state.js`

- [ ] **Step 4: Implement**

```typescript
// packages/webhook/src/oauth/oauth-state.ts
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getTelemetryConfig } from '../config.js'

// Self-contained, signed CSRF state — no server-side session store needed
// between the authorize redirect and the callback (Express workers are
// stateless between requests). Reuses TELEMETRY_ENCRYPTION_KEY as the HMAC
// key rather than introducing a second secret.
const STATE_TTL_MS = 10 * 60 * 1000

function sign(payload: string): string {
  const key = getTelemetryConfig().encryptionKey
  return createHmac('sha256', key).update(payload).digest('hex')
}

export function signOAuthState(installationId: string, provider: string): string {
  const expiresAt = Date.now() + STATE_TTL_MS
  const payload = `${installationId}:${provider}:${expiresAt}`
  const signature = sign(payload)
  return Buffer.from(`${payload}:${signature}`).toString('base64url')
}

export function verifyOAuthState(token: string): { installationId: string; provider: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const parts = decoded.split(':')
    if (parts.length !== 4) return null
    const [installationId, provider, expiresAtStr, signature] = parts

    const payload = `${installationId}:${provider}:${expiresAtStr}`
    const expectedSignature = sign(payload)
    const sigBuf = Buffer.from(signature, 'hex')
    const expectedBuf = Buffer.from(expectedSignature, 'hex')
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null

    const expiresAt = Number(expiresAtStr)
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null

    return { installationId, provider }
  } catch {
    return null
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @arete/webhook exec vitest run src/oauth/oauth-state.test.ts`
Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ packages/webhook/src/oauth/oauth-state.ts packages/webhook/src/oauth/oauth-state.test.ts
git commit -m "feat(webhook): add authMethod field and signed OAuth CSRF state tokens"
```

---

### Task 2: Provider OAuth config + authorize URL builder

**Files:**
- Create: `packages/webhook/src/oauth/oauth-provider-config.ts`
- Create: `packages/webhook/src/oauth/oauth-provider-config.test.ts`
- Create: `packages/webhook/src/oauth/build-authorize-url.ts`
- Create: `packages/webhook/src/oauth/build-authorize-url.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `signOAuthState` (Task 1).
- Produces: `getOAuthProviderConfig(provider: 'vercel' | 'posthog'): OAuthProviderConfig` (throws a clear config error if that provider's env vars aren't set — lazy, matching `getTelemetryConfig`'s pattern of not requiring vars for unused features); `buildOAuthAuthorizeUrl(provider: 'vercel' | 'posthog', installationId: string): string`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/webhook/src/oauth/oauth-provider-config.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('getOAuthProviderConfig', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('returns Vercel config when its env vars are set', async () => {
    vi.stubEnv('VERCEL_OAUTH_CLIENT_ID', 'client-1')
    vi.stubEnv('VERCEL_OAUTH_CLIENT_SECRET', 'secret-1')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
    const { getOAuthProviderConfig } = await import('./oauth-provider-config.js')
    const config = getOAuthProviderConfig('vercel')
    expect(config.clientId).toBe('client-1')
    expect(config.authorizeUrl).toBe('https://vercel.com/integrations/install')
    expect(config.redirectUri).toBe('https://areté.example.com/oauth/vercel/callback')
  })

  it('throws a clear error when Vercel env vars are missing', async () => {
    const { getOAuthProviderConfig } = await import('./oauth-provider-config.js')
    expect(() => getOAuthProviderConfig('vercel')).toThrow(/VERCEL_OAUTH_CLIENT_ID/)
  })

  it('returns PostHog config when its env vars are set', async () => {
    vi.stubEnv('POSTHOG_OAUTH_CLIENT_ID', 'client-2')
    vi.stubEnv('POSTHOG_OAUTH_CLIENT_SECRET', 'secret-2')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
    const { getOAuthProviderConfig } = await import('./oauth-provider-config.js')
    const config = getOAuthProviderConfig('posthog')
    expect(config.clientId).toBe('client-2')
    expect(config.tokenUrl).toBe('https://oauth.posthog.com/oauth/token/')
  })
})
```

```typescript
// packages/webhook/src/oauth/build-authorize-url.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('buildOAuthAuthorizeUrl', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('VERCEL_OAUTH_CLIENT_ID', 'client-1')
    vi.stubEnv('VERCEL_OAUTH_CLIENT_SECRET', 'secret-1')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
    vi.stubEnv('TELEMETRY_ENCRYPTION_KEY', 'a'.repeat(64))
  })

  it('builds a valid authorize URL with client_id, redirect_uri, and a signed state', async () => {
    const { buildOAuthAuthorizeUrl } = await import('./build-authorize-url.js')
    const url = new URL(buildOAuthAuthorizeUrl('vercel', 'inst-123'))
    expect(url.hostname).toBe('vercel.com')
    expect(url.searchParams.get('client_id')).toBe('client-1')
    expect(url.searchParams.get('redirect_uri')).toBe('https://areté.example.com/oauth/vercel/callback')
    expect(url.searchParams.get('state')).toBeTruthy()
  })

  it('embeds a state that verifies back to the same installationId and provider', async () => {
    const { buildOAuthAuthorizeUrl } = await import('./build-authorize-url.js')
    const { verifyOAuthState } = await import('./oauth-state.js')
    const url = new URL(buildOAuthAuthorizeUrl('vercel', 'inst-123'))
    const state = url.searchParams.get('state')!
    expect(verifyOAuthState(state)).toEqual({ installationId: 'inst-123', provider: 'vercel' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arete/webhook exec vitest run src/oauth/oauth-provider-config.test.ts src/oauth/build-authorize-url.test.ts`
Expected: FAIL — modules don't exist yet

- [ ] **Step 3: Implement**

```typescript
// packages/webhook/src/oauth/oauth-provider-config.ts
import { z } from 'zod'

export interface OAuthProviderConfig {
  clientId: string
  clientSecret: string
  authorizeUrl: string
  tokenUrl: string
  scope: string
  redirectUri: string
}

// Fixed per-provider endpoints and scopes — never customer-supplied, closing
// off the same class of SSRF/host-confusion risk the telemetry connectors'
// SSRF guard exists for. Only client_id/client_secret are per-deployment.
const PROVIDER_ENDPOINTS: Record<'vercel' | 'posthog', { authorizeUrl: string; tokenUrl: string; scope: string }> = {
  vercel: {
    authorizeUrl: 'https://vercel.com/integrations/install',
    tokenUrl: 'https://api.vercel.com/v2/oauth/access_token',
    scope: 'deployments:read',
  },
  posthog: {
    authorizeUrl: 'https://app.posthog.com/oauth/authorize/',
    tokenUrl: 'https://oauth.posthog.com/oauth/token/',
    scope: 'query:read insight:read',
  },
}

const RedirectBaseSchema = z.object({
  OAUTH_REDIRECT_BASE_URL: z.string({ required_error: 'OAUTH_REDIRECT_BASE_URL is required' }).min(1),
})

function redirectUriFor(provider: 'vercel' | 'posthog'): string {
  const result = RedirectBaseSchema.safeParse(process.env)
  if (!result.success) throw new Error('Configuration error: OAUTH_REDIRECT_BASE_URL is required')
  return `${result.data.OAUTH_REDIRECT_BASE_URL}/oauth/${provider}/callback`
}

/** Lazily reads a provider's OAuth app credentials — only required once
 * that provider's OAuth flow is actually invoked, matching the rest of
 * this codebase's per-feature-optional config pattern. */
export function getOAuthProviderConfig(provider: 'vercel' | 'posthog'): OAuthProviderConfig {
  const prefix = provider.toUpperCase()
  const clientId = process.env[`${prefix}_OAUTH_CLIENT_ID`]
  const clientSecret = process.env[`${prefix}_OAUTH_CLIENT_SECRET`]
  if (!clientId) throw new Error(`Configuration error: ${prefix}_OAUTH_CLIENT_ID is required`)
  if (!clientSecret) throw new Error(`Configuration error: ${prefix}_OAUTH_CLIENT_SECRET is required`)

  const endpoints = PROVIDER_ENDPOINTS[provider]
  return {
    clientId,
    clientSecret,
    authorizeUrl: endpoints.authorizeUrl,
    tokenUrl: endpoints.tokenUrl,
    scope: endpoints.scope,
    redirectUri: redirectUriFor(provider),
  }
}
```

```typescript
// packages/webhook/src/oauth/build-authorize-url.ts
import { getOAuthProviderConfig } from './oauth-provider-config.js'
import { signOAuthState } from './oauth-state.js'

export function buildOAuthAuthorizeUrl(provider: 'vercel' | 'posthog', installationId: string): string {
  const config = getOAuthProviderConfig(provider)
  const state = signOAuthState(installationId, provider)

  const url = new URL(config.authorizeUrl)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', config.scope)
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')
  return url.toString()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arete/webhook exec vitest run src/oauth/oauth-provider-config.test.ts src/oauth/build-authorize-url.test.ts`
Expected: 5 passed

- [ ] **Step 5: Add env var documentation and commit**

Add to `.env.example`:

```
# OAuth connector app credentials (per provider) — only required once that
# provider's "Connect" flow is used. Register the app in each provider's
# developer console (Vercel Integrations Console, PostHog OAuth app settings)
# and set the redirect URI there to {OAUTH_REDIRECT_BASE_URL}/oauth/<provider>/callback.
OAUTH_REDIRECT_BASE_URL=
VERCEL_OAUTH_CLIENT_ID=
VERCEL_OAUTH_CLIENT_SECRET=
POSTHOG_OAUTH_CLIENT_ID=
POSTHOG_OAUTH_CLIENT_SECRET=
```

```bash
git add packages/webhook/src/oauth/oauth-provider-config.ts packages/webhook/src/oauth/oauth-provider-config.test.ts packages/webhook/src/oauth/build-authorize-url.ts packages/webhook/src/oauth/build-authorize-url.test.ts .env.example
git commit -m "feat(webhook): add OAuth provider config and authorize URL builder"
```

---

### Task 3: Token exchange and refresh

**Files:**
- Create: `packages/webhook/src/oauth/oauth-token-exchange.ts`
- Create: `packages/webhook/src/oauth/oauth-token-exchange.test.ts`

**Interfaces:**
- Consumes: `getOAuthProviderConfig` (Task 2).
- Produces: `exchangeOAuthCode(provider: 'vercel' | 'posthog', code: string): Promise<OAuthTokenResult | null>`, `refreshOAuthToken(provider: 'vercel' | 'posthog', refreshToken: string): Promise<OAuthTokenResult | null>`, `interface OAuthTokenResult { accessToken: string; refreshToken: string | null; expiresAt: number | null; tokenType: string }`. Both return `null` (never throw) on failure — same never-throws contract as the telemetry connectors.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/webhook/src/oauth/oauth-token-exchange.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('exchangeOAuthCode', () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('VERCEL_OAUTH_CLIENT_ID', 'client-1')
    vi.stubEnv('VERCEL_OAUTH_CLIENT_SECRET', 'secret-1')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
  })
  afterEach(() => { global.fetch = originalFetch })

  it('exchanges a code for a token, computing an absolute expiresAt from expires_in', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'))
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok_abc', refresh_token: 'refresh_abc', expires_in: 3600, token_type: 'Bearer' }),
    }) as any

    const { exchangeOAuthCode } = await import('./oauth-token-exchange.js')
    const result = await exchangeOAuthCode('vercel', 'auth-code-123')
    expect(result).toEqual({
      accessToken: 'tok_abc',
      refreshToken: 'refresh_abc',
      expiresAt: new Date('2026-07-11T01:00:00Z').getTime(),
      tokenType: 'Bearer',
    })
    vi.useRealTimers()
  })

  it('handles a long-lived token with no expires_in (expiresAt: null)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok_abc', token_type: 'Bearer' }),
    }) as any
    const { exchangeOAuthCode } = await import('./oauth-token-exchange.js')
    const result = await exchangeOAuthCode('vercel', 'auth-code-123')
    expect(result?.expiresAt).toBeNull()
    expect(result?.refreshToken).toBeNull()
  })

  it('returns null (never throws) on a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 }) as any
    const { exchangeOAuthCode } = await import('./oauth-token-exchange.js')
    const result = await exchangeOAuthCode('vercel', 'bad-code')
    expect(result).toBeNull()
  })

  it('returns null (never throws) on a network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any
    const { exchangeOAuthCode } = await import('./oauth-token-exchange.js')
    const result = await exchangeOAuthCode('vercel', 'auth-code-123')
    expect(result).toBeNull()
  })

  it('posts form-encoded body with grant_type=authorization_code and client credentials', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'tok_abc' }) }) as any
    const { exchangeOAuthCode } = await import('./oauth-token-exchange.js')
    await exchangeOAuthCode('vercel', 'auth-code-123')
    const [calledUrl, calledOptions] = (global.fetch as any).mock.calls[0]
    expect(calledUrl).toBe('https://api.vercel.com/v2/oauth/access_token')
    const body = new URLSearchParams(calledOptions.body as string)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('auth-code-123')
    expect(body.get('client_id')).toBe('client-1')
    expect(body.get('client_secret')).toBe('secret-1')
  })
})

describe('refreshOAuthToken', () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('POSTHOG_OAUTH_CLIENT_ID', 'client-2')
    vi.stubEnv('POSTHOG_OAUTH_CLIENT_SECRET', 'secret-2')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
  })
  afterEach(() => { global.fetch = originalFetch })

  it('posts grant_type=refresh_token with the supplied refresh token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new_tok', refresh_token: 'new_refresh', expires_in: 3600, token_type: 'Bearer' }),
    }) as any
    const { refreshOAuthToken } = await import('./oauth-token-exchange.js')
    const result = await refreshOAuthToken('posthog', 'old_refresh_tok')
    expect(result?.accessToken).toBe('new_tok')
    const [, calledOptions] = (global.fetch as any).mock.calls[0]
    const body = new URLSearchParams(calledOptions.body as string)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('old_refresh_tok')
  })

  it('returns null (never throws) on failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as any
    const { refreshOAuthToken } = await import('./oauth-token-exchange.js')
    const result = await refreshOAuthToken('posthog', 'bad_refresh_tok')
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arete/webhook exec vitest run src/oauth/oauth-token-exchange.test.ts`
Expected: FAIL — cannot find module `./oauth-token-exchange.js`

- [ ] **Step 3: Implement**

```typescript
// packages/webhook/src/oauth/oauth-token-exchange.ts
import { getOAuthProviderConfig } from './oauth-provider-config.js'

export interface OAuthTokenResult {
  accessToken: string
  refreshToken: string | null
  /** Absolute epoch ms, or null for a long-lived token with no expiry (e.g. Vercel). */
  expiresAt: number | null
  tokenType: string
}

interface RawTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
}

function toResult(raw: RawTokenResponse): OAuthTokenResult {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresAt: typeof raw.expires_in === 'number' ? Date.now() + raw.expires_in * 1000 : null,
    tokenType: raw.token_type ?? 'Bearer',
  }
}

async function postToken(
  provider: 'vercel' | 'posthog',
  bodyParams: Record<string, string>
): Promise<OAuthTokenResult | null> {
  const config = getOAuthProviderConfig(provider)
  const body = new URLSearchParams({
    ...bodyParams,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  })

  try {
    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) return null
    const raw = (await res.json()) as RawTokenResponse
    if (!raw.access_token) return null
    return toResult(raw)
  } catch {
    return null
  }
}

/** Never throws — a failed exchange resolves to null so the callback
 * handler can show a clean "connection failed" state rather than crash. */
export async function exchangeOAuthCode(
  provider: 'vercel' | 'posthog',
  code: string
): Promise<OAuthTokenResult | null> {
  const config = getOAuthProviderConfig(provider)
  return postToken(provider, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  })
}

/** Never throws — a failed refresh resolves to null; the caller (the
 * telemetry fetch layer) treats this the same as any other connector
 * error: skip this connector, review proceeds. */
export async function refreshOAuthToken(
  provider: 'vercel' | 'posthog',
  refreshToken: string
): Promise<OAuthTokenResult | null> {
  return postToken(provider, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arete/webhook exec vitest run src/oauth/oauth-token-exchange.test.ts`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add packages/webhook/src/oauth/oauth-token-exchange.ts packages/webhook/src/oauth/oauth-token-exchange.test.ts
git commit -m "feat(webhook): add OAuth authorization-code exchange and refresh"
```

---

### Task 4: Callback handler + auto-refreshing credential retrieval

**Files:**
- Create: `packages/webhook/src/oauth/oauth-callback-handler.ts`
- Create: `packages/webhook/src/oauth/oauth-callback-handler.test.ts`
- Create: `packages/webhook/src/oauth/get-valid-oauth-token.ts`
- Create: `packages/webhook/src/oauth/get-valid-oauth-token.test.ts`

**Interfaces:**
- Consumes: `verifyOAuthState` (Task 1), `exchangeOAuthCode`/`refreshOAuthToken`/`OAuthTokenResult` (Task 3), `encryptCredentials`/`decryptCredentials` (existing), `prisma` (existing `../db.js`).
- Produces: `handleOAuthCallback(req: Request, res: Response): Promise<void>` (Express handler); `getValidOAuthAccessToken(installationId: string, provider: 'vercel' | 'posthog'): Promise<string | null>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/webhook/src/oauth/oauth-callback-handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeReqRes(query: Record<string, string>) {
  const req = { params: { provider: 'vercel' }, query } as any
  const statusCalls: number[] = []
  const res = {
    status: vi.fn((code: number) => { statusCalls.push(code); return res }),
    send: vi.fn(),
    redirect: vi.fn(),
  } as any
  return { req, res, statusCalls }
}

describe('handleOAuthCallback', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('VERCEL_OAUTH_CLIENT_ID', 'client-1')
    vi.stubEnv('VERCEL_OAUTH_CLIENT_SECRET', 'secret-1')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
    vi.stubEnv('TELEMETRY_ENCRYPTION_KEY', 'a'.repeat(64))
  })

  it('rejects a request with an invalid/missing state', async () => {
    const { handleOAuthCallback } = await import('./oauth-callback-handler.js')
    const { req, res } = makeReqRes({ code: 'auth-code', state: 'garbage' })
    await handleOAuthCallback(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('exchanges the code, encrypts, and upserts a TelemetryConnection row on success', async () => {
    vi.doMock('./oauth-token-exchange.js', () => ({
      exchangeOAuthCode: vi.fn().mockResolvedValue({
        accessToken: 'tok_abc', refreshToken: 'refresh_abc', expiresAt: 1234567890, tokenType: 'Bearer',
      }),
    }))
    const upsertMock = vi.fn().mockResolvedValue({})
    vi.doMock('../db.js', () => ({ prisma: { telemetryConnection: { upsert: upsertMock } } }))

    const { signOAuthState } = await import('./oauth-state.js')
    const { handleOAuthCallback } = await import('./oauth-callback-handler.js')
    const state = signOAuthState('inst-123', 'vercel')
    const { req, res } = makeReqRes({ code: 'auth-code', state })

    await handleOAuthCallback(req, res)

    expect(upsertMock).toHaveBeenCalledTimes(1)
    const call = upsertMock.mock.calls[0][0]
    expect(call.where).toEqual({ installationId_provider: { installationId: 'inst-123', provider: 'vercel' } })
    expect(call.create.authMethod).toBe('oauth')
    expect(res.redirect).toHaveBeenCalled()
  })

  it('shows a clean failure response when token exchange fails, without throwing', async () => {
    vi.doMock('./oauth-token-exchange.js', () => ({ exchangeOAuthCode: vi.fn().mockResolvedValue(null) }))
    const { signOAuthState } = await import('./oauth-state.js')
    const { handleOAuthCallback } = await import('./oauth-callback-handler.js')
    const state = signOAuthState('inst-123', 'vercel')
    const { req, res } = makeReqRes({ code: 'auth-code', state })

    await handleOAuthCallback(req, res)
    expect(res.status).toHaveBeenCalledWith(502)
  })
})
```

```typescript
// packages/webhook/src/oauth/get-valid-oauth-token.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('getValidOAuthAccessToken', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('VERCEL_OAUTH_CLIENT_ID', 'client-1')
    vi.stubEnv('VERCEL_OAUTH_CLIENT_SECRET', 'secret-1')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
    vi.stubEnv('TELEMETRY_ENCRYPTION_KEY', 'a'.repeat(64))
  })

  it('returns the stored access token directly when not expired', async () => {
    const { encryptCredentials } = await import('../telemetry/credentials.js')
    const farFuture = Date.now() + 60 * 60 * 1000
    const stored = encryptCredentials({ accessToken: 'still_valid', refreshToken: 'r1', expiresAt: farFuture, tokenType: 'Bearer' })

    vi.doMock('../db.js', () => ({
      prisma: {
        telemetryConnection: {
          findUnique: vi.fn().mockResolvedValue({ credentials: stored, authMethod: 'oauth' }),
          update: vi.fn(),
        },
      },
    }))

    const { getValidOAuthAccessToken } = await import('./get-valid-oauth-token.js')
    const token = await getValidOAuthAccessToken('inst-123', 'vercel')
    expect(token).toBe('still_valid')
  })

  it('refreshes and persists a new token when the stored one is expired', async () => {
    const { encryptCredentials } = await import('../telemetry/credentials.js')
    const past = Date.now() - 1000
    const stored = encryptCredentials({ accessToken: 'expired_tok', refreshToken: 'r1', expiresAt: past, tokenType: 'Bearer' })

    const updateMock = vi.fn().mockResolvedValue({})
    vi.doMock('../db.js', () => ({
      prisma: {
        telemetryConnection: {
          findUnique: vi.fn().mockResolvedValue({ credentials: stored, authMethod: 'oauth' }),
          update: updateMock,
        },
      },
    }))
    vi.doMock('./oauth-token-exchange.js', () => ({
      refreshOAuthToken: vi.fn().mockResolvedValue({
        accessToken: 'refreshed_tok', refreshToken: 'r2', expiresAt: Date.now() + 3600_000, tokenType: 'Bearer',
      }),
    }))

    const { getValidOAuthAccessToken } = await import('./get-valid-oauth-token.js')
    const token = await getValidOAuthAccessToken('inst-123', 'vercel')
    expect(token).toBe('refreshed_tok')
    expect(updateMock).toHaveBeenCalledTimes(1)
  })

  it('returns null (never throws) when no connection exists', async () => {
    vi.doMock('../db.js', () => ({
      prisma: { telemetryConnection: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() } },
    }))
    const { getValidOAuthAccessToken } = await import('./get-valid-oauth-token.js')
    const token = await getValidOAuthAccessToken('inst-123', 'vercel')
    expect(token).toBeNull()
  })

  it('returns null (never throws) when refresh fails', async () => {
    const { encryptCredentials } = await import('../telemetry/credentials.js')
    const past = Date.now() - 1000
    const stored = encryptCredentials({ accessToken: 'expired_tok', refreshToken: 'r1', expiresAt: past, tokenType: 'Bearer' })
    vi.doMock('../db.js', () => ({
      prisma: { telemetryConnection: { findUnique: vi.fn().mockResolvedValue({ credentials: stored, authMethod: 'oauth' }), update: vi.fn() } },
    }))
    vi.doMock('./oauth-token-exchange.js', () => ({ refreshOAuthToken: vi.fn().mockResolvedValue(null) }))

    const { getValidOAuthAccessToken } = await import('./get-valid-oauth-token.js')
    const token = await getValidOAuthAccessToken('inst-123', 'vercel')
    expect(token).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arete/webhook exec vitest run src/oauth/oauth-callback-handler.test.ts src/oauth/get-valid-oauth-token.test.ts`
Expected: FAIL — modules don't exist yet

- [ ] **Step 3: Implement**

```typescript
// packages/webhook/src/oauth/oauth-callback-handler.ts
import type { Request, Response } from 'express'
import { verifyOAuthState } from './oauth-state.js'
import { exchangeOAuthCode } from './oauth-token-exchange.js'
import { encryptCredentials } from '../telemetry/credentials.js'
import { prisma } from '../db.js'

/**
 * Express handler for GET /oauth/:provider/callback. Validates the signed
 * CSRF state, exchanges the authorization code for tokens, and upserts an
 * OAuth-mode TelemetryConnection row — the same table and encryption path
 * the existing API-key connectors use, just with a different credentials
 * shape and authMethod: 'oauth'.
 */
export async function handleOAuthCallback(req: Request, res: Response): Promise<void> {
  const { code, state } = req.query as { code?: string; state?: string }

  if (!state || typeof state !== 'string') {
    res.status(400).send('Invalid or missing state')
    return
  }
  const verified = verifyOAuthState(state)
  if (!verified) {
    res.status(400).send('Invalid or expired state')
    return
  }

  if (!code || typeof code !== 'string') {
    res.status(400).send('Missing authorization code')
    return
  }

  const provider = verified.provider as 'vercel' | 'posthog'
  const tokenResult = await exchangeOAuthCode(provider, code)
  if (!tokenResult) {
    res.status(502).send('Failed to complete the connection. Please try again.')
    return
  }

  const credentials = encryptCredentials({
    accessToken: tokenResult.accessToken,
    refreshToken: tokenResult.refreshToken,
    expiresAt: tokenResult.expiresAt,
    tokenType: tokenResult.tokenType,
  })

  await prisma.telemetryConnection.upsert({
    where: { installationId_provider: { installationId: verified.installationId, provider } },
    create: { installationId: verified.installationId, provider, authMethod: 'oauth', config: {}, credentials },
    update: { authMethod: 'oauth', credentials },
  })

  res.redirect('/settings/connections?connected=' + provider)
}
```

```typescript
// packages/webhook/src/oauth/get-valid-oauth-token.ts
import { refreshOAuthToken } from './oauth-token-exchange.js'
import { encryptCredentials, decryptCredentials } from '../telemetry/credentials.js'
import { prisma } from '../db.js'

interface StoredOAuthCredentials {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  tokenType: string
}

// Refresh this many ms before actual expiry, so an in-flight API call
// never races a token that expires mid-request.
const REFRESH_SKEW_MS = 60_000

/**
 * Returns a valid (non-expired) OAuth access token for an installation's
 * connector, transparently refreshing and persisting a new one if the
 * stored token is at or near expiry. Never throws — any failure (no
 * connection, refresh rejected, decrypt error) resolves to null, matching
 * the telemetry connectors' "skip this connector, review proceeds"
 * contract.
 */
export async function getValidOAuthAccessToken(
  installationId: string,
  provider: 'vercel' | 'posthog'
): Promise<string | null> {
  try {
    const connection = await prisma.telemetryConnection.findUnique({
      where: { installationId_provider: { installationId, provider } },
    })
    if (!connection || connection.authMethod !== 'oauth') return null

    const stored = decryptCredentials<StoredOAuthCredentials>(connection.credentials)

    const isExpired = stored.expiresAt !== null && Date.now() >= stored.expiresAt - REFRESH_SKEW_MS
    if (!isExpired) return stored.accessToken

    if (!stored.refreshToken) return null
    const refreshed = await refreshOAuthToken(provider, stored.refreshToken)
    if (!refreshed) return null

    const newCredentials = encryptCredentials({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? stored.refreshToken,
      expiresAt: refreshed.expiresAt,
      tokenType: refreshed.tokenType,
    })
    await prisma.telemetryConnection.update({
      where: { installationId_provider: { installationId, provider } },
      data: { credentials: newCredentials },
    })

    return refreshed.accessToken
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arete/webhook exec vitest run src/oauth/oauth-callback-handler.test.ts src/oauth/get-valid-oauth-token.test.ts`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add packages/webhook/src/oauth/oauth-callback-handler.ts packages/webhook/src/oauth/oauth-callback-handler.test.ts packages/webhook/src/oauth/get-valid-oauth-token.ts packages/webhook/src/oauth/get-valid-oauth-token.test.ts
git commit -m "feat(webhook): add OAuth callback handler and auto-refreshing token retrieval"
```

---

### Task 5: Wire Express routes + integration test

**Files:**
- Modify: `packages/webhook/src/server.ts`
- Create: `packages/webhook/src/oauth/oauth-routes.integration.test.ts`

**Interfaces:**
- Consumes: `buildOAuthAuthorizeUrl` (Task 2), `handleOAuthCallback` (Task 4).

Read the CURRENT full content of `server.ts` before editing — it has existing route registrations (`/stripe-webhook`, `/gitlab-webhook`, the GitHub webhook middleware, `/health`). Add the two new OAuth routes alongside them without disturbing anything existing.

- [ ] **Step 1: Write the failing integration test**

```typescript
// packages/webhook/src/oauth/oauth-routes.integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

describe('OAuth routes', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('GITHUB_APP_ID', '12345')
    vi.stubEnv('GITHUB_PRIVATE_KEY', 'dummy')
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'dummy')
    vi.stubEnv('VERCEL_OAUTH_CLIENT_ID', 'client-1')
    vi.stubEnv('VERCEL_OAUTH_CLIENT_SECRET', 'secret-1')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
    vi.stubEnv('TELEMETRY_ENCRYPTION_KEY', 'a'.repeat(64))
  })

  it('GET /oauth/vercel/authorize redirects to the Vercel consent screen', async () => {
    const { createServer } = await import('../server.js')
    const app = await createServer()
    const res = await request(app).get('/oauth/vercel/authorize?installationId=inst-123')
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('vercel.com')
  })

  it('GET /oauth/vercel/callback with an invalid state returns 400', async () => {
    const { createServer } = await import('../server.js')
    const app = await createServer()
    const res = await request(app).get('/oauth/vercel/callback?code=x&state=garbage')
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arete/webhook exec vitest run src/oauth/oauth-routes.integration.test.ts`
Expected: FAIL — 404s, since the routes don't exist yet

- [ ] **Step 3: Implement**

In `packages/webhook/src/server.ts`, add two imports and two routes (placed alongside the other route registrations, before `server.get('/health', ...)`):

```typescript
import { buildOAuthAuthorizeUrl } from './oauth/build-authorize-url.js'
import { handleOAuthCallback } from './oauth/oauth-callback-handler.js'
```

```typescript
  server.get('/oauth/:provider/authorize', (req, res) => {
    const installationId = req.query.installationId as string | undefined
    if (!installationId) {
      res.status(400).send('Missing installationId query parameter')
      return
    }
    const provider = req.params.provider as 'vercel' | 'posthog'
    const url = buildOAuthAuthorizeUrl(provider, installationId)
    res.redirect(url)
  })

  server.get('/oauth/:provider/callback', handleOAuthCallback)
```

(These two `server.get(...)` calls are the only addition — every existing route registration and the webhook middleware mount stay exactly as they are in the current file.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arete/webhook exec vitest run src/oauth/oauth-routes.integration.test.ts && pnpm --filter @arete/webhook exec tsc --noEmit`
Expected: 2 passed, typecheck clean

- [ ] **Step 5: Run the full webhook suite and commit**

Run: `pnpm --filter @arete/webhook test`
Expected: all pass (baseline 146 + new OAuth tests from Tasks 1-5)

```bash
git add packages/webhook/src/server.ts packages/webhook/src/oauth/oauth-routes.integration.test.ts
git commit -m "feat(webhook): wire OAuth authorize and callback routes into the server"
```

---

## After all 5 tasks

Run `pnpm --filter @arete/webhook test` one final time to confirm the full engine composes cleanly. Python side is untouched — no Python test run needed.

**Not in scope for this plan (tracked separately):**
- Actual Vercel/PostHog OAuth app registration (requires the user's action in each provider's developer console — this plan builds the engine that consumes those credentials, not the credentials themselves).
- Wiring `getValidOAuthAccessToken` into the Vercel/PostHog telemetry connectors' dispatch (`fetch-telemetry-context.ts`) so an OAuth-connected installation actually uses OAuth instead of an API key — this is the natural next task once real credentials exist to test against, since it changes `fetchOneConnector`'s branching logic per provider based on `TelemetryConnection.authMethod`.
- A dashboard "Connect" button UI — the other in-flight dashboard-UI branch should land first (per the earlier coordination check), and this plan only builds the backend routes it would call.
- Sentry OAuth (pending Sentry's own review/publication process) and Stripe (API-key-only per Stripe's own guidance) — neither uses this engine per the earlier research.
