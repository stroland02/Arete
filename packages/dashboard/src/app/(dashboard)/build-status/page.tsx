import Link from "next/link";
import { IconArrowRight, IconExternalLink } from "@tabler/icons-react";
import { ReadinessBadge, type ReadinessLevel } from "@/components/ui/readiness-badge";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import {
  FEATURE_READINESS,
  READINESS_AREAS,
  readinessTotals,
  type FeatureReadiness,
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

      {READINESS_AREAS.map((area) => {
        const features = FEATURE_READINESS.filter((f) => f.area === area);
        if (features.length === 0) return null;
        return (
          <RevealItem key={area}>
            <section className="space-y-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {area}
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

function FeatureRow({ feature }: { feature: FeatureReadiness }) {
  const { name, level, href, works, gap, evidence } = feature;
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
      </div>

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
