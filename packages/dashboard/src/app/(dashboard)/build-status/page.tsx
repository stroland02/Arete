import Link from "next/link";
import { IconArrowRight, IconExternalLink } from "@tabler/icons-react";
import { ReadinessBadge } from "@/components/ui/readiness-badge";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { BuildStatusEditor } from "@/components/dashboard/build-status-editor";
import {
  IMPORTANCE,
  IMPORTANCE_LABELS,
  byImportance,
  ideaGroups,
  ideas,
  isVerified,
  loadTracker,
  programmeProgress,
  readinessTotals,
  verificationLabel,
  type Importance,
  type ProgrammeProgress,
  type TrackerItem,
} from "@/lib/build-tracker";

export const metadata = { title: "Build status · Kuma" };

/**
 * Build status — one page showing how finished every part of Kuma is, and
 * every idea we have decided not to lose.
 *
 * This exists so unfinished work is visible in the product rather than only in
 * a doc. It reads `data/build-tracker.json`, which can describe capabilities
 * that have no UI to inspect — precisely the category worth surfacing.
 *
 * Two honesty rules are load-bearing here:
 *  - the summary chips count the inventory lane only (see `readinessTotals`);
 *  - nothing renders as verified, because nothing has been.
 */
export default function BuildStatusPage() {
  const tracker = loadTracker();
  const totals = readinessTotals(tracker);
  const groups = ideaGroups(tracker);
  const ideaCount = ideas(tracker).length;
  const verifiedCount = tracker.items.filter(isVerified).length;
  // id -> title, so a blocker reads as the thing blocking you rather than a slug.
  // Built from the WHOLE catalogue, not the rendered subset: a row is regularly
  // blocked by an item sitting in a different section of the page.
  const titles = new Map(tracker.items.map((i) => [i.id, i.title]));

  return (
    <PageReveal className="space-y-8">
      <RevealItem>
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-content-primary">Build status</h1>
          <p className="text-sm text-content-secondary">
            How finished each part of Kuma actually is — including work that exists in the
            backend but has no way in yet, and every idea worth keeping.
          </p>
          <p className="text-xs text-content-muted">{tracker.mission.northStar}</p>
        </header>
      </RevealItem>

      <RevealItem>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SummaryChip level="live" count={totals.live} label="working" />
            <SummaryChip level="partial" count={totals.partial} label="partly wired" />
            <SummaryChip level="soon" count={totals.soon} label="not wired up" />
          </div>
          <p className="text-xs text-content-muted">
            Across the {totals.counted} things that exist today. The {ideaCount} ideas below are
            catalogued separately — counting them here would read as {totals.soon + ideaCount}{" "}
            broken parts, which would not be true.
          </p>
        </div>
      </RevealItem>

      {process.env.NODE_ENV !== "production" ? (
        <RevealItem>
          <BuildStatusEditor items={tracker.items.map((i) => ({ id: i.id, title: i.title }))} />
        </RevealItem>
      ) : null}

      <RevealItem>
        <ProgrammeRails programmes={programmeProgress(tracker)} />
      </RevealItem>

      <RevealItem>
        <Principles principles={tracker.principles} />
      </RevealItem>

      {IMPORTANCE.map((importance) => {
        const rows = byImportance(importance, tracker);
        if (rows.length === 0) return null;
        return (
          <RevealItem key={importance}>
            <Section
              title={`${IMPORTANCE_LABELS[importance]}`}
              count={rows.length}
              items={rows}
              titles={titles}
            />
          </RevealItem>
        );
      })}

      <RevealItem>
        <div className="space-y-2 pt-2">
          <h2 className="text-lg font-semibold text-content-primary">
            Ideas we have not lost
          </h2>
          <p className="text-sm text-content-secondary">
            {ideaCount} ideas gathered from audits, roadmaps and working sessions. These are not
            defects — they are things worth building, kept where they can be seen.
          </p>
        </div>
      </RevealItem>

      {groups.map((group) => (
        <RevealItem key={group.state}>
          <Section
            title={group.label}
            count={group.items.length}
            items={group.items}
            titles={titles}
          />
        </RevealItem>
      ))}

      <RevealItem>
        <p className="text-xs text-content-muted">
          Seeded {tracker.meta.seededAt} from {tracker.meta.seededFrom.length} documents.{" "}
          {/*
            Counted, not asserted. This read "nothing on this page has been
            verified" — which stopped being true the moment the first row was
            checked against the code, and a page whose whole point is honest
            self-reporting cannot carry a claim that decays on its own.
          */}
          {verifiedCount === 0
            ? "Nothing on this page has been verified against running code — every row says so."
            : `${verifiedCount} of ${tracker.items.length} rows have been checked against running code; every other row says “Never verified” and means it.`}
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
  level: "live" | "partial" | "soon";
  count: number;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-1 py-1 pl-1.5 pr-3">
      <ReadinessBadge level={level} />
      <span className="text-xs text-content-secondary">
        <span className="font-mono font-semibold tabular-nums text-content-primary">{count}</span>{" "}
        {label}
      </span>
    </span>
  );
}

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
function Principles({
  principles,
}: {
  principles: { id: string; title: string; body: string }[];
}) {
  if (principles.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-muted">
          How we build
        </h2>
        <span className="font-mono text-[11px] tabular-nums text-content-muted">
          {principles.length}
        </span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {principles.map((principle) => (
          <li key={principle.id} className="glass-panel space-y-1.5 rounded-xl px-3.5 py-3">
            <h3 className="text-sm font-semibold text-content-primary">{principle.title}</h3>
            <p className="text-[12.5px] leading-5 text-content-secondary">{principle.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Four independent rails, never one blended bar.
 *
 * The programmes number their phases separately and one is explicitly stale, so
 * a combined percentage would be meaningless. Each rail shows its own caveat.
 */
function ProgrammeRails({ programmes }: { programmes: ProgrammeProgress[] }) {
  if (programmes.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-content-muted">
        Programmes
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {programmes.map((programme) => {
          const pct = programme.total === 0 ? 0 : Math.round((programme.done / programme.total) * 100);
          const stale = programme.standing === "stale";
          return (
            <div key={programme.id} className="glass-panel space-y-2 rounded-xl px-3.5 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-content-primary">
                  {programme.label}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-content-muted">
                  {programme.done}/{programme.total}
                </span>
              </div>

              <div
                className="h-1.5 overflow-hidden rounded-full bg-content-primary/10"
                role="img"
                aria-label={`${programme.label}: ${programme.done} of ${programme.total} shipped`}
              >
                <div
                  className={`h-full rounded-full ${stale ? "bg-content-muted/50" : "bg-accent-primary/70"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              {programme.phases.length > 0 ? (
                <p className="font-mono text-[10px] tracking-tight text-content-muted/70">
                  phases {programme.phases.join(" · ")}
                </p>
              ) : null}

              <p
                className={`text-[12px] leading-5 ${
                  stale
                    ? "rounded-md border border-accent-warning/25 bg-accent-warning/10 px-2 py-1.5 text-content-secondary"
                    : "text-content-muted"
                }`}
              >
                {stale ? (
                  <span className="font-semibold text-accent-warning">Stale — </span>
                ) : null}
                {programme.caveat}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Resolves a blocker id to something a reader can act on.
 *
 * `blockedBy` holds ids, and this page used to print them raw — a reader saw
 * `agents-layer-inside-services` and had to grep the JSON to learn what was
 * actually in the way. Two shapes exist and they are NOT the same thing:
 *   - an internal id, naming another row on this page, and
 *   - an `ext:`-prefixed blocker, which is outside the catalogue entirely
 *     (an approval, a funded account) and so has no row to point at.
 * An unresolvable internal id falls back to the id itself rather than being
 * dropped — a blocker we cannot name is still a blocker, and hiding it would
 * be worse than showing it ugly.
 */
function describeBlocker(
  id: string,
  titles: Map<string, string>,
): { label: string; external: boolean } {
  if (id.startsWith("ext:")) {
    return { label: id.slice(4).trim() || id, external: true };
  }
  return { label: titles.get(id) ?? id, external: false };
}

function Section({
  title,
  count,
  items,
  titles,
}: {
  title: string;
  count: number;
  items: TrackerItem[];
  titles: Map<string, string>;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-muted">
          {title}
        </h2>
        <span className="font-mono text-[11px] tabular-nums text-content-muted">{count}</span>
      </div>
      <ul className="glass-panel divide-y divide-border-subtle overflow-hidden rounded-xl">
        {items.map((item) => (
          <ItemRow key={item.id} item={item} titles={titles} />
        ))}
      </ul>
    </section>
  );
}

function ItemRow({ item, titles }: { item: TrackerItem; titles: Map<string, string> }) {
  const { title, level, href, works, gap, evidence, area, blockedBy, provenance } = item;
  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {href ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-sm font-medium text-content-primary hover:text-accent-primary"
          >
            {title}
            <IconExternalLink size={13} stroke={1.75} className="text-content-muted" />
          </Link>
        ) : (
          <span className="text-sm font-medium text-content-primary">{title}</span>
        )}
        <ReadinessBadge level={level} />
        <span className="text-[10px] uppercase tracking-wider text-content-muted/70">{area}</span>
        {/* Absence of verifiedAt is stated outright — never rendered as a tick. */}
        <span className="text-[10px] uppercase tracking-wider text-content-muted/50">
          {verificationLabel(item)}
        </span>
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

      {blockedBy && blockedBy.length > 0 ? (
        <p className="mt-1.5 text-[11px] text-content-muted">
          Blocked by{" "}
          {blockedBy.map((id, i) => {
            const { label, external } = describeBlocker(id, titles);
            return (
              <span key={id}>
                {i > 0 ? ", " : ""}
                <span className={external ? "italic" : "font-medium text-content-secondary"}>
                  {label}
                </span>
                {/* An external blocker is named as such: nothing in this repo
                    will clear it, so a reader should not go looking for a row. */}
                {external ? (
                  <span className="text-content-muted/60"> (external)</span>
                ) : null}
              </span>
            );
          })}
        </p>
      ) : null}

      {evidence || provenance?.doc ? (
        <p className="mt-1.5 font-mono text-[10px] tracking-tight text-content-muted/70">
          {[evidence, provenance?.doc].filter(Boolean).join("  ·  ")}
        </p>
      ) : null}
    </li>
  );
}
