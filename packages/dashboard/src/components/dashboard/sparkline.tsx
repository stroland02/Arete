import { useId } from "react";
import { cn } from "@/lib/utils";

interface SparklineProps {
  data: number[];
  className?: string;
  strokeClassName?: string;
  /** Soft cobalt wash under the line (Marble & Ink chart treatment). Off by default. */
  fillGradient?: boolean;
  /** Bronze dot with a paper halo on the final point. Off by default. */
  endDot?: boolean;
}

export function Sparkline({ data, className, strokeClassName = "stroke-accent-primary", fillGradient, endDot }: SparklineProps) {
  const gradientId = useId();
  const width = 80;
  const height = 28;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const coords = data.map((value, index) => {
    const x = data.length > 1 ? (index / (data.length - 1)) * width : width / 2;
    const y = height - ((value - min) / range) * height;
    return [x, y] as const;
  });
  const points = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const last = coords[coords.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn(endDot && "overflow-visible", className)} preserveAspectRatio="none">
      {fillGradient && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="color-mix(in srgb, var(--color-accent-primary) 16%, transparent)" />
              <stop offset="1" stopColor="transparent" />
            </linearGradient>
          </defs>
          <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#${gradientId})`} />
        </>
      )}
      <polyline
        points={points}
        fill="none"
        className={strokeClassName}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {endDot && last && (
        <circle
          cx={last[0]}
          cy={last[1]}
          r={2.5}
          fill="var(--color-accent-secondary)"
          stroke="var(--color-surface-1)"
          strokeWidth={2}
        />
      )}
    </svg>
  );
}
