"use client";

import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { CategoryCount } from "@/lib/queries";
import { Widget } from "./widget";
import { ChartTooltip } from "./chart-tooltip";
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);

  if (skeleton) {
    return <Widget title={title}><BarsSkeleton rows={4} /></Widget>;
  }
  if (data.length === 0) {
    return <Widget title={title} caption={caption} isEmpty emptyLabel="Nothing to show yet"><span /></Widget>;
  }
  const maxCount = Math.max(...data.map((d) => d.count));
  const max = Math.max(maxCount, 1);
  const total = data.reduce((a, d) => a + d.count, 0);

  const onRowMove = (index: number) => (e: ReactPointerEvent<HTMLLIElement>) => {
    const host = wrapRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    setHover({ index, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <Widget title={title} caption={caption}>
      <div ref={wrapRef} className="relative" onPointerLeave={() => setHover(null)}>
        <ul className="space-y-1.5">
          {data.map((row, index) => {
            const isMax = maxCount > 0 && row.count === maxCount;
            return (
              <li
                key={row.category}
                className="-mx-2 rounded-md px-2 py-1.5 transition-colors hover:bg-content-primary/[0.04]"
                onPointerMove={onRowMove(index)}
              >
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium capitalize text-content-secondary">{row.category}</span>
                  <span className={`font-serif text-sm tabular-nums ${isMax ? "text-accent-secondary" : "text-content-secondary"}`}>
                    {row.count}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full ${colorFor ? colorFor(row.category) : "bg-accent-primary"}`}
                    style={{ width: `${(row.count / max) * 100}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <ChartTooltip visible={hover !== null} x={hover?.x ?? 0} y={hover?.y ?? 0}>
          {hover !== null && (
            <>
              <span className="font-serif text-sm text-content-primary">{data[hover.index].count}</span>{" "}
              <span className="font-mono text-[10px] text-content-muted">
                · {total > 0 ? Math.round((data[hover.index].count / total) * 100) : 0}% of total
              </span>
            </>
          )}
        </ChartTooltip>
      </div>
    </Widget>
  );
}
