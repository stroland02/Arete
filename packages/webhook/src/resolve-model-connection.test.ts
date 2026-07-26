import { describe, it, expect, vi } from 'vitest'
import {
  resolveModelConnectionForReview,
  type ResolveModelDeps,
} from './resolve-model-connection.js'

function fakeDeps(overrides: Partial<{
  installation: { id: string } | null
  connection: { provider: string; model: string; baseUrl: string | null; apiKeyEncrypted: string | null } | null
}> = {}) {
  const installationFindUnique = vi.fn().mockResolvedValue(
    'installation' in overrides ? overrides.installation : { id: 'inst_uuid_1' },
  )
  const modelConnectionFindFirst = vi.fn().mockResolvedValue(
    'connection' in overrides ? overrides.connection : null,
  )
  const decrypt = vi.fn((_c: string) => ({ apiKey: 'sk-DECRYPTED' }))
  const deps: ResolveModelDeps = {
    prisma: {
      installation: { findUnique: installationFindUnique },
      modelConnection: { findFirst: modelConnectionFindFirst },
    },
    decrypt,
  }
  return { deps, installationFindUnique, modelConnectionFindFirst, decrypt }
}

describe('resolveModelConnectionForReview → the agents /review `llm` block', () => {
  it('maps the numeric installation id to the tenant, then reads the tenant’s active connection scoped by the internal uuid', async () => {
    const { deps, installationFindUnique, modelConnectionFindFirst } = fakeDeps({
      connection: { provider: 'anthropic', model: 'claude-opus-4', baseUrl: null, apiKeyEncrypted: 'iv:tag:cipher' },
    })

    await resolveModelConnectionForReview(987654, deps)

    // numeric external id → Installation via the (provider, externalId) unique
    expect(installationFindUnique).toHaveBeenCalledWith({
      where: { provider_externalId: { provider: 'github', externalId: 987654 } },
      select: { id: true },
    })
    // connection read is scoped by the INTERNAL uuid, newest first (the active one)
    expect(modelConnectionFindFirst).toHaveBeenCalledWith({
      where: { installationId: 'inst_uuid_1' },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('decrypts the stored key and returns the llm block with apiKey + baseUrl', async () => {
    const { deps, decrypt } = fakeDeps({
      connection: { provider: 'anthropic', model: 'claude-opus-4', baseUrl: 'https://proxy/v1', apiKeyEncrypted: 'iv:tag:cipher' },
    })

    const llm = await resolveModelConnectionForReview(987654, deps)

    expect(decrypt).toHaveBeenCalledWith('iv:tag:cipher')
    expect(llm).toEqual({ provider: 'anthropic', model: 'claude-opus-4', apiKey: 'sk-DECRYPTED', baseUrl: 'https://proxy/v1' })
  })

  it('omits apiKey/baseUrl fields for a keyless connection (e.g. Ollama) rather than emitting nulls', async () => {
    const { deps, decrypt } = fakeDeps({
      connection: { provider: 'ollama', model: 'llama3', baseUrl: null, apiKeyEncrypted: null },
    })

    const llm = await resolveModelConnectionForReview(987654, deps)

    expect(decrypt).not.toHaveBeenCalled()
    expect(llm).toEqual({ provider: 'ollama', model: 'llama3' })
    // null fields are omitted, not serialized as null (the Pydantic model omits them)
    expect(llm && 'apiKey' in llm).toBe(false)
    expect(llm && 'baseUrl' in llm).toBe(false)
  })

  it('returns undefined when the tenant has no connection — caller omits llm, agents uses its own default', async () => {
    const { deps, modelConnectionFindFirst } = fakeDeps({ connection: null })

    const llm = await resolveModelConnectionForReview(987654, deps)

    expect(modelConnectionFindFirst).toHaveBeenCalled()
    expect(llm).toBeUndefined()
  })

  it('returns undefined (without touching connections) when the installation is unknown', async () => {
    const { deps, modelConnectionFindFirst } = fakeDeps({ installation: null })

    const llm = await resolveModelConnectionForReview(111, deps)

    expect(modelConnectionFindFirst).not.toHaveBeenCalled()
    expect(llm).toBeUndefined()
  })
})
