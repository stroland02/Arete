import { describe, it, expect } from 'vitest';
import { classifyTestOutcome, toView } from './model-connections-map';

describe('classifyTestOutcome → status the AI-Models client maps', () => {
  it('ok → 200 { ok:true, model } (connected)', () => {
    expect(classifyTestOutcome({ ok: true, model: 'gpt-4o' })).toEqual({
      status: 200,
      body: { ok: true, model: 'gpt-4o' },
    });
  });

  it('a rejected credential → 401 (unauthorized)', () => {
    expect(classifyTestOutcome({ ok: false, detail: '401 Unauthorized' }).status).toBe(401);
    expect(classifyTestOutcome({ ok: false, detail: 'invalid api key' }).status).toBe(401);
  });

  it('a transport / SSRF / host-down detail → 503 (unreachable)', () => {
    expect(classifyTestOutcome({ ok: false, detail: 'unreachable: could not reach probe service' }).status).toBe(503);
    expect(classifyTestOutcome({ ok: false, detail: 'blocked private address' }).status).toBe(503);
    expect(classifyTestOutcome({ ok: false, detail: 'fetch failed' }).status).toBe(503);
  });

  it('any other failure → 200 { ok:false } (failed, not a phantom connect)', () => {
    const out = classifyTestOutcome({ ok: false, detail: '500 model not found' });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: false, error: '500 model not found' });
  });
});

describe('toView', () => {
  it('projects a row to a key-free view with an ISO connectedAt', () => {
    const view = toView({
      id: 'mc_1',
      provider: 'openai',
      model: 'gpt-4o',
      createdAt: new Date('2026-07-16T10:00:00.000Z'),
    });
    expect(view).toEqual({ id: 'mc_1', provider: 'openai', model: 'gpt-4o', connectedAt: '2026-07-16T10:00:00.000Z' });
    // No secret material in the projection.
    expect(JSON.stringify(view)).not.toContain('apiKey');
  });
});
