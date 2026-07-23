import Link from "next/link";
import { IconArrowRight, IconExternalLink } from "@tabler/icons-react";
import { ReadinessBadge, type ReadinessLevel } from "@/components/ui/readiness-badge";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { BuildStatusEditor } from "@/components/dashboard/build-status-editor";
import {
  FEATURE_READINESS,
  PRIORITIES,
  PRIORITY_LABELS,
  byPriority,
  phaseProgress,
  readinessTotals,
  type FeatureReadiness,
  type Priority,
} from "@/lib/feature-readiness";

export const metadata = { title: "Build status · Kuma" };

/**
 * Build status — one page showing how finished every part of Kuma is.
 *
 * This exists so unfinished work is visible in the product rather than only in
 * a doc: what is real, what is half-wired, and what is built but has no way in
 * yet. It reads a static inventory, so it can describe capabilities that have
 * no UI to inspect — precisely the category worth surfacing.
 */
export default function BuildStatusPage() {
  const totals = readinessTotals();

  return (
    <PageReveal className="space-y-8">
      <RevealItem>
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-content-primary">Build status</h1>
          <p className="text-sm text-content-secondary">
            How finished each part of Kuma actually is — including work that exists in the
            backend but has no way in yet.
          </p>
        </header>
      </RevealItem>

      <RevealItem>
        <div className="flex flex-wrap items-center gap-2">
          <SummaryChip level="live" count={totals.live} label="working" />
          <SummaryChip level="partial" count={totals.partial} label="partly wired" />
          <SummaryChip level="soon" count={totals.soon} label="not wired up" />
        </div>
      </RevealItem>

      {process.env.NODE_ENV !== "production" ? (
        <RevealItem>
          <BuildStatusEditor names={FEATURE_READINESS.map((f) => f.name)} />
        </RevealItem>
      ) : null}

      <RevealItem>
        <PhaseProgressStrip />
      </RevealItem>

      {[...PRIORITIES, undefined].map((priority) => {
        const features = byPriority(priority);
        if (features.length === 0) return null;
        return (
          <RevealItem key={priority ?? "unprioritised"}>
            <section className="space-y-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {priority ? `${priority} · ${PRIORITY_LABELS[priority]}` : "Unprioritised"}
                </h2>
                <span className="font-mono text-[11px] tabular-nums text-content-muted">
                  {features.length}
                </span>
              </div>
              <ul className="glass-panel divide-y divide-border-subtle overflow-hidden rounded-xl">
                {features.map((feature) => (
                  <FeatureRow key={feature.name} feature={feature} />
                ))}
              </ul>
            </section>
          </RevealItem>
        );
      })}

      <RevealItem>
        <p className="text-xs text-content-muted">
          Audited 22 July 2026. Full evidence in{" "}
          <span className="font-mono">docs/status/2026-07-22-build-status-map.md</span>.
        </p>
      </RevealItem>
    </PageReveal>
  );
}

function SummaryChip({
  level,
  count,
  label,
}: {
  level: ReadinessLevel;
  count: number;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-1 py-1 pl-1.5 pr-3">
      <ReadinessBadge level={level} />
      <span className="text-xs text-content-secondary">
        <span className="font-mono font-semibold tabular-nums text-content-primary">
          {count}
        </span>{" "}
        {label}
      </span>
    </span>
  );
}

/**
 * Movement between phases, not just a flat list — how much of each phase is
 * finished. "Done" means `live`; partial work deliberately does not count, so
 * the bar cannot overstate progress.
 */
function PhaseProgressStrip() {
  const phases = phaseProgress();
  if (phases.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-content-muted">
        Phase progression
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {phases.map(({ phase, done, total }) => {
          const pct = total === 0 ? 0 : Math.round((done / total) * 100);
          return (
            <div key={phase} className="glass-panel rounded-xl px-3.5 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-content-primary">{phase}</span>
                <span className="font-mono text-[11px] tabular-nums text-content-muted">
                  {done}/{total}
                </span>
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-content-primary/10"
                role="img"
                aria-label={`${phase}: ${done} of ${total} finished`}
              >
                <div
                  className="h-full rounded-full bg-accent-primary/70"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FeatureRow({ feature }: { feature: FeatureReadiness }) {
  const { name, level, href, works, gap, evidence, area, ref, needsVerification } = feature;
  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {href ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-sm font-medium text-content-primary hover:text-accent-primary"
          >
            {name}
            <IconExternalLink size={13} stroke={1.75} className="text-content-muted" />
          </Link>
        ) : (
          <span className="text-sm font-medium text-content-primary">{name}</span>
        )}
        <ReadinessBadge level={level} />
        <span className="text-[10px] uppercase tracking-wider text-content-muted/70">
          {area}
          {ref ? <span className="ml-1.5 font-mono normal-case">{ref}</span> : null}
        </span>
      </div>

      {needsVerification ? (
        <p className="mt-1.5 rounded-md border border-accent-warning/25 bg-accent-warning/10 px-2 py-1.5 text-[12px] leading-5 text-content-secondary">
          <span className="font-semibold text-accent-warning">Needs verification — </span>
          {needsVerification}
        </p>
      ) : null}

      {works ? (
        <p className="mt-1.5 text-[12.5px] leading-5 text-content-secondary">{works}</p>
      ) : null}

      {gap ? (
        <p className="mt-1.5 flex gap-1.5 text-[12.5px] leading-5 text-content-muted">
          <IconArrowRight
            size={14}
            stroke={1.75}
            className="mt-0.5 shrink-0 text-content-muted/70"
            aria-hidden
          />
          <span>
            <span className="sr-only">Still missing: </span>
            {gap}
          </span>
        </p>
      ) : null}

      {evidence ? (
        <p className="mt-1.5 font-mono text-[10px] tracking-tight text-content-muted/70">
          {evidence}
        </p>
      ) : null}
    </li>
  );
}
