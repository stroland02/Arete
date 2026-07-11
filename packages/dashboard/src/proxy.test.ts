import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';

// Real NextAuth config + real `auth` wrapper, driven exactly as proxy.ts
// wires it up — this proves the actual redirect behavior an unauthenticated
// browser hits, not a mock of it. AUTH_SECRET / OAuth client env vars just
// need to be present (any value) for NextAuth to initialize; no network
// call happens for a request with no session cookie.
beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-not-for-production-0123456789';
  process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client-id';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-client-secret';
  // lib/auth.ts transitively imports lib/db.ts, which guards on this being
  // set; the proxy's authorized() check never actually queries the db.
  process.env.DATABASE_URL ??= 'postgresql://arete:arete@localhost:5432/arete';
});

describe('proxy: unauthenticated access', () => {
  it('redirects an unauthenticated request to a protected path to /login', async () => {
    const { proxy } = await import('./proxy');
    const request = new NextRequest(new URL('https://dashboard.example.com/'));

    const response = await proxy(request);

    expect(response).toBeDefined();
    expect(response!.status).toBeGreaterThanOrEqual(300);
    expect(response!.status).toBeLessThan(400);
    const location = response!.headers.get('location');
    expect(location).toContain('/login');
  });

  it('does NOT redirect a request to the public /login path itself', async () => {
    const { proxy } = await import('./proxy');
    const request = new NextRequest(new URL('https://dashboard.example.com/login'));

    const response = await proxy(request);

    // NextResponse.next() carries no Location header / redirect status.
    expect(response?.headers.get('location')).toBeFalsy();
  });
});
