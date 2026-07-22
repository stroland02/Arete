import { describe, it, expect } from 'vitest';
import { normalizeErrorMessage, fingerprintError } from './error-fingerprint';

describe('normalizeErrorMessage', () => {
  it('replaces urls, emails, uuids, timestamps, ips, hex, quoted strings and numbers', () => {
    expect(normalizeErrorMessage('see https://example.com/a?b=1 now')).toBe('see <url> now');
    expect(normalizeErrorMessage('user ops+kuma@example.com failed')).toBe('user <email> failed');
    expect(normalizeErrorMessage('req 3f2504e0-4f89-11d3-9a0c-0305e82c3301 died')).toBe(
      'req <uuid> died',
    );
    expect(normalizeErrorMessage('at 2026-07-21T21:01:31Z boom')).toBe('at <ts> boom');
    expect(normalizeErrorMessage('dial 10.0.0.14:8123 refused')).toBe('dial <ip> refused');
    expect(normalizeErrorMessage('addr 0xDEADBEEF invalid')).toBe('addr <hex> invalid');
    expect(normalizeErrorMessage('missing key "privateKey" here')).toBe('missing key <str> here');
    expect(normalizeErrorMessage("missing key 'privateKey' here")).toBe('missing key <str> here');
    expect(normalizeErrorMessage('retry 47 of 100')).toBe('retry <n> of <n>');
  });

  it('collapses whitespace and lowercases', () => {
    expect(normalizeErrorMessage('  Connection   RESET\n by peer  ')).toBe(
      'connection reset by peer',
    );
  });

  it('returns empty string for empty and whitespace-only input', () => {
    expect(normalizeErrorMessage('')).toBe('');
    expect(normalizeErrorMessage('   \n\t  ')).toBe('');
  });

  it('matches the webhook normalizer it once mirrored, rule for rule', () => {
    // packages/webhook/src/fingerprint.ts no longer applies its own copy of
    // this list — both now delegate to @arete/telemetry/fingerprint. The
    // assertion stays because it is what "the same rules in the same order"
    // means in observable terms.
    const raw = 'Failed https://x.io/y for 550e8400-e29b-41d4-a716-446655440000 after 3 tries';
    expect(normalizeErrorMessage(raw)).toBe('failed <url> for <uuid> after <n> tries');
  });
});

describe('read-time / emit-time agreement (telemetry-tenancy contract §5)', () => {
  // THE GATE. `lib/errors.ts` computes this fingerprint at READ time, over rows
  // already in ClickHouse. `@arete/telemetry`'s recordExceptionWithFingerprint
  // stamps `superlog.issue_fingerprint` at EMIT time, and the
  // superlog.otel_exceptions / superlog.issue_activity_daily projections group
  // on that stamped value. If the two ever disagree, one error becomes two
  // groups and "resolve these together" silently stops working.
  //
  // The same literal is asserted from the emit side in
  // packages/telemetry/src/record-exception.test.ts and over the shared
  // implementation in packages/telemetry/src/fingerprint.test.ts. It is
  // re-declared in each file on purpose: a shared constant could be updated
  // once and let all three drift together.
  const GOLDEN_SERVICE = 'arete-worker';
  const GOLDEN_MESSAGE =
    'checkout 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed at 2026-07-21T21:01:31Z after 3 tries';
  const GOLDEN_FINGERPRINT = '59cd230950082264';

  it('the read-time path produces the frozen golden fingerprint', () => {
    expect(fingerprintError(GOLDEN_SERVICE, GOLDEN_MESSAGE)).toBe(GOLDEN_FINGERPRINT);
  });
});

describe('fingerprintError', () => {
  it('produces a 16-char lowercase hex digest', () => {
    expect(fingerprintError('arete-worker', 'boom')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic', () => {
    expect(fingerprintError('arete-worker', 'boom')).toBe(fingerprintError('arete-worker', 'boom'));
  });

  it('groups the same failure across differing uuids, numbers, urls and timestamps', () => {
    const a = fingerprintError(
      'arete-worker',
      'checkout 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed at 2026-07-21T21:01:31Z after 3 tries (https://github.com/a/b.git)',
    );
    const b = fingerprintError(
      'arete-worker',
      'checkout 550e8400-e29b-41d4-a716-446655440000 failed at 2026-07-20T02:14:09Z after 17 tries (https://github.com/c/d.git)',
    );
    expect(a).toBe(b);
  });

  it('groups across differing ips and hex addresses', () => {
    expect(fingerprintError('arete-worker', 'dial 10.0.0.14:8123 at 0xDEAD')).toBe(
      fingerprintError('arete-worker', 'dial 192.168.1.9:9000 at 0xBEEF'),
    );
  });

  it('separates two genuinely different messages in the same service', () => {
    expect(fingerprintError('arete-worker', 'connection reset by peer')).not.toBe(
      fingerprintError('arete-worker', 'authentication failed'),
    );
  });

  it('separates the SAME message emitted by different services', () => {
    // A generic failure in the worker and in the agents service are two
    // different things to go fix — merging them would hide one behind the
    // other's volume.
    expect(fingerprintError('arete-worker', 'connection reset by peer')).not.toBe(
      fingerprintError('arete-agents', 'connection reset by peer'),
    );
  });

  it('handles empty and whitespace-only messages without throwing, and treats them alike', () => {
    expect(fingerprintError('arete-worker', '')).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintError('arete-worker', '   ')).toBe(fingerprintError('arete-worker', ''));
  });

  it('still separates empty-message errors when the caller keys on the span name', () => {
    // errors.ts groups on `message || title` precisely because '' alone would
    // fuse every messageless span in a service into one bucket.
    expect(fingerprintError('arete-worker', 'tcp.connect')).not.toBe(
      fingerprintError('arete-worker', 'POST'),
    );
  });
});
