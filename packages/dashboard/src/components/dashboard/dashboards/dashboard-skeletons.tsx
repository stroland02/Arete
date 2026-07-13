"use client";

import type { CSSProperties } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/** Shimmering placeholder block. framer-motion sweep; static under reduced-motion. */
export function Shimmer({ className, style }: { className?: string; style?: CSSProperties }) {
  const reduce = useReducedMotion();
  return (
    <div className={cn("relative overflow-hidden rounded-md bg-surface-2", className)} style={style}>
      {!reduce && (
        <motion.div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "linear-gradient(90deg, transparent, rgba(242,241,234,0.06), transparent)" }}
          initial={{ x: "-100%" }}
          animate={{ x: "100%" }}
          transition={{ repeat: Infinity, duration: 2.1, ease: "easeInOut" }}
        />
      )}
    </div>
  );
}

/** Empty line-chart frame: axes + dashed gridlines + faint dashed ghost curve. */
export function TimeseriesSkeleton() {
  return (
    <div className="grid h-44 grid-cols-[30px_1fr] gap-2" aria-label="chart preview">
      <div className="flex flex-col justify-between py-0.5 pb-[18px]">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[7px] w-[22px] rounded bg-surface-2" />
        ))}
      </div>
      <div>
        <div className="relative h-[calc(100%-26px)] border-b border-l border-border-subtle">
          {[8, 34, 60, 86].map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-dashed border-border-subtle" style={{ top: `${t}%` }} />
          ))}
          <svg viewBox="0 0 600 150" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
            <defs>
              <linearGradient id="ts-skeleton-ghost" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="rgba(124,151,255,0.14)" />
                <stop offset="1" stopColor="rgba(124,151,255,0)" />
              </linearGradient>
            </defs>
            <polygon points="0,150 0,104 100,96 200,108 300,88 400,98 500,80 600,90 600,150" fill="url(#ts-skeleton-ghost)" />
            <polyline points="0,104 100,96 200,108 300,88 400,98 500,80 600,90" fill="none" stroke="rgba(124,151,255,0.28)" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" />
          </svg>
        </div>
        <div className="flex justify-between pl-[34px] pt-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[7px] w-[30px] rounded bg-surface-2" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Ghost horizontal-bar rows. */
export function BarsSkeleton({ rows = 4 }: { rows?: number }) {
  const widths = [82, 61, 44, 29, 55, 38];
  const labels = [34, 28, 40, 24, 44, 30];
  return (
    <ul className="space-y-4" aria-label="breakdown preview">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex flex-col gap-1.5">
          <div className="flex justify-between">
            <div className="h-[9px] rounded bg-surface-2" style={{ width: `${labels[i % labels.length]}%` }} />
            <div className="h-[9px] w-3.5 rounded bg-surface-2" />
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${widths[i % widths.length]}%`, background: "rgba(124,151,255,0.16)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Metric-tile body ghost: icon block + label + value shimmer. */
export function MetricSkeleton() {
  return (
    <div className="flex min-h-[128px] flex-col gap-4">
      <div className="h-[42px] w-[42px] rounded-[13px] border border-border-subtle bg-surface-2" />
      <div className="space-y-2">
        <Shimmer className="h-[11px] w-[58%]" />
        <Shimmer className="h-[30px] w-[42%] rounded-lg" />
      </div>
    </div>
  );
}

/** Recent-reviews table ghost rows. */
export function TableSkeleton({ rows = 3 }: { rows?: number }) {
  const l1 = [46, 54, 38, 50];
  const l2 = [28, 24, 32, 26];
  return (
    <div className="flex flex-col" aria-label="list preview">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3.5 border-t border-border-subtle py-3 first:border-t-0">
          <span className="h-2 w-2 shrink-0 rounded-full bg-content-primary/10" />
          <div className="flex-1 space-y-2">
            <Shimmer className="h-2.5" style={{ width: `${l1[i % l1.length]}%` }} />
            <Shimmer className="h-2" style={{ width: `${l2[i % l2.length]}%` }} />
          </div>
          <div className="h-[18px] w-[52px] shrink-0 rounded-full bg-surface-2" />
        </div>
      ))}
    </div>
  );
}

/** Telemetry provider-card ghost: title + 2x2 metric slots. */
export function TelemetryCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border-default bg-surface-1 p-5">
      <div className="mb-4 flex items-center justify-between">
        <Shimmer className="h-3.5 w-[30%]" />
        <Shimmer className="h-3 w-[22%]" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-border-subtle bg-surface-0/40 p-3">
            <Shimmer className="mb-2 h-2.5 w-[60%]" />
            <Shimmer className="h-5 w-[40%] rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
