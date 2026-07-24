/**
 * The rules this project holds itself to.
 *
 * These eight have been in `build-tracker.json` since it was seeded and were
 * rendered nowhere — dead data in the one file that is supposed to be the
 * single source of truth, on the one page whose whole job is honest
 * self-reporting. They belong here specifically: the rows below say how
 * finished each part is, and these say what "finished" is allowed to mean.
 *
 * Rendered above the status rows on purpose — they are the reading
 * instructions for everything under them, not an appendix.
 *
 * NOTE for the lane that owns `src/lib/build-tracker.ts`: each principle in the
 * JSON also carries a `source` (the doc it was drawn from), but the
 * `principles` type omits it, so it cannot be rendered type-safely from here.
 * Adding `source?: string` to that type would let this show provenance, which
 * is exactly what the rest of the page does for every other claim.
 */
"use client";

import { useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";

export function Principles({
  principles,
}: {
  principles: { id: string; title: string; body: string; source?: string }[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (principles.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-muted">
          How we build
        </h2>
        <span className="font-mono text-[11px] tabular-nums text-content-muted">
          {principles.length}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {principles.map((principle) => {
          const isOpen = openId === principle.id;
          return (
            <div
              key={principle.id}
              className="group glass-panel rounded-xl border border-border-subtle bg-surface-1 overflow-hidden transition-all duration-300 hover:border-accent-primary/40 hover:shadow-sm"
            >
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : principle.id)}
                className="flex w-full cursor-pointer items-center justify-between px-4 py-3 outline-none focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent-primary/50"
              >
                <div className="flex flex-col items-start gap-1">
                  <h3 className="text-sm font-medium text-content-primary transition-colors group-hover:text-accent-primary">
                    {principle.title}
                  </h3>
                  {principle.source && (
                    <span className="text-[10px] uppercase tracking-wider text-content-muted/70">
                      {principle.source}
                    </span>
                  )}
                </div>
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-content-muted transition-transform duration-300 group-hover:text-accent-primary ${
                    isOpen ? "-rotate-180" : ""
                  }`}
                >
                  <IconChevronDown size={14} stroke={2} />
                </div>
              </button>

              <div
                className={`grid transition-all duration-300 ease-in-out ${
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="px-4 pb-4 pt-1">
                    <p className="text-[13px] leading-relaxed text-content-secondary border-t border-border-subtle/50 pt-3">
                      {principle.body}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
