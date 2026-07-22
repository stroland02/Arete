import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getIncidentDetail } from "@/lib/incidents";
import { getIncidentErrorGroups, type ErrorGroupView } from "@/lib/errors";
import {
  attachErrorAction,
  resolveIncidentWithErrorsAction,
  setIncidentNoiseAction,
} from "../actions";
import { resolveSelectedInstallationIds } from "@/lib/queries";
import {
  getIncidentSignals,
  incidentSignalWindow,
  type ErrorSpan,
  type LogLine,
  type ExceptionGroup,
} from "@/lib/telemetry-queries";
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

  // The errors this incident groups. `null` = the error surface isn't available
  // for this account, in which case we omit the section entirely rather than
  // render a panel that can only say nothing.
  const errorGroups = await getIncidentErrorGroups(db, installationIds, id);
  const attached = errorGroups?.attached ?? [];
  const correlated = errorGroups?.correlated ?? [];

  const payload = asRecord(incident.payload);
  const labels = asRecord(payload.labels);
  const annotations = asRecord(payload.annotations);

  // Scope telemetry to the alert's service when the payload names one
  // (Prometheus convention: `service`, else `job`); undefined widens to every
  // service in the tenant. installationIds is the session-authorized set —
  // the same tenancy boundary getIncidentDetail was fetched under.
  const serviceLabel =
    typeof labels.service === "string"
      ? labels.service
      : typeof labels.job === "string"
        ? labels.job
        : undefined;
  const signals = await getIncidentSignals(
    installationIds,
    incidentSignalWindow(incident.startsAt, incident.resolvedAt),
    serviceLabel,
  );
  const noSignals =
    signals.exceptions.length === 0 &&
    signals.spans.length === 0 &&
    signals.logs.length === 0;

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
            {/* The whole point of grouping errors under an incident: close them
                together. Only offered when there is actually something to close. */}
            {attached.length > 0 && (
              <form action={resolveIncidentWithErrorsAction}>
                <input type="hidden" name="id" value={incident.id} />
                <button
                  type="submit"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default bg-surface-1 px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:border-border-strong hover:bg-content-primary/5"
                >
                  Resolve incident and its errors
                </button>
              </form>
            )}
            <form action={setIncidentNoiseAction}>
              <input type="hidden" name="id" value={incident.id} />
              <input type="hidden" name="noise" value={incident.noisedAt ? "false" : "true"} />
              <button
                type="submit"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default bg-surface-1 px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:border-border-strong hover:bg-content-primary/5"
              >
                {incident.noisedAt ? "Unmark noise" : "Mark as noise"}
              </button>
            </form>
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
          <MetaRow
            label="Triage"
            value={incident.noisedAt ? `Noise · ${formatTimestamp(incident.noisedAt)}` : "Actionable"}
          />
          <MetaRow
            label="Source"
            value={incident.source === "manual" ? "Manual investigation" : "Alert"}
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

          {errorGroups && (
            <div className="glass-panel p-5">
              <h2 className="text-sm font-semibold text-content-primary mb-1">Connected errors</h2>
              <p className="text-xs text-content-muted mb-4">
                The individual recurring errors this incident groups. Resolving the incident
                resolves them together.
              </p>

              {attached.length === 0 ? (
                <p className="text-sm text-content-muted">
                  No errors are attached to this incident yet.
                </p>
              ) : (
                <div className="flex flex-col">
                  {attached.map((group) => (
                    <ErrorRow key={group.fingerprint} group={group} incidentId={incident.id} mode="detach" />
                  ))}
                </div>
              )}

              {correlated.length > 0 && (
                <div className="mt-5 border-t border-border-subtle pt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                    Seen during this incident
                  </h3>
                  <p className="mt-1 mb-3 text-xs text-content-muted">
                    These errors overlap this incident&apos;s time window. That is a
                    coincidence in time, not a proven cause — attach the ones that belong.
                  </p>
                  <div className="flex flex-col">
                    {correlated.map((group) => (
                      <ErrorRow
                        key={group.fingerprint}
                        group={group}
                        incidentId={incident.id}
                        mode="attach"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

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

      {/* Signals — the incident's own trace/log/exception context from Areté's
          SUPERLOG telemetry (dogfooding). Fail-soft: a telemetry-backend
          outage renders a note, never breaks the incident page. */}
      <RevealItem>
        <div className="glass-panel p-5 space-y-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold text-content-primary">Signals</h2>
            <p className="text-xs text-content-muted">
              Trace, log &amp; exception context{serviceLabel ? ` for ${serviceLabel}` : ""} around this incident
              (±15&nbsp;min)
            </p>
          </div>

          {signals.unavailable ? (
            <p className="text-sm text-content-muted">
              Telemetry backend unavailable — signals couldn&apos;t be loaded for this window.
            </p>
          ) : noSignals ? (
            <p className="text-sm text-content-muted">No signals recorded in this window.</p>
          ) : (
            <div className="space-y-6">
              {signals.exceptions.length > 0 && <ExceptionsList exceptions={signals.exceptions} />}
              {signals.spans.length > 0 && <ErrorSpansList spans={signals.spans} />}
              {signals.logs.length > 0 && <LogsList logs={signals.logs} />}
            </div>
          )}
        </div>
      </RevealItem>
    </PageReveal>
  );
}

const ERROR_STATUS_DOT: Record<string, string> = {
  open: "bg-accent-danger",
  observing: "bg-accent-warning",
  resolved: "bg-accent-success",
  silenced: "bg-content-muted",
};

/**
 * One error group inside the incident's "Connected errors" section. `mode`
 * decides which side of the join the row offers: detach an attached error, or
 * attach a time-correlated suggestion. Same row language as the Errors list —
 * dot · title · service · counts · action.
 */
function ErrorRow({
  group,
  incidentId,
  mode,
}: {
  group: ErrorGroupView;
  incidentId: string;
  mode: "attach" | "detach";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg px-2 py-2.5 transition-colors hover:bg-content-primary/[0.04]">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${ERROR_STATUS_DOT[group.status] ?? "bg-content-muted"}`}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-content-primary">
          {group.title}
        </span>
        <span className="shrink-0 font-mono text-[12px] text-content-muted">{group.service}</span>
        <span className="shrink-0 rounded-full border border-border-default bg-content-primary/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-content-muted">
          {group.kind === "exception" ? "Exception" : "Log"}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-content-muted">
          {group.eventCount} {group.eventCount === 1 ? "event" : "events"}
        </span>
        <form action={attachErrorAction} className="shrink-0">
          <input type="hidden" name="fingerprint" value={group.fingerprint} />
          {mode === "attach" && <input type="hidden" name="incidentId" value={incidentId} />}
          <input type="hidden" name="from" value={incidentId} />
          <button
            type="submit"
            className="rounded-md border border-border-default px-2 py-0.5 text-[11px] font-medium text-content-secondary transition-colors hover:border-border-strong hover:bg-content-primary/5"
          >
            {mode === "attach" ? "Attach" : "Detach"}
          </button>
        </form>
      </div>
      <p className="pl-[18px] truncate text-[11px] leading-4 text-content-muted">{group.message}</p>
    </div>
  );
}

function formatSignalTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`;
}

function SignalSectionLabel({ children }: { children: string }) {
  return <h3 className="text-[11px] uppercase tracking-wide text-content-muted mb-2">{children}</h3>;
}

function ExceptionsList({ exceptions }: { exceptions: ExceptionGroup[] }) {
  return (
    <section>
      <SignalSectionLabel>Exceptions</SignalSectionLabel>
      <div className="space-y-2">
        {exceptions.map((e, i) => (
          <div key={i} className="flex items-start gap-3 text-sm">
            <span className="shrink-0 rounded-md bg-accent-danger/10 px-1.5 py-0.5 text-xs font-semibold text-accent-danger tabular-nums">
              {e.occurrences}×
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs text-content-secondary">
                {e.exceptionType || "exception"}
                <span className="text-content-muted"> · {e.service}</span>
              </p>
              {e.exceptionMessage && (
                <p className="truncate text-content-secondary">{e.exceptionMessage}</p>
              )}
            </div>
            <span className="shrink-0 text-xs text-content-muted tabular-nums">{formatSignalTime(e.lastSeen)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ErrorSpansList({ spans }: { spans: ErrorSpan[] }) {
  return (
    <section>
      <SignalSectionLabel>Error spans</SignalSectionLabel>
      <div className="space-y-1.5">
        {spans.map((s, i) => (
          <div key={i} className="flex items-center gap-3 text-sm">
            <span className="w-16 shrink-0 text-xs text-content-muted tabular-nums">{formatSignalTime(s.timestamp)}</span>
            <span className="shrink-0 font-mono text-xs text-content-secondary">{s.spanName}</span>
            <span className="shrink-0 text-xs text-content-muted">{s.service}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-content-muted">{s.statusMessage}</span>
            <span className="shrink-0 text-xs text-content-muted tabular-nums">{formatDuration(s.durationMs)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function LogsList({ logs }: { logs: LogLine[] }) {
  return (
    <section>
      <SignalSectionLabel>Error logs</SignalSectionLabel>
      <div className="space-y-1.5">
        {logs.map((l, i) => (
          <div key={i} className="flex items-start gap-3 text-sm">
            <span className="w-16 shrink-0 text-xs text-content-muted tabular-nums">{formatSignalTime(l.timestamp)}</span>
            <span className="shrink-0 text-xs font-semibold uppercase text-accent-danger">{l.severity}</span>
            <span className="shrink-0 text-xs text-content-muted">{l.service}</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-content-secondary">{l.body}</span>
          </div>
        ))}
      </div>
    </section>
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
