import { describe, it, expect, vi } from 'vitest'
import { testModelConnection, type TestConnectionDeps } from './test-connection.js'

// A fake fetch stands in for net-guard's webhookFetch (which the production path
// uses, so a customer-supplied baseUrl can't reach internal addresses). We assert
// the request the ping builds per provider and how responses map to a verdict.
function fakeFetch(response: { ok: boolean; status: number; statusText: string } | Error) {
  return vi.fn(async (_url: string, _init: { method: string; headers: Record<string, string> }) => {
    if (response instanceof Error) throw response
    return response
  })
}

describe('testModelConnection', () => {
  it('pings OpenAI /models with a Bearer key and reports ok on 200', async () => {
    const fetch = fakeFetch({ ok: true, status: 200, statusText: 'OK' })
    const deps: TestConnectionDeps = { fetch }

    const result = await testModelConnection(
      { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-live', baseUrl: null },
      deps,
    )

    expect(result).toEqual({ ok: true })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/models')
    expect((init as any).headers.Authorization).toBe('Bearer sk-live')
  })

  it('reports the provider error detail on a non-2xx (bad key → 401)', async () => {
    const fetch = fakeFetch({ ok: false, status: 401, statusText: 'Unauthorized' })

    const result = await testModelConnection(
      { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-bad', baseUrl: null },
      { fetch },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.detail).toContain('401')
  })

  it('uses Anthropic’s x-api-key + version headers (not Bearer)', async () => {
    const fetch = fakeFetch({ ok: true, status: 200, statusText: 'OK' })

    await testModelConnection(
      { provider: 'anthropic', model: 'claude-opus-4', apiKey: 'sk-ant', baseUrl: null },
      { fetch },
    )

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/models')
    expect((init as any).headers['x-api-key']).toBe('sk-ant')
    expect((init as any).headers['anthropic-version']).toBeTruthy()
    expect((init as any).headers.Authorization).toBeUndefined()
  })

  it('honours a custom baseUrl (self-hosted / proxy / Azure)', async () => {
    const fetch = fakeFetch({ ok: true, status: 200, statusText: 'OK' })

    await testModelConnection(
      { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-live', baseUrl: 'https://proxy.example.com/v1' },
      { fetch },
    )

    expect(fetch.mock.calls[0][0]).toBe('https://proxy.example.com/v1/models')
  })

  it('maps a transport/SSRF-guard rejection to a failed verdict instead of throwing', async () => {
    const fetch = fakeFetch(new Error('blocked private address'))

    const result = await testModelConnection(
      { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-live', baseUrl: 'http://169.254.169.254' },
      { fetch },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.detail).toContain('blocked private address')
  })

  it('probes keyless Ollama at /api/tags with no auth header (reachability = ok)', async () => {
    const fetch = fakeFetch({ ok: true, status: 200, statusText: 'OK' })

    const result = await testModelConnection(
      { provider: 'ollama', model: 'llama3.1', apiKey: '', baseUrl: null },
      { fetch },
    )

    expect(result).toEqual({ ok: true })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('http://localhost:11434/api/tags')
    expect((init as any).headers.Authorization).toBeUndefined()
  })

  it('refuses an unknown provider that has no baseUrl to target', async () => {
    const fetch = fakeFetch({ ok: true, status: 200, statusText: 'OK' })

    const result = await testModelConnection(
      { provider: 'mystery', model: 'x', apiKey: 'k', baseUrl: null },
      { fetch },
    )

    expect(result.ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})
