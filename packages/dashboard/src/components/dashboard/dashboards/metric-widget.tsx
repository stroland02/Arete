import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CountUpValue } from "@/components/dashboard/count-up-value";
import { Sparkline } from "@/components/dashboard/sparkline";
import { ConnectPrompt, type ConnectKind } from "./connect-prompt";

export interface MetricWidgetProps {
  label: string;
  value: number;
  icon?: ReactNode;
  /** Honest delta string, e.g. "+3" or "-12.5%". Badge omitted when undefined. */
  change?: string;
  positive?: boolean;
  /** Optional day-bucket series for a sparkline. */
  trend?: number[];
  /** When set, show a compact connect prompt instead of the metric value. */
  connect?: ConnectKind;
}

export function MetricWidget({ label, value, icon, change, positive, trend, connect }: MetricWidgetProps) {
  return (
    <Card className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between">
        {icon ? <div className="rounded-2xl border border-border-default bg-content-primary/5 p-3">{icon}</div> : <span />}
        {!connect && change && <Badge variant={positive ? "positive" : "negative"}>{change}</Badge>}
      </div>
      {connect ? (
        <div className="flex flex-1 flex-col">
          <p className="mb-1 text-sm font-medium text-content-muted">{label}</p>
          <ConnectPrompt kind={connect} compact />
        </div>
      ) : (
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="mb-1 text-sm font-medium text-content-muted">{label}</p>
            <h3 className="font-mono text-3xl font-bold tabular-nums tracking-tight text-content-primary">
              <CountUpValue value={String(value)} />
            </h3>
          </div>
          {trend && trend.length > 1 && (
            <Sparkline data={trend} className="h-7 w-20 shrink-0" strokeClassName={positive === false ? "stroke-accent-danger" : "stroke-accent-primary"} />
          )}
        </div>
      )}
    </Card>
  );
}
