"use client";

import { useActionState, useState } from "react";
import { IconPlus, IconX } from "@tabler/icons-react";
import {
  createInvestigationAction,
  type NewInvestigationState,
} from "@/app/(dashboard)/incidents/actions";

const INITIAL: NewInvestigationState = {};

/**
 * "New investigation" — opens a manual incident. A real create flow: the form
 * posts to createInvestigationAction (a server action that re-checks the hidden
 * installationId against the session before writing). When there is no
 * connected installation there is nothing to open one against, so the trigger
 * is disabled with a hint rather than opening a form that can only fail.
 */
export function NewInvestigationDialog({ installationId }: { installationId: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createInvestigationAction, INITIAL);

  if (!installationId) {
    return (
      <button
        type="button"
        disabled
        title="Connect a repository first to open an investigation"
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-border-default bg-surface-1 px-3 py-1.5 text-sm font-medium text-content-secondary opacity-60"
      >
        <IconPlus className="h-4 w-4" stroke={2} />
        New investigation
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-1 px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:border-border-strong hover:bg-content-primary/5"
      >
        <IconPlus className="h-4 w-4" stroke={2} />
        New investigation
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="New investigation"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border-default bg-surface-1 p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-content-primary">New investigation</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-content-muted transition-colors hover:bg-content-primary/5 hover:text-content-secondary"
                aria-label="Close"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-content-muted">
              Open an incident by hand to investigate a signal from first sight to resolution.
            </p>

            <form action={formAction} className="mt-5 space-y-4">
              <input type="hidden" name="installationId" value={installationId} />

              <div className="space-y-1.5">
                <label htmlFor="inv-title" className="block text-xs font-medium text-content-secondary">
                  Title
                </label>
                <input
                  id="inv-title"
                  name="title"
                  required
                  autoFocus
                  placeholder="e.g. Elevated review latency on api"
                  className="w-full rounded-lg border border-border-default bg-surface-0 px-3 py-2 text-sm text-content-primary placeholder:text-content-muted focus:border-accent-primary focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="inv-severity" className="block text-xs font-medium text-content-secondary">
                  Severity
                </label>
                <select
                  id="inv-severity"
                  name="severity"
                  defaultValue="warning"
                  className="w-full rounded-lg border border-border-default bg-surface-0 px-3 py-2 text-sm text-content-primary focus:border-accent-primary focus:outline-none"
                >
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="inv-summary" className="block text-xs font-medium text-content-secondary">
                  Summary <span className="text-content-muted">(optional)</span>
                </label>
                <textarea
                  id="inv-summary"
                  name="summary"
                  rows={3}
                  placeholder="What are you investigating, and what first signalled it?"
                  className="w-full resize-none rounded-lg border border-border-default bg-surface-0 px-3 py-2 text-sm text-content-primary placeholder:text-content-muted focus:border-accent-primary focus:outline-none"
                />
              </div>

              {state.error && (
                <p className="text-xs text-accent-danger">{state.error}</p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-content-muted transition-colors hover:text-content-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-primary/90 disabled:opacity-60"
                >
                  {pending ? "Opening…" : "Open investigation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
