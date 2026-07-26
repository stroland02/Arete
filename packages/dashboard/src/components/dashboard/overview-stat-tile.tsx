"use client";

import { CountUpValue } from "@/components/dashboard/count-up-value";
import { Sparkline } from "@/components/dashboard/sparkline";

/**
 * Overview headline stat: mono micro-label, serif display numeral, and — when
 * real day-bucket data exists — a cobalt-washed sparkline ending in a bronze
 * dot. Without a trend it renders a short bronze hairline instead; we never
 * fabricate a chart. Non-interactive panel: hover only firms the border.
 */
export function OverviewStatTile({ label, value, trend }: { label: string; value: number; trend?: number[] }) {
  const chartData = trend && trend.length > 1 ? trend : undefined;
  return (
    <div
      className="rounded-2xl border border-border-default bg-surface-1 p-5 transition-colors duration-300 hover:border-border-strong"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-content-muted">{label}</p>
      <p className="mt-2 font-serif text-3xl font-semibold tabular-nums tracking-tight text-content-primary">
        <CountUpValue value={String(value)} />
      </p>
      {chartData ? (
        <Sparkline data={chartData} className="mt-3 h-8 w-full" fillGradient endDot />
      ) : (
        <span aria-hidden className="mt-4 block h-px w-8 bg-accent-secondary/70" />
      )}
    </div>
  );
}
