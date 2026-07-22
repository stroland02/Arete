"use client";

import { useId, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { bucketByDay } from "@/lib/trends";
import { Widget } from "./widget";
import { ChartTooltip } from "./chart-tooltip";
import { TimeseriesSkeleton } from "./dashboard-skeletons";

export interface TimeseriesWidgetProps {
  title: string;
  caption?: string;
  dates: Date[];
  days: number;
  skeleton?: boolean;
}

const W = 600;
const H = 160;

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Calendar date a bucket index refers to (last bucket = today). */
function dateForIndex(index: number, days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1 - index));
  return d;
}

export function TimeseriesWidget({ title, caption, dates, days, skeleton }: TimeseriesWidgetProps) {
  const gradientId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (skeleton) {
    return <Widget title={title}><TimeseriesSkeleton /></Widget>;
  }

  const series = bucketByDay(dates, days);
  const total = series.reduce((a, b) => a + b, 0);

  if (total === 0) {
    return (
      <Widget title={title} caption={caption} isEmpty emptyLabel="No activity in this range"><span /></Widget>
    );
  }

  const max = Math.max(...series, 1);
  const stepX = series.length > 1 ? W / (series.length - 1) : 0;
  const points = series.map((v, i) => {
    const x = i * stepX;
    const y = H - (v / max) * (H - 12) - 6;
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;

  const latest = points[points.length - 1];
  const hover = hoverIndex !== null ? points[hoverIndex] : null;

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || series.length < 2) return;
    const frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    setHoverIndex(Math.round(frac * (series.length - 1)));
  };

  return (
    <Widget
      title={title}
      caption={caption}
      action={
        <span className="flex items-baseline gap-1.5">
          <span className="font-serif text-lg text-content-primary">{total}</span>
          <span className="font-mono text-[10px] text-content-muted">total</span>
        </span>
      }
    >
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-40 w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title}: ${total} total`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="color-mix(in srgb, var(--color-accent-primary) 16%, transparent)" />
              <stop offset="1" stopColor="transparent" />
            </linearGradient>
          </defs>
          <polygon points={area} fill={`url(#${gradientId})`} />
          {hover && (
            <line
              x1={hover[0]}
              x2={hover[0]}
              y1={0}
              y2={H}
              className="stroke-border-strong"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <polyline
            points={line}
            fill="none"
            className="stroke-content-primary"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {/* Bronze latest-point dot with a paper halo — HTML so it stays a true
            circle under preserveAspectRatio="none" stretching. */}
        <span
          aria-hidden
          className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${(latest[0] / W) * 100}%`,
            top: `${(latest[1] / H) * 100}%`,
            background: "var(--color-accent-secondary)",
            boxShadow: "0 0 0 2px var(--color-surface-1)",
          }}
        />
        {hover && hoverIndex !== null && (
          <span
            aria-hidden
            className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${(hover[0] / W) * 100}%`,
              top: `${(hover[1] / H) * 100}%`,
              background: "var(--color-accent-primary)",
              boxShadow: "0 0 0 2px var(--color-surface-1)",
            }}
          />
        )}
        <ChartTooltip
          visible={hover !== null}
          x={hover ? `${(hover[0] / W) * 100}%` : 0}
          y={hover ? `${(hover[1] / H) * 100}%` : 0}
        >
          {hoverIndex !== null && (
            <>
              <span className="font-serif text-sm text-content-primary">{series[hoverIndex]}</span>{" "}
              <span className="font-mono text-[10px] text-content-muted">
                reviews · {shortDate(dateForIndex(hoverIndex, series.length))}
              </span>
            </>
          )}
        </ChartTooltip>
      </div>
      <div className="mt-1.5 flex items-center justify-between border-t border-border-subtle pt-1.5">
        <span className="font-mono text-[10px] text-content-muted">{shortDate(dateForIndex(0, series.length))}</span>
        <span className="font-mono text-[10px] text-content-muted">{shortDate(dateForIndex(series.length - 1, series.length))}</span>
      </div>
    </Widget>
  );
}
