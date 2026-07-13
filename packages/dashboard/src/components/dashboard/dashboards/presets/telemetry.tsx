import Link from "next/link";
import type { DashboardsViewModel } from "@/lib/queries";
import { IconPlugConnected, IconArrowRight } from "@tabler/icons-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TelemetryMetricWidget } from "../telemetry-metric-widget";

type Model = Extract<DashboardsViewModel, { hasAccess: true }>;

export function TelemetryPreset({ model, connected }: { model: Model; days: number; connected: boolean }) {
  if (!connected || model.telemetry.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<IconPlugConnected className="h-6 w-6" />}
          title="Connect a service to see telemetry"
          description="Connect a service like Sentry, Vercel, or PostHog — its latest metrics appear here, captured at each review."
        />
        <div className="mt-4 flex justify-center">
          <Link href="/connections" className="inline-flex items-center gap-2 rounded-xl border border-accent-primary/30 bg-accent-primary/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/30">
            Connect a service <IconArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {model.telemetry.map((snap) => (
        <TelemetryMetricWidget key={`${snap.provider}:${snap.sourceRef}`} snapshot={snap} />
      ))}
    </div>
  );
}
