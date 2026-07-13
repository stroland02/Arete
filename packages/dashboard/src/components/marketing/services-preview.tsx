import {
  ServicesWorkspace,
  SAMPLE_SERVICES,
  SAMPLE_ISSUES,
} from "@/components/dashboard/services/services-workspace";

/**
 * Landing-page "example interface" — a browser-framed preview of the real
 * /services triage workspace, populated with illustrative SAMPLE_* data so a
 * visitor can see what it looks like once services are connected. The actual
 * authenticated page (packages/dashboard/src/app/(dashboard)/services/page.tsx)
 * never renders this sample data — it starts empty until you connect a tool.
 */
export function ServicesPreview() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="mb-14 text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">Services</span>
        <h2 className="mt-3 font-serif text-3xl font-semibold tracking-tight text-content-primary">
          Every issue, compiled per service
        </h2>
        <p className="mt-3 text-content-muted">
          Once you connect your tools, Areté triages what they report — one place per service, with
          the fix already proposed.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border-default bg-surface-1 shadow-[0_30px_80px_-30px_rgba(26,27,24,0.35)]">
        <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-2/70 px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-3 w-3 rounded-full bg-content-muted/30" />
            <span className="h-3 w-3 rounded-full bg-content-muted/30" />
            <span className="h-3 w-3 rounded-full bg-content-muted/30" />
          </span>
          <span className="mx-auto rounded-md border border-border-subtle bg-surface-0/60 px-4 py-1 font-mono text-xs text-content-muted">
            app.arete.ai/services
          </span>
          <span className="shrink-0 rounded-full border border-border-default bg-surface-2 px-2 py-0.5 text-[10px] font-medium tracking-wide text-content-muted">
            Illustrative
          </span>
        </div>
        <ServicesWorkspace services={SAMPLE_SERVICES} issues={SAMPLE_ISSUES} variant="framed" />
      </div>
      <p className="mt-3 text-center text-xs text-content-muted/70">
        Illustrative example — not live account data.
      </p>
    </section>
  );
}
