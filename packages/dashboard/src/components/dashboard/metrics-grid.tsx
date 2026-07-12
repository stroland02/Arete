import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RevealItem } from "./page-reveal";
import { Sparkline } from "./sparkline";
import { CountUpValue } from "./count-up-value";

export interface Metric {
  title: string;
  value: string;
  /** Omit when no honest change/delta can be derived — the badge simply won't render. */
  change?: string;
  positive?: boolean;
  icon: ReactNode;
  trend?: number[];
}

export function MetricsGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {metrics.map((metric, i) => (
        <RevealItem key={i}>
          <Card className="flex h-full flex-col gap-4 group">
            <div className="flex justify-between items-start">
              <div className="p-3 bg-content-primary/5 rounded-2xl border border-border-default transition-[background-color,border-color,transform] duration-300 ease-out group-hover:bg-content-primary/10 group-hover:border-border-strong group-hover:scale-105">
                {metric.icon}
              </div>
              {metric.change && (
                <Badge variant={metric.positive ? "positive" : "negative"}>{metric.change}</Badge>
              )}
            </div>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-content-muted mb-1">{metric.title}</p>
                <h3 className="text-3xl font-bold text-content-primary font-mono tabular-nums tracking-tight">
                  <CountUpValue value={metric.value} />
                </h3>
              </div>
              {metric.trend && metric.trend.length > 1 && (
                <Sparkline
                  data={metric.trend}
                  className="w-20 h-7 shrink-0"
                  strokeClassName={metric.positive ? "stroke-accent-success" : "stroke-accent-danger"}
                />
              )}
            </div>
          </Card>
        </RevealItem>
      ))}
    </div>
  );
}
