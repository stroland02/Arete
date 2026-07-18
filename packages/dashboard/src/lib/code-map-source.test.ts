import { describe, it, expect } from 'vitest';
import { buildSourceLines } from './code-map-source';

const FINDINGS = [
  { line: 3, severity: 'warning', body: 'token in localStorage' },
  { line: 3, severity: 'error', body: 'missing auth check' },
  { line: 5, severity: 'info', body: 'naming nit' },
];

describe('buildSourceLines', () => {
  it('numbers lines from 1 and keeps text verbatim', () => {
    expect(buildSourceLines('a\nb', [])).toEqual([
      { n: 1, text: 'a' },
      { n: 2, text: 'b' },
    ]);
  });

  it('drops the phantom line after a trailing newline', () => {
    expect(buildSourceLines('a\nb\n', []).length).toBe(2);
  });

  it('returns [] for empty text', () => {
    expect(buildSourceLines('', [])).toEqual([]);
  });

  it('attaches the highest-severity finding to its line', () => {
    const lines = buildSourceLines('1\n2\n3\n4\n5', FINDINGS);
    expect(lines[2]).toEqual({ n: 3, text: '3', severity: 'error', note: 'missing auth check' });
    expect(lines[4]).toEqual({ n: 5, text: '5', severity: 'info', note: 'naming nit' });
    expect(lines[0]).toEqual({ n: 1, text: '1' });
  });

  it('ignores findings pointing past the end of the file', () => {
    const lines = buildSourceLines('only', [{ line: 99, severity: 'error', body: 'x' }]);
    expect(lines).toEqual([{ n: 1, text: 'only' }]);
  });
});
