// "Test ping" for a model connection: does this {provider, model, apiKey, baseUrl}
// actually authenticate? Used by saveModelConnection so a bad key is never
// persisted, and (behind the dashboard's session) by an explicit "Test" button.
//
// The outbound call goes through net-guard's webhookFetch by default, so a
// customer-supplied baseUrl is resolved + checked against the SSRF deny-set and
// pinned — a connection can't be used to probe internal/cloud-metadata addresses.
// Every failure mode (non-2xx, transport error, SSRF rejection) collapses to a
// { ok: false, detail } verdict; this function never throws.

import { webhookFetch } from '@arete/net-guard'

export interface TestConnectionCandidate {
  provider: string
  model: string
  apiKey: string
  baseUrl: string | null
}

/** Minimal response shape we need — satisfied by both a global Response and
 *  net-guard's webhookFetch return value. */
interface FetchResponse {
  ok: boolean
  status: number
  statusText: string
}

export interface TestConnectionDeps {
  fetch(url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal; allowLoopback?: boolean }): Promise<FetchResponse>
}

export type TestResult = { ok: true } | { ok: false; detail: string }

interface ProviderProbe {
  /** Default API root when the connection carries no custom baseUrl. */
  defaultBaseUrl: string | null
  /** Path appended to the base to cheaply list models / validate the key. */
  path: string
  headers(apiKey: string): Record<string, string>
}

const PROVIDERS: Record<string, ProviderProbe> = {
  openai: {
    defaultBaseUrl: 'https://api.openai.com/v1',
    path: '/models',
    headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  },
  anthropic: {
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    path: '/models',
    headers: (apiKey) => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }),
  },
  // Local Ollama companion: no auth, and it exposes /api/version (NOT the
  // OpenAI-shaped /models the GENERIC probe would use). Default to IPv4
  // 127.0.0.1 — `localhost` resolves to ::1 first, which Ollama doesn't bind.
  // The function body passes allowLoopback so net-guard permits the loopback
  // companion (cloud metadata stays blocked) — the fix integration-preview
  // lacked, so its localhost/api/tags probe was still SSRF-blocked.
  ollama: {
    defaultBaseUrl: 'http://127.0.0.1:11434',
    path: '/api/version',
    headers: () => ({}),
  },
}

/** Unknown providers fall back to an OpenAI-compatible bearer probe, but only if
 *  the connection supplies a baseUrl to target (there is no default endpoint). */
const GENERIC: Omit<ProviderProbe, 'defaultBaseUrl'> = {
  path: '/models',
  headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
}

const defaultDeps: TestConnectionDeps = {
  fetch: (url, init) => webhookFetch(url, init) as unknown as Promise<FetchResponse>,
}

export async function testModelConnection(
  candidate: TestConnectionCandidate,
  deps: TestConnectionDeps = defaultDeps,
): Promise<TestResult> {
  const probe = PROVIDERS[candidate.provider]
  const rawBase = candidate.baseUrl ?? probe?.defaultBaseUrl ?? null
  if (rawBase === null) {
    return { ok: false, detail: `unknown provider "${candidate.provider}" requires a baseUrl` }
  }
  const isOllama = candidate.provider === 'ollama'
  // Ollama is the local self-hosted companion — loopback/LAN by nature. Allow
  // it past the SSRF loopback deny (cloud metadata stays blocked in net-guard),
  // and normalize `localhost` -> IPv4 127.0.0.1 (Ollama binds IPv4 only).
  const base = isOllama ? rawBase.replace(/\/\/localhost(:|\/|$)/, '//127.0.0.1$1') : rawBase
  const path = (probe ?? GENERIC).path
  const headers = (probe ?? GENERIC).headers(candidate.apiKey)
  const url = `${base.replace(/\/+$/, '')}${path}`

  try {
    const res = await deps.fetch(url, { method: 'GET', headers, allowLoopback: isOllama })
    if (res.ok) return { ok: true }
    return { ok: false, detail: `${res.status} ${res.statusText}`.trim() }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}
