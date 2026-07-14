import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendAgentChat } from './agent-chat';
import { AGENTS } from '@/components/dashboard/agents/agent-catalog';

const security = AGENTS.find((a) => a.id === 'security')!;

afterEach(() => { vi.unstubAllGlobals(); });

describe('sendAgentChat', () => {
  it('POSTs the message to the Python /chat endpoint and returns the reply', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ reply: 'Here is my analysis.' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const reply = await sendAgentChat({ agent: security, message: 'why is this risky?' });

    expect(reply).toBe('Here is my analysis.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/chat');
    expect(JSON.parse((init as any).body).user_reply).toBe('why is this risky?');
  });

  it('throws when the upstream returns a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(sendAgentChat({ agent: security, message: 'hi' })).rejects.toThrow();
  });
});
