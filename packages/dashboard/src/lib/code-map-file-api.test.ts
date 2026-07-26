import { describe, it, expect } from 'vitest';
import { statusForFileResult, type FileContentEnvelope } from './code-map-file-api';

const ok: FileContentEnvelope = { ok: true, path: 'src/a.ts', text: 'x', truncated: false };

describe('statusForFileResult', () => {
  it('200 for readable content', () => {
    expect(statusForFileResult(ok)).toBe(200);
  });
  it('200 for binary/too_large (honest envelope, not an error page)', () => {
    expect(statusForFileResult({ ok: false, reason: 'binary' })).toBe(200);
    expect(statusForFileResult({ ok: false, reason: 'too_large' })).toBe(200);
  });
  it('400 for an invalid path', () => {
    expect(statusForFileResult({ ok: false, reason: 'invalid_path' })).toBe(400);
  });
  it('404 for a missing file', () => {
    expect(statusForFileResult({ ok: false, reason: 'not_found' })).toBe(404);
  });
  it('502 when the source service is unavailable', () => {
    expect(statusForFileResult({ ok: false, reason: 'unavailable' })).toBe(502);
  });
  it('502 for any unknown reason (fail conservative)', () => {
    expect(statusForFileResult({ ok: false, reason: 'whatever' as never })).toBe(502);
  });
});
