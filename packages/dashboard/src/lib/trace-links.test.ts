import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { traceUrl } from './trace-links';

// Env is mutated per case and restored, the lib/errors.test.ts convention.
const ORIGINAL = process.env.NEXT_PUBLIC_JAEGER_UI_URL;

function setBase(value: string | undefined): void {
  if (value === undefined) delete process.env.NEXT_PUBLIC_JAEGER_UI_URL;
  else process.env.NEXT_PUBLIC_JAEGER_UI_URL = value;
}

beforeEach(() => {
  setBase(undefined);
});

afterAll(() => {
  setBase(ORIGINAL);
});

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

describe('traceUrl', () => {
  it('builds the Jaeger deep-link when both the base and the id are real', () => {
    setBase('http://localhost:16686');
    expect(traceUrl(TRACE)).toBe(`http://localhost:16686/trace/${TRACE}`);
  });

  it('returns null when the Jaeger base URL is not configured', () => {
    // The honesty case: no configured backend => no link at all, so the UI
    // renders nothing rather than an anchor that cannot open a trace.
    expect(traceUrl(TRACE)).toBeNull();
  });

  it('returns null for a blank base URL', () => {
    setBase('   ');
    expect(traceUrl(TRACE)).toBeNull();
  });

  it('returns null for a null, undefined or blank trace id', () => {
    setBase('http://localhost:16686');
    expect(traceUrl(null)).toBeNull();
    expect(traceUrl(undefined)).toBeNull();
    expect(traceUrl('')).toBeNull();
    expect(traceUrl('   ')).toBeNull();
    // Never a link to a base-less /trace/ — that would 404 into Jaeger.
    expect(traceUrl('')).not.toBe('http://localhost:16686/trace/');
  });

  it('normalizes a trailing slash on the base', () => {
    setBase('http://localhost:16686/');
    expect(traceUrl(TRACE)).toBe(`http://localhost:16686/trace/${TRACE}`);
    setBase('http://localhost:16686///');
    expect(traceUrl(TRACE)).toBe(`http://localhost:16686/trace/${TRACE}`);
  });

  it('accepts https bases and preserves a path prefix', () => {
    setBase('https://jaeger.internal.example.com/ui/');
    expect(traceUrl(TRACE)).toBe(`https://jaeger.internal.example.com/ui/trace/${TRACE}`);
  });

  it('rejects a non-http(s) base', () => {
    // Defensive: a javascript: base would flow straight into an href.
    setBase('javascript:alert(1)');
    expect(traceUrl(TRACE)).toBeNull();
    setBase('file:///etc/passwd');
    expect(traceUrl(TRACE)).toBeNull();
    setBase('ftp://example.com');
    expect(traceUrl(TRACE)).toBeNull();
  });

  it('rejects an unparseable base', () => {
    setBase('not a url');
    expect(traceUrl(TRACE)).toBeNull();
  });

  it('trims the id and encodes it into the path segment', () => {
    setBase('http://localhost:16686');
    expect(traceUrl(`  ${TRACE}  `)).toBe(`http://localhost:16686/trace/${TRACE}`);
    expect(traceUrl('a/b?c#d')).toBe('http://localhost:16686/trace/a%2Fb%3Fc%23d');
  });
});
