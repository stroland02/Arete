import Link from "next/link";
import { IconCircleCheck, IconCircle } from "@tabler/icons-react";
import { Card } from "@/components/ui/card";

export interface SetupStep {
  id: string;
  label: string;
  done: boolean;
  href?: string;
}

/**
 * Real, non-fabricated setup progress. Every `done` value is a fact the
 * caller derived from an actual query — this component never estimates or
 * pads the fraction shown. Collapses to a small dismissible strip once every
 * step is done, rather than disappearing outright.
 */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  if (allDone) {
    return (
      <div className="glass-panel flex items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-content-primary">
          <IconCircleCheck className="h-4 w-4 text-accent-success" />
          Setup complete — you&apos;re fully orchestrated
        </div>
      </div>
    );
  }

  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-content-primary">
          Get fully orchestrated reviews
        </h2>
        <span className="font-mono text-xs tabular-nums text-content-muted">
          {doneCount} of {steps.length}
        </span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-accent-primary transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="space-y-2.5">
        {steps.map((step) => (
          <li
            key={step.id}
            data-step-done={step.done}
            className="flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5">
              {step.done ? (
                <IconCircleCheck className="h-4 w-4 shrink-0 text-accent-success" />
              ) : (
                <IconCircle className="h-4 w-4 shrink-0 text-content-muted" />
              )}
              <span
                className={
                  step.done
                    ? "text-sm text-content-muted line-through decoration-content-muted/50"
                    : "text-sm text-content-primary"
                }
              >
                {step.label}
              </span>
            </div>
            {!step.done && step.href && (
              <Link
                href={step.href}
                className="shrink-0 text-xs font-medium text-accent-primary hover:text-accent-primary/80"
              >
                Connect →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
