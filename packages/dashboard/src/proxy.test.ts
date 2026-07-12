import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';

// Real NextAuth config + real `auth` wrapper, driven exactly as proxy.ts
// wires it up — this proves the actual redirect behavior an unauthenticated
// browser hits, not a mock of it. AUTH_SECRET / OAuth client env vars just
// need to be present (any value) for NextAuth to initialize; no network
// call happens for a request with no session cookie.
beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-not-for-production-0123456789';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
});

// NextAuth's `auth` wrapper types itself for the middleware/route-handler
// call shapes, not a direct `(NextRequest) => Response` invocation — but
// that IS how Next.js's proxy runtime invokes it. Narrow once here.
async function runProxy(request: NextRequest): Promise<Response | undefined> {
  const { proxy } = await import('./proxy');
  const run = proxy as unknown as (req: NextRequest) => Promise<Response | undefined>;
  return run(request);
}

describe('proxy: unauthenticated access', () => {
  it('redirects an unauthenticated request to a protected path (/overview) to /login', async () => {
    const request = new NextRequest(new URL('https://dashboard.example.com/overview'));

    const response = await runProxy(request);

    expect(response).toBeDefined();
    expect(response!.status).toBeGreaterThanOrEqual(300);
    expect(response!.status).toBeLessThan(400);
    const location = response!.headers.get('location');
    expect(location).toContain('/login');
  });

  it('does NOT redirect a request to the public /login path itself', async () => {
    const request = new NextRequest(new URL('https://dashboard.example.com/login'));

    const response = await runProxy(request);

    // NextResponse.next() carries no Location header / redirect status.
    expect(response?.headers.get('location')).toBeFalsy();
  });

  it('does NOT redirect a request to the public /signup path', async () => {
    const request = new NextRequest(new URL('https://dashboard.example.com/signup'));

    const response = await runProxy(request);

    // /signup must stay public — an anonymous visitor has to be able to
    // create an account.
    expect(response?.headers.get('location')).toBeFalsy();
  });

  it('redirects an unauthenticated request to /connections to /login', async () => {
    const request = new NextRequest(new URL('https://dashboard.example.com/connections'));

    const response = await runProxy(request);

    expect(response?.headers.get('location')).toContain('/login');
  });

  it('does NOT redirect a request to the public marketing landing page (/)', async () => {
    const request = new NextRequest(new URL('https://dashboard.example.com/'));

    const response = await runProxy(request);

    // "/" is the public marketing page now — an anonymous visitor must be
    // able to land on it directly, unlike every other route.
    expect(response?.headers.get('location')).toBeFalsy();
  });
});
