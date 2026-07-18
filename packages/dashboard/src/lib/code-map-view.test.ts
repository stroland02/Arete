import { describe, it, expect } from 'vitest';
import { nodeVisible, matchesSearch } from './code-map-view';

describe('nodeVisible', () => {
  it('shows everything on "all"', () => {
    expect(nodeVisible(undefined, 'all')).toBe(true);
  });
  it('"findings" shows only nodes with pain', () => {
    expect(nodeVisible({ pain: { count: 1, maxSeverity: 'error' } }, 'findings')).toBe(true);
    expect(nodeVisible({}, 'findings')).toBe(false);
    expect(nodeVisible(undefined, 'findings')).toBe(false);
  });
  it('"active" shows only nodes with agent activity', () => {
    expect(nodeVisible({ activity: { agent: 'Security Agent' } }, 'active')).toBe(true);
    expect(nodeVisible({}, 'active')).toBe(false);
  });
});

describe('matchesSearch', () => {
  it('empty query matches everything', () => {
    expect(matchesSearch('a.ts', 'src/a.ts', '')).toBe(true);
    expect(matchesSearch('a.ts', 'src/a.ts', '   ')).toBe(true);
  });
  it('matches label or path, case-insensitive', () => {
    expect(matchesSearch('Charge.ts', 'src/billing/Charge.ts', 'charge')).toBe(true);
    expect(matchesSearch('a.ts', 'src/billing/a.ts', 'BILLING')).toBe(true);
    expect(matchesSearch('a.ts', 'src/auth/a.ts', 'billing')).toBe(false);
  });
  it('tolerates a missing path', () => {
    expect(matchesSearch('a.ts', undefined, 'auth')).toBe(false);
  });
});
