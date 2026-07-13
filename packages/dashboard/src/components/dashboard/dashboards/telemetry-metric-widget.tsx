import type { TelemetryGridSnapshot } from "@/lib/queries";
import { Widget } from "./widget";

export interface TelemetryMetricWidgetProps {
  snapshot: TelemetryGridSnapshot;
}

export function TelemetryMetricWidget({ snapshot }: TelemetryMetricWidgetProps) {
  const entries = Object.entries(snapshot.metrics ?? {});
  const caption = `as of last review · ${snapshot.fetchedAt.toLocaleDateString()}`;

  return (
    <Widget
      title={snapshot.provider}
      caption={caption}
      isEmpty={entries.length === 0}
      emptyLabel="No metrics captured yet"
      action={<span className="font-mono text-[11px] text-content-muted">{snapshot.sourceRef}</span>}
    >
      <dl className="grid grid-cols-2 gap-3">
        {entries.map(([key, val]) => (
          <div key={key} className="rounded-xl border border-border-subtle bg-surface-0/40 p-3">
            <dt className="truncate text-[11px] text-content-muted">{key}</dt>
            <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-content-primary">{val}</dd>
          </div>
        ))}
      </dl>
    </Widget>
  );
}
