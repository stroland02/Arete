import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createModelConnectionTestHandler } from './test-handler.js'

function appWith(run: any) {
  const app = express()
  app.post('/internal/model-connections/test', express.json(), createModelConnectionTestHandler(run))
  return app
}

describe('POST /internal/model-connections/test handler', () => {
  it('400s a body missing provider or model, without probing', async () => {
    const run = vi.fn()
    const res = await request(appWith(run)).post('/internal/model-connections/test').send({ provider: 'openai' })

    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('returns { ok: true, model } when the probe succeeds', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true })
    const res = await request(appWith(run))
      .post('/internal/model-connections/test')
      .send({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-live' })

    expect(run).toHaveBeenCalledWith({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-live', baseUrl: null })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, model: 'gpt-4o' })
  })

  it('returns { ok: false, detail } when the probe fails (bad key / unreachable)', async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, detail: '401 Unauthorized' })
    const res = await request(appWith(run))
      .post('/internal/model-connections/test')
      .send({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-bad' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: false, detail: '401 Unauthorized' })
  })

  it('passes a keyless Ollama candidate through with its baseUrl', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true })
    await request(appWith(run))
      .post('/internal/model-connections/test')
      .send({ provider: 'ollama', model: 'llama3.1', baseUrl: 'http://localhost:11434' })

    expect(run).toHaveBeenCalledWith({ provider: 'ollama', model: 'llama3.1', apiKey: '', baseUrl: 'http://localhost:11434' })
  })
})
