import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

const sendAgentChatMock = vi.fn();
vi.mock('@/lib/agent-chat', () => ({ sendAgentChat: (...a: any[]) => sendAgentChatMock(...a) }));

// The real resolver pulls in @/lib/db, which requires DATABASE_URL at import
// time; null means "agents service default", the same contract the route uses.
vi.mock('@/lib/model-connections-api', () => ({ resolveActiveLlmForChat: async () => null }));

import { POST } from './route';

function req(body: unknown) {
  return new Request('http://localhost/api/agents/security/chat', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }) as any;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  authMock.mockReset();
  sendAgentChatMock.mockReset();
});

describe('POST /api/agents/[id]/chat', () => {
  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(req({ message: 'hi' }), ctx('security'));
    expect(res.status).toBe(401);
  });

  it('400 for an unknown agent id', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    const res = await POST(req({ message: 'hi' }), ctx('not-an-agent'));
    expect(res.status).toBe(400);
  });

  it('400 for an empty message', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    const res = await POST(req({ message: '   ' }), ctx('security'));
    expect(res.status).toBe(400);
  });

  it('503 when the agents service is unavailable', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    sendAgentChatMock.mockRejectedValue(new Error('down'));
    const res = await POST(req({ message: 'hi' }), ctx('security'));
    expect(res.status).toBe(503);
  });

  it('200 with the upstream reply on success', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    sendAgentChatMock.mockResolvedValue('Here is my analysis.');
    const res = await POST(req({ message: 'hi' }), ctx('security'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: 'Here is my analysis.' });
  });
});
