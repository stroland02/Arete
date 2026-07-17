import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  saveModelConnection,
  listModelConnections,
  getModelConnection,
  deleteModelConnection,
  type ModelConnectionStorePrisma,
} from './store.js'

// A 64-hex (32-byte) key so the REAL encrypt/decrypt scheme round-trips — the
// store encrypts through telemetry/credentials.ts (TELEMETRY_ENCRYPTION_KEY),
// exactly as the PM specified. We assert on ciphertext SHAPE, never a raw key.
const TEST_KEY = 'a'.repeat(64)

function fakePrisma() {
  const upsert = vi.fn()
  const findMany = vi.fn()
  const findUnique = vi.fn()
  const deleteMany = vi.fn()
  const prisma: ModelConnectionStorePrisma = {
    modelConnection: { upsert, findMany, findUnique, deleteMany },
  }
  return { prisma, upsert, findMany, findUnique, deleteMany }
}

describe('model-connection store (tenant-scoped)', () => {
  beforeEach(() => {
    process.env.TELEMETRY_ENCRYPTION_KEY = TEST_KEY
  })

  describe('saveModelConnection', () => {
    it('tests the key first, and on success encrypts + upserts scoped to the tenant, returning a key-free result', async () => {
      const { prisma, upsert } = fakePrisma()
      upsert.mockResolvedValue({
        id: 'mc_1',
        installationId: 'inst_1',
        provider: 'openai',
        model: 'gpt-4o',
        baseUrl: null,
        apiKeyEncrypted: 'iv:tag:cipher',
        createdAt: new Date('2026-07-16T00:00:00.000Z'),
      })
      const test = vi.fn().mockResolvedValue({ ok: true })

      const result = await saveModelConnection(
        prisma,
        { installationId: 'inst_1', provider: 'openai', model: 'gpt-4o', apiKey: 'sk-secret', baseUrl: null },
        { test },
      )

      // Test ran before any write.
      expect(test).toHaveBeenCalledWith({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-secret', baseUrl: null })
      // Upsert is scoped by the composite tenant+provider unique.
      expect(upsert).toHaveBeenCalledTimes(1)
      const arg = upsert.mock.calls[0][0]
      expect(arg.where).toEqual({ installationId_provider: { installationId: 'inst_1', provider: 'openai' } })
      // The stored key is CIPHERTEXT (iv:tag:cipher hex triplet), never the raw key.
      const stored = arg.create.apiKeyEncrypted as string
      expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/)
      expect(stored).not.toContain('sk-secret')
      // The returned result never carries a key field.
      expect(result).toEqual({ ok: true })
    })

    it('does NOT persist when the test ping fails — a bad key never reaches the DB', async () => {
      const { prisma, upsert } = fakePrisma()
      const test = vi.fn().mockResolvedValue({ ok: false, detail: '401 Unauthorized' })

      const result = await saveModelConnection(
        prisma,
        { installationId: 'inst_1', provider: 'openai', model: 'gpt-4o', apiKey: 'sk-bad', baseUrl: null },
        { test },
      )

      expect(upsert).not.toHaveBeenCalled()
      expect(result).toEqual({ ok: false, detail: '401 Unauthorized' })
    })

    it('persists a keyless connection (e.g. Ollama) without calling test when no apiKey is given', async () => {
      const { prisma, upsert } = fakePrisma()
      upsert.mockResolvedValue({
        id: 'mc_2',
        installationId: 'inst_1',
        provider: 'ollama',
        model: 'llama3',
        baseUrl: 'http://ollama.internal:11434',
        apiKeyEncrypted: null,
        createdAt: new Date('2026-07-16T00:00:00.000Z'),
      })
      const test = vi.fn().mockResolvedValue({ ok: true })

      const result = await saveModelConnection(
        prisma,
        { installationId: 'inst_1', provider: 'ollama', model: 'llama3', apiKey: null, baseUrl: 'http://ollama.internal:11434' },
        { test },
      )

      expect(test).not.toHaveBeenCalled()
      expect(upsert).toHaveBeenCalledTimes(1)
      expect(upsert.mock.calls[0][0].create.apiKeyEncrypted).toBeNull()
      expect(result).toEqual({ ok: true })
    })
  })

  describe('listModelConnections', () => {
    it('lists only the tenant’s rows as key-free views (hasApiKey flag, never the ciphertext)', async () => {
      const { prisma, findMany } = fakePrisma()
      findMany.mockResolvedValue([
        { id: 'mc_1', installationId: 'inst_1', provider: 'openai', model: 'gpt-4o', baseUrl: null, apiKeyEncrypted: 'iv:tag:cipher', createdAt: new Date('2026-07-16T00:00:00.000Z') },
        { id: 'mc_2', installationId: 'inst_1', provider: 'ollama', model: 'llama3', baseUrl: 'http://x:11434', apiKeyEncrypted: null, createdAt: new Date('2026-07-16T00:00:00.000Z') },
      ])

      const views = await listModelConnections(prisma, 'inst_1')

      expect(findMany).toHaveBeenCalledWith({ where: { installationId: 'inst_1' }, orderBy: { createdAt: 'asc' } })
      expect(views).toEqual([
        { id: 'mc_1', provider: 'openai', model: 'gpt-4o', baseUrl: null, hasApiKey: true, createdAt: new Date('2026-07-16T00:00:00.000Z') },
        { id: 'mc_2', provider: 'ollama', model: 'llama3', baseUrl: 'http://x:11434', hasApiKey: false, createdAt: new Date('2026-07-16T00:00:00.000Z') },
      ])
      // No leaked secret material anywhere in the serialized output.
      expect(JSON.stringify(views)).not.toContain('cipher')
    })
  })

  describe('getModelConnection', () => {
    it('reads one row scoped by tenant+provider, returning a key-free view', async () => {
      const { prisma, findUnique } = fakePrisma()
      findUnique.mockResolvedValue({ id: 'mc_1', installationId: 'inst_1', provider: 'openai', model: 'gpt-4o', baseUrl: null, apiKeyEncrypted: 'iv:tag:cipher', createdAt: new Date('2026-07-16T00:00:00.000Z') })

      const view = await getModelConnection(prisma, 'inst_1', 'openai')

      expect(findUnique).toHaveBeenCalledWith({ where: { installationId_provider: { installationId: 'inst_1', provider: 'openai' } } })
      expect(view).toEqual({ id: 'mc_1', provider: 'openai', model: 'gpt-4o', baseUrl: null, hasApiKey: true, createdAt: new Date('2026-07-16T00:00:00.000Z') })
    })

    it('returns null when the tenant has no such connection', async () => {
      const { prisma, findUnique } = fakePrisma()
      findUnique.mockResolvedValue(null)
      expect(await getModelConnection(prisma, 'inst_1', 'openai')).toBeNull()
    })
  })

  describe('deleteModelConnection', () => {
    it('deletes scoped by tenant+provider (deleteMany, so a foreign tenant id can never match) and reports whether a row went', async () => {
      const { prisma, deleteMany } = fakePrisma()
      deleteMany.mockResolvedValue({ count: 1 })

      const deleted = await deleteModelConnection(prisma, 'inst_1', 'openai')

      expect(deleteMany).toHaveBeenCalledWith({ where: { installationId: 'inst_1', provider: 'openai' } })
      expect(deleted).toBe(true)
    })

    it('reports false when nothing matched the tenant scope', async () => {
      const { prisma, deleteMany } = fakePrisma()
      deleteMany.mockResolvedValue({ count: 0 })
      expect(await deleteModelConnection(prisma, 'inst_1', 'openai')).toBe(false)
    })
  })
})
