import Link from "next/link";
import { IconArrowRight } from "@tabler/icons-react";
import type { TelemetryGridSnapshot } from "@/lib/queries";
import { Widget } from "./widget";

export interface TelemetryMetricWidgetProps {
  snapshot: TelemetryGridSnapshot;
  /**
   * Providers the tenant has actually connected. A detected snapshot whose
   * provider is NOT in this list was seen in a review but is not a live
   * connection — the card is badged "Detected · not connected" and offers a
   * Connect CTA rather than implying the data is live. Never fabricated: the
   * metrics shown are the real values we detected; only the framing changes.
   */
  connectedProviders: string[];
}

export function TelemetryMetricWidget({ snapshot, connectedProviders }: TelemetryMetricWidgetProps) {
  const entries = Object.entries(snapshot.metrics ?? {});
  const connected = connectedProviders.includes(snapshot.provider);

  // Only a genuinely connected source is captioned as "live as of last review".
  const caption = connected ? `as of last review · ${snapshot.fetchedAt.toLocaleDateString()}` : undefined;

  return (
    <Widget
      title={snapshot.provider}
      caption={caption}
      isEmpty={entries.length === 0}
      emptyLabel="No metrics captured yet"
      action={
        connected ? (
          <span className="font-mono text-[11px] text-content-muted">{snapshot.sourceRef}</span>
        ) : (
          <span className="shrink-0 rounded-full border border-border-default bg-content-primary/[0.04] px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-content-muted">
            Detected · not connected
          </span>
        )
      }
    >
      <dl className="grid grid-cols-2 gap-3">
        {entries.map(([key, val]) => (
          <div key={key} className="rounded-xl border border-border-subtle bg-surface-0/40 p-3">
            <dt className="truncate text-[11px] text-content-muted">{key}</dt>
            <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-content-primary">{val}</dd>
          </div>
        ))}
      </dl>

      {!connected && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-2/40 px-3 py-2.5">
          <p className="text-[12px] leading-relaxed text-content-muted">
            <span className="font-mono">{snapshot.sourceRef}</span> — detected in a review. Connect{" "}
            {snapshot.provider} to keep it current.
          </p>
          <Link
            href="/connections"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-primary/90"
          >
            Connect this service <IconArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </Widget>
  );
}
