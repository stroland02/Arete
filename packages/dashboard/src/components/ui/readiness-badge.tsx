import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Marks how finished a feature is, so the product owner can see at a glance
 * which surfaces are real, which only show sample data, and which are not wired
 * up yet. This is the onboarding checklist's "Coming soon" pill promoted to a
 * shared primitive so the same signal reads identically everywhere.
 *
 * Levels are deliberately few:
 *   - `live`    — fully wired to real data and real actions.
 *   - `preview` — renders, but on scripted sample data, never the user's own.
 *   - `partial` — real, but a meaningful part of the flow is still stubbed.
 *   - `soon`    — not orchestrated yet; any control is inert by design.
 *
 * A `soon` or `partial` badge is a promise to the reader that the control below
 * it will not do anything surprising. Pair it with a `disabled` control — a
 * badge on a live-looking button is worse than no badge at all.
 */
const readinessBadgeVariants = cva(
  "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
  {
    variants: {
      level: {
        live: "border-accent-success/25 bg-accent-success/10 text-accent-success",
        preview: "border-accent-info/25 bg-accent-info/10 text-accent-info",
        partial: "border-accent-warning/25 bg-accent-warning/10 text-accent-warning",
        soon: "border-border-default bg-surface-2 text-content-muted",
      },
    },
    defaultVariants: { level: "soon" },
  }
);

export type ReadinessLevel = NonNullable<
  VariantProps<typeof readinessBadgeVariants>["level"]
>;

const DEFAULT_LABELS: Record<ReadinessLevel, string> = {
  live: "Live",
  preview: "Preview",
  partial: "Partial",
  soon: "Coming soon",
};

export interface ReadinessBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof readinessBadgeVariants> {
  /** Overrides the level's default label, e.g. "Sample data", "Not saved yet". */
  label?: string;
}

function ReadinessBadge({ className, level, label, ...props }: ReadinessBadgeProps) {
  const resolved: ReadinessLevel = level ?? "soon";
  return (
    <span className={cn(readinessBadgeVariants({ level }), className)} {...props}>
      {label ?? DEFAULT_LABELS[resolved]}
    </span>
  );
}

export { ReadinessBadge, readinessBadgeVariants };
