import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getIncidentDetail } from "@/lib/incidents";
import { resolveSelectedInstallationIds } from "@/lib/queries";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { IconArrowLeft, IconSparkles } from "@tabler/icons-react";

export const dynamic = "force-dynamic";

function severityBadgeClasses(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "bg-accent-danger/10 text-accent-danger border-accent-danger/25";
    case "warning":
      return "bg-accent-warning/10 text-accent-warning border-accent-warning/25";
    default:
      return "bg-content-primary/5 text-content-muted border-border-default";
  }
}

function statusBadgeClasses(status: string): string {
  return status === "firing"
    ? "bg-accent-danger/10 text-accent-danger border-accent-danger/25"
    : "bg-accent-success/10 text-accent-success border-accent-success/25";
}

/** `payload.labels` / `payload.annotations` are scrubbed, untyped JSON
 *  (receiver.ts) — read defensively, never trust the shape. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default async function IncidentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ installation?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { id } = await params;
  const { installation } = await searchParams;
  const installationIds = resolveSelectedInstallationIds(session.installations ?? [], installation);
  const incident = await getIncidentDetail(db, installationIds, id);

  if (!incident) {
    return (
      <PageReveal className="max-w-2xl">
        <RevealItem>
          <Link
            href="/overview"
            className="inline-flex items-center gap-1.5 text-sm text-content-muted hover:text-content-secondary transition-colors mb-6"
          >
            <IconArrowLeft className="w-4 h-4" />
            Back to Overview
          </Link>
          <div className="glass-panel p-8 text-center">
            <p className="text-sm text-content-secondary">
              This incident doesn&apos;t exist, or isn&apos;t part of an installation you have access to.
            </p>
          </div>
        </RevealItem>
      </PageReveal>
    );
  }

  const payload = asRecord(incident.payload);
  const labels = asRecord(payload.labels);
  const annotations = asRecord(payload.annotations);

  return (
    <PageReveal className="max-w-5xl space-y-6">
      <RevealItem>
        <Link
          href="/overview"
          className="inline-flex items-center gap-1.5 text-sm text-content-muted hover:text-content-secondary transition-colors mb-4"
        >
          <IconArrowLeft className="w-4 h-4" />
          Back to Overview
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-content-muted font-mono">{incident.fingerprint}</p>
            <h1 className="text-xl font-semibold text-content-primary mt-1">{incident.alertName}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            {incident.workItemId && incident.fixContainerId && (
              <Link
                href={`/services?container=${encodeURIComponent(incident.fixContainerId)}`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default bg-surface-1 px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:border-border-strong hover:bg-content-primary/5"
              >
                <IconSparkles size={14} stroke={1.75} aria-hidden />
                View fix run
              </Link>
            )}
            {incident.workItemId && !incident.fixContainerId && (
              <span className="shrink-0 text-xs text-content-muted">Fix opened</span>
            )}
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide border shrink-0 ${severityBadgeClasses(incident.severity)}`}
            >
              {incident.severity}
            </span>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide border shrink-0 ${statusBadgeClasses(incident.status)}`}
            >
              {incident.status}
            </span>
          </div>
        </div>
      </RevealItem>

      <RevealItem className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Timeline — SuperLog incident-detail pattern, mirrors reviews/[id]'s
            metadata sidebar. */}
        <div className="lg:col-span-1 glass-panel p-5 space-y-4 h-fit">
          <MetaRow label="Status" value={incident.status} />
          <MetaRow label="Severity" value={incident.severity} />
          <MetaRow label="Started" value={formatTimestamp(incident.startsAt)} />
          <MetaRow
            label="Resolved"
            value={incident.resolvedAt ? formatTimestamp(incident.resolvedAt) : "Still firing"}
          />
          <MetaRow label="Fingerprint" value={incident.fingerprint} mono />
        </div>

        {/* Summary + alert payload */}
        <div className="lg:col-span-3 space-y-6">
          <div className="glass-panel p-5">
            <h2 className="text-sm font-semibold text-content-primary mb-3">Summary</h2>
            <p className="text-sm text-content-secondary whitespace-pre-wrap leading-relaxed">
              {incident.summary}
            </p>
          </div>

          <div className="glass-panel p-5">
            <h2 className="text-sm font-semibold text-content-primary mb-4">Labels</h2>
            {Object.keys(labels).length === 0 ? (
              <p className="text-sm text-content-muted">No labels on this alert.</p>
            ) : (
              <PayloadTable entries={labels} />
            )}
          </div>

          <div className="glass-panel p-5">
            <h2 className="text-sm font-semibold text-content-primary mb-4">Annotations</h2>
            {Object.keys(annotations).length === 0 ? (
              <p className="text-sm text-content-muted">No annotations on this alert.</p>
            ) : (
              <PayloadTable entries={annotations} />
            )}
          </div>
        </div>
      </RevealItem>
    </PageReveal>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-content-muted mb-1">{label}</p>
      <p className={`text-sm text-content-secondary ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function PayloadTable({ entries }: { entries: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      {Object.entries(entries).map(([key, value]) => (
        <div key={key} className="flex items-start gap-3 text-sm">
          <span className="w-40 shrink-0 truncate font-mono text-xs text-content-muted">{key}</span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-content-secondary">
            {String(value)}
          </span>
        </div>
      ))}
    </div>
  );
}
