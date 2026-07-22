import Link from "next/link";
import { IconArrowRight, IconCircleCheck, IconCircleDashed } from "@tabler/icons-react";
import type { OverviewSetup, SetupSubStep } from "@/lib/overview-setup";
import { ReadinessBadge } from "@/components/ui/readiness-badge";

/**
 * The Overview onboarding → next-action card. Renders the four-step honest
 * setup narrative from `deriveOverviewSetup` (Account-State Contract — every
 * checkmark is a real DB fact). Server-renderable: no state, no handlers.
 *
 * It never disappears: once steps 1–3 are done it evolves into the "act on
 * what Kuma found" step of the workflow, with the optional step-4 extensions
 * appended as link chips.
 */
export function OverviewSetupCard({
  setup,
  criticalBugs,
}: {
  setup: OverviewSetup;
  criticalBugs: number;
}) {
  const { steps, doneCount, setupComplete, nextStep } = setup;
  const extendLeftovers = steps[3]?.subSteps?.filter((s) => s.status !== "done") ?? [];

  return (
    <section className="rounded-2xl border border-border-default bg-surface-1 p-6">
      {setupComplete ? (
        /* Setup done — point at acting on findings (the next step in how
           Kuma actually resolves what it found). */
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-content-primary">
              You&apos;re set up — here&apos;s what&apos;s next
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full border border-accent-success/25 bg-accent-success/10 px-2 py-0.5 text-[10px] font-medium text-accent-success">
              <IconCircleCheck className="h-3 w-3" stroke={2.25} />
              Setup complete
            </span>
          </div>

          <div className="mt-5 flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface-0/50 p-5 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-content-primary">
                {criticalBugs > 0
                  ? `Act on ${criticalBugs} critical finding${criticalBugs === 1 ? "" : "s"} Kuma caught`
                  : "Review Kuma's findings and approve fixes"}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-content-muted">
                Each finding comes with a proposed fix and the evidence behind it. Open the
                Services workspace to review it, approve the change, and let Kuma open the
                pull request.
              </p>
            </div>
            <Link
              href="/services"
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-accent-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/90"
            >
              Review findings
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Optional step-4 extensions still on the table — small chips, never
              a checklist resurrection. */}
          {extendLeftovers.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {extendLeftovers.map((sub) =>
                sub.status !== "coming_soon" && sub.href ? (
                  <Link
                    key={sub.id}
                    href={sub.href}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border-default bg-surface-1 px-2.5 py-1 text-[11px] text-content-muted transition-colors hover:border-accent-primary/40 hover:text-content-secondary"
                  >
                    {sub.label}
                    <IconArrowRight className="h-3 w-3" />
                  </Link>
                ) : (
                  <span
                    key={sub.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border-default bg-surface-2 px-2.5 py-1 text-[11px] text-content-muted"
                  >
                    {sub.label}
                    <ReadinessBadge level="soon" />
                  </span>
                )
              )}
            </div>
          )}
        </>
      ) : (
        /* Still setting up — the four-step narrative checklist. */
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-content-primary">
              Finish setting up Kuma
            </h2>
            <span className="font-mono text-xs text-content-muted">
              {doneCount} of {steps.length}
            </span>
          </div>

          {/* progress bar */}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent-primary transition-all"
              style={{ width: `${(doneCount / steps.length) * 100}%` }}
            />
          </div>

          {/* current-step highlight — driven entirely by the derived nextStep */}
          {nextStep && (
            <div className="mt-5 flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface-0/50 p-5 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="text-sm font-medium text-content-primary">{nextStep.label}</p>
                <p className="mt-0.5 text-xs leading-5 text-content-muted">{nextStep.detail}</p>
              </div>
              {nextStep.cta && (
                <Link
                  href={nextStep.cta.href}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-accent-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/90"
                >
                  {nextStep.cta.label}
                  <IconArrowRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          )}

          {/* the four numbered steps — serif numerals are the design signature */}
          <ol className="mt-6 space-y-5">
            {steps.map((step, index) => (
              <li key={step.id} className="flex gap-4">
                <span
                  className="w-5 shrink-0 text-right font-serif text-xl leading-6 text-content-muted/60"
                  aria-hidden
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5 text-sm">
                    {step.done ? (
                      <IconCircleCheck
                        className="h-4 w-4 shrink-0 text-accent-success"
                        stroke={2}
                      />
                    ) : (
                      <IconCircleDashed
                        className="h-4 w-4 shrink-0 text-content-muted/60"
                        stroke={2}
                      />
                    )}
                    <span className={step.done ? "text-content-secondary" : "text-content-muted"}>
                      {step.label}
                    </span>
                  </div>
                  {step.subSteps && step.subSteps.length > 0 && (
                    <ul className="mt-2 space-y-1.5 pl-[26px]">
                      {step.subSteps.map((sub) => (
                        <SubStepRow key={sub.id} sub={sub} />
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/** A sub-step under a numbered step. `coming_soon` is guidance, not a task:
 *  it gets a pill and its detail as guided text — NEVER a checkbox. */
function SubStepRow({ sub }: { sub: SetupSubStep }) {
  if (sub.status === "coming_soon") {
    return (
      <li className="flex flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-xs text-content-muted">
          <ReadinessBadge level="soon" />
          {sub.label}
        </span>
        {sub.detail && (
          <p className="text-[11px] leading-4 text-content-muted/70">{sub.detail}</p>
        )}
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2 text-xs">
      {sub.status === "done" ? (
        <IconCircleCheck className="h-3.5 w-3.5 shrink-0 text-accent-success" stroke={2} />
      ) : (
        <IconCircleDashed className="h-3.5 w-3.5 shrink-0 text-content-muted/60" stroke={2} />
      )}
      {sub.href ? (
        <Link
          href={sub.href}
          className={`${
            sub.status === "done" ? "text-content-secondary" : "text-content-muted"
          } transition-colors hover:text-content-primary hover:underline`}
        >
          {sub.label}
        </Link>
      ) : (
        <span className={sub.status === "done" ? "text-content-secondary" : "text-content-muted"}>
          {sub.label}
        </span>
      )}
    </li>
  );
}

