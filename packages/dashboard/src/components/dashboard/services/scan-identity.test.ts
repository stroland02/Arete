/**
 * Stage 3.3 — the scan spinner now tracks a REAL ScanRun instead of a 1.5s
 * timer, and this pins the comparison that makes that possible.
 *
 * The trap: when you click Scan, `lastScan` normally already holds an older
 * COMPLETED run. Any check of the form "status is no longer running" is
 * therefore already satisfied before the new scan has even started, which would
 * stop the spinner immediately and report the previous run's result as this
 * one's. Identity has to change, not just status.
 */
import { describe, it, expect } from 'vitest';
import { scanIdentity } from './work-item-inbox';

describe('scanIdentity', () => {
  it('distinguishes a NEW completed run from the older one that preceded it', () => {
    const before = scanIdentity({ status: 'complete', finishedAt: '2026-07-20T09:00:00.000Z' });
    const after = scanIdentity({ status: 'complete', finishedAt: '2026-07-23T11:00:00.000Z' });

    // Both are "complete". Only finishedAt tells them apart — which is exactly
    // the case a status-only check gets wrong.
    expect(before).not.toBe(after);
  });

  it('is stable for the same run, so a refresh that changed nothing keeps waiting', () => {
    const run = { status: 'running', finishedAt: null };

    expect(scanIdentity(run)).toBe(scanIdentity({ ...run }));
  });

  it('changes when a run starts', () => {
    expect(scanIdentity({ status: 'complete', finishedAt: '2026-07-20T09:00:00.000Z' })).not.toBe(
      scanIdentity({ status: 'running', finishedAt: null }),
    );
  });

  it('changes when a running scan finishes', () => {
    expect(scanIdentity({ status: 'running', finishedAt: null })).not.toBe(
      scanIdentity({ status: 'complete', finishedAt: '2026-07-23T11:00:00.000Z' }),
    );
  });

  it('treats a failed run as its own outcome, not as a completion', () => {
    expect(scanIdentity({ status: 'failed', finishedAt: '2026-07-23T11:00:00.000Z' })).not.toBe(
      scanIdentity({ status: 'complete', finishedAt: '2026-07-23T11:00:00.000Z' }),
    );
  });

  it('gives never-scanned its own identity, distinct from any real run', () => {
    // null means "no scan has ever run" — never the same as a finished one.
    const never = scanIdentity(null);

    expect(never).toBe('none|');
    expect(never).not.toBe(scanIdentity({ status: 'no_findings', finishedAt: null }));
  });
});
