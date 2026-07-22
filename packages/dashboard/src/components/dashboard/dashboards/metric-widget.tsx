import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CountUpValue } from "@/components/dashboard/count-up-value";
import { Sparkline } from "@/components/dashboard/sparkline";
import { MetricSkeleton } from "./dashboard-skeletons";

export interface MetricWidgetProps {
  label: string;
  value: number;
  icon?: ReactNode;
  /** Honest delta string, e.g. "+3" or "-12.5%". Badge omitted when undefined. */
  change?: string;
  positive?: boolean;
  /** Optional day-bucket series for a sparkline. */
  trend?: number[];
  /** Not-connected preview: render a structural skeleton instead of a value. */
  skeleton?: boolean;
}

export function MetricWidget({ label, value, icon, change, positive, trend, skeleton }: MetricWidgetProps) {
  return (
    <Card className="flex h-full flex-col gap-4">
      {/* The icon badge belongs to the loaded tile — while the skeleton shows,
          the header collapses rather than parking an empty square on the card. */}
      {!skeleton && (icon || change) && (
        <div className="flex items-start justify-between">
          {icon ? <div className="rounded-2xl border border-border-default bg-content-primary/5 p-3">{icon}</div> : <span />}
          {change && <Badge variant={positive ? "positive" : "negative"}>{change}</Badge>}
        </div>
      )}
      {skeleton ? (
        <div className="flex flex-1 flex-col gap-3">
          <p className="text-sm font-medium text-content-muted">{label}</p>
          <MetricSkeleton />
        </div>
      ) : (
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="mb-1 text-sm font-medium text-content-muted">{label}</p>
            <h3 className="font-serif text-3xl font-semibold tabular-nums tracking-tight text-content-primary">
              <CountUpValue value={String(value)} />
            </h3>
          </div>
          {trend && trend.length > 1 && (
            <Sparkline data={trend} className="h-7 w-20 shrink-0" strokeClassName={positive === false ? "stroke-accent-danger" : "stroke-accent-primary"} fillGradient endDot />
          )}
        </div>
      )}
    </Card>
  );
}
