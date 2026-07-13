import type { CategoryCount } from "@/lib/queries";
import { Widget } from "./widget";
import { BarsSkeleton } from "./dashboard-skeletons";

export interface BarBreakdownWidgetProps {
  title: string;
  caption?: string;
  data: CategoryCount[];
  /** Map a row label to a bar color class; defaults to accent-primary. */
  colorFor?: (label: string) => string;
  skeleton?: boolean;
}

export function BarBreakdownWidget({ title, caption, data, colorFor, skeleton }: BarBreakdownWidgetProps) {
  if (skeleton) {
    return <Widget title={title}><BarsSkeleton rows={4} /></Widget>;
  }
  if (data.length === 0) {
    return <Widget title={title} caption={caption} isEmpty emptyLabel="Nothing to show yet"><span /></Widget>;
  }
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <Widget title={title} caption={caption}>
      <ul className="space-y-3">
        {data.map((row) => (
          <li key={row.category}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium capitalize text-content-secondary">{row.category}</span>
              <span className="font-mono text-xs tabular-nums text-content-muted">{row.count}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div className={`h-full rounded-full ${colorFor ? colorFor(row.category) : "bg-accent-primary"}`} style={{ width: `${(row.count / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Widget>
  );
}
