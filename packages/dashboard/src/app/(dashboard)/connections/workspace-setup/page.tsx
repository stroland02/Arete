import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";

export default function WorkspaceSetupPage() {
  return (
    <PageReveal className="mx-auto max-w-3xl space-y-6">
      <RevealItem>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-content-primary">Agent Workspace Setup</h1>
          <p className="text-sm text-content-muted">
            Run the Kuma setup prompt in your coding agent to wire OpenTelemetry and embed the code graph.
          </p>
        </div>
      </RevealItem>
      <RevealItem>
        <div className="glass-panel p-6">
          <p className="text-sm text-content-primary">
            Copy and paste the following prompt into your local agent (e.g., Cline, Cursor, or Antigravity):
          </p>
          <div className="mt-4 rounded-xl border border-border-subtle bg-surface-2 p-4 font-mono text-xs text-content-secondary">
            <code>
              Please configure this repository for Kuma by installing the `@arete/kuma-skills` package, setting up OpenTelemetry to point to the local Kuma collector, and verifying that the project's code graph resolves without errors.
            </code>
          </div>
        </div>
      </RevealItem>
    </PageReveal>
  );
}
