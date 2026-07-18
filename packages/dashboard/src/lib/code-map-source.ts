// Pure line model for the code map's reading panel: source text -> numbered
// lines with the selected file's open findings joined on line number. Kept
// out of the component so the join rules are unit-testable.

export interface SourceFindingLike {
  line: number;
  severity: string;
  body: string;
}

export interface SourceLine {
  n: number;
  text: string;
  /** Present when an open finding sits on this line (highest severity wins). */
  severity?: string;
  note?: string;
}

const SEV_RANK: Record<string, number> = { error: 3, warning: 2, info: 1 };

export function buildSourceLines(text: string, findings: SourceFindingLike[]): SourceLine[] {
  if (text === '') return [];
  const raw = text.split('\n');
  // A trailing newline yields a phantom empty final element — not a real line.
  if (raw[raw.length - 1] === '') raw.pop();

  const byLine = new Map<number, SourceFindingLike>();
  for (const f of findings) {
    const cur = byLine.get(f.line);
    if (!cur || (SEV_RANK[f.severity] ?? 0) > (SEV_RANK[cur.severity] ?? 0)) byLine.set(f.line, f);
  }

  return raw.map((textLine, i) => {
    const f = byLine.get(i + 1);
    return f
      ? { n: i + 1, text: textLine, severity: f.severity, note: f.body }
      : { n: i + 1, text: textLine };
  });
}
