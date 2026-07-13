"use client";

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

export function TimeRangeControl({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border-default bg-surface-1 p-1">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            value === r ? "bg-content-primary/10 text-content-primary" : "text-content-muted hover:text-content-secondary"
          }`}
        >
          {r}d
        </button>
      ))}
    </div>
  );
}
