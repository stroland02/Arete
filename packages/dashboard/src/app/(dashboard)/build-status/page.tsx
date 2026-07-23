import Link from "next/link";
import { IconArrowRight, IconExternalLink } from "@tabler/icons-react";
import { ReadinessBadge, type ReadinessLevel } from "@/components/ui/readiness-badge";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { BuildStatusEditor } from "@/components/dashboard/build-status-editor";
import { readTracker, trackerWritability } from "@/lib/build-tracker/store";
import {
  byImportanceThenRank,
  droppedItems,
  programmeProgress,
  readinessTotals,
  resolveBlockers,
  unverifiedCount,
} from "@/lib/build-tracker/select";
import type { Importance, TrackedItem, TrackerDoc } from "@/lib/build-tracker/schema";

export const metadata = { title: "Build status · Kuma" };

/**
 * The page reads a file, so it must never be statically cached — an edit has to
 * be visible on the next request.
 */
export const dynamic = "force-dynamic";

/**
 * Build status — one page showing how finished every part of Kuma is.
 *
 * This exists so unfinished work is visible in the product rather than only in
 * a doc: what is real, what is half-wired, what is built but has no way in yet,
 * and what was proposed and never started.
 *
 * The source of truth is `data/build-tracker.json` — one git-tracked record, so
 * every edit lands as a reviewable diff. It replaced a second, smaller list in
 * `lib/feature-readiness.ts`; two records for one thing drift, and the drift is
 * always found by whoever plans off the stale one.
 */

/**
 * Importance bands, keeping the labels the page has always used. `critical`
 * reads as P0 and so on, so the vocabulary a reader already knows survives the
 * change of source.
 */
const BANDS: { importance: Importance; key: string; label: string }[] = [
  { importance: "critical", key: "P0", label: "Blocks trust" },
  { importance: "high", key: "P1", label: "Next up" },
  { importance: "medium", key: "P2", label: "Planned" },
  { importance: "low", key: "P3", label: "Someday" },
];

export default async function BuildStatusPage() {
  const tracker = await readTracker();

  // An unreadable tracker says so, with the errors. A blank page would read as
  // "nothing is being tracked", which is the opposite of the truth.
  if (!tracker.ok) {
    return (
      <PageReveal className="space-y-6">
        <RevealItem>
          <header className="space-y-2">
            <h1 className="text-3xl font-semibold text-content-primary">Build status</h1>
            <p className="text-sm text-content-secondary">
              The tracker could not be read, so nothing below can be trusted to be complete.
            </p>
          </header>
        </RevealItem>
        <RevealItem>
          <ul className="glass-panel space-y-1.5 rounded-xl px-4 py-3.5">
            {tracker.errors.map((error) => (
              <li key={error} className="font-mono text-[11.5px] leading-5 text-accent-danger">
                {error}
              </li>
            ))}
          </ul>
        </RevealItem>
      </PageReveal>
    );
  }

  const doc = tracker.doc;
  const totals = readinessTotals(doc);
  const writability = trackerWritability();

  const live = doc.items.filter((i) => i.state !== "dropped");
  const ideas = live.filter((i) => i.lane === "idea");
  const dropped = droppedItems(doc);
  const unverified = unverifiedCount(doc);

  return (
    <PageReveal className="space-y-8">
      <RevealItem>
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-content-primary">Build status</h1>
          <p className="text-sm text-content-secondary">
            How finished each part of Kuma actually is — including work that exists in the
            backend but has no way in yet, and ideas that were proposed and never started.
          </p>
        </header>
      </RevealItem>

      <RevealItem>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Readiness counts describe the audited product surfaces only. Counting
            the idea catalogue here would take "not wired up" from ten to sixty
            and turn an honest summary into an alarmist one, so the ideas carry
            their own separately-labelled count.
          */}
          <SummaryChip level="live" count={totals.live} label="working" />
          <SummaryChip level="partial" count={totals.partial} label="partly wired" />
          <SummaryChip level="soon" count={totals.soon} label="not wired up" />
          {totals.preview > 0 ? (
            <SummaryChip level="preview" count={totals.preview} label="sample data" />
          ) : null}
          <span className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-1 px-3 py-1">
            <span className="text-xs text-content-secondary">
              <span className="font-mono font-semibold tabular-nums text-content-primary">
                {ideas.length}
              </span>{" "}
              catalogued, not started
            </span>
          </span>
        </div>
      </RevealItem>

      {writability.writable ? (
        <RevealItem>
          <BuildStatusEditor names={live.map((item) => item.title)} />
        </RevealItem>
      ) : (
        <RevealItem>
          <p className="glass-panel rounded-xl px-4 py-3 text-xs text-content-muted">
            {writability.detail}
          </p>
        </RevealItem>
      )}

      <RevealItem>
        <ProgrammeRails doc={doc} />
      </RevealItem>

      {BANDS.map(({ importance, key, label }) => {
        const items = live.filter((i) => i.importance === importance).sort(byImportanceThenRank);
        if (items.length === 0) return null;
        return (
          <RevealItem key={key}>
            <section className="space-y-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {key} · {label}
                </h2>
                <span className="font-mono text-[11px] tabular-nums text-content-muted">
                  {items.length}
                </span>
              </div>
              <ul className="glass-panel divide-y divide-border-subtle overflow-hidden rounded-xl">
                {items.map((item) => (
                  <ItemRow key={item.id} item={item} doc={doc} />
                ))}
              </ul>
            </section>
          </RevealItem>
        );
      })}

      {dropped.length > 0 ? (
        <RevealItem>
          <details className="glass-panel rounded-xl px-4 py-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-content-muted">
              Dropped · {dropped.length}
            </summary>
            <ul className="mt-3 space-y-2">
              {dropped.map((item) => (
                <li key={item.id} className="text-[12.5px] leading-5 text-content-muted">
                  <span className="text-content-secondary">{item.title}</span>
                  {item.droppedReason ? ` — ${item.droppedReason}` : null}
                </li>
              ))}
            </ul>
          </details>
        </RevealItem>
      ) : null}

      <RevealItem>
        <div className="space-y-1 text-xs text-content-muted">
          <p>
            {live.length} tracked items ({live.length - ideas.length} audited surfaces,{" "}
            {ideas.length} catalogued ideas). Source:{" "}
            <span className="font-mono">data/build-tracker.json</span>.
          </p>
          {/*
            A standing nag rather than a one-off note. The catalogue transcribes
            the audits it cites; it did not re-confirm each claim against the
            code, and absence of a check must never read as a passing check.
          */}
          {unverified > 0 ? (
            <p>
              {unverified} of these claims have never been verified against the code. Each row
              carries its source so it can be checked.
            </p>
          ) : null}
        </div>
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
        <span className="font-mono font-semibold tabular-nums text-content-primary">{count}</span>{" "}
        {label}
      </span>
    </span>
  );
}

const PHASE_TONE: Record<string, string> = {
  done: "bg-accent-success/70",
  "in-progress": "bg-accent-warning/70",
  "not-started": "bg-content-primary/15",
  deferred: "bg-content-primary/10",
  stale: "bg-accent-danger/50",
};

/**
 * Movement through each programme, as separate rails.
 *
 * Deliberately never summed across programmes. Four independent numbering
 * systems run here at once, and a single combined figure would invent a
 * progression that does not exist — precisely the confusion that made "which
 * Phase 2 do you mean?" unanswerable.
 */
function ProgrammeRails({ doc }: { doc: TrackerDoc }) {
  const rails = programmeProgress(doc);
  if (rails.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-muted">
          Phase progression
        </h2>
        <span className="text-[11px] text-content-muted/70">
          {rails.length} numbering systems, not one sequence
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rails.map(({ programme, done, total }) => (
          <div key={programme.id} className="glass-panel rounded-xl px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-content-primary">{programme.label}</span>
              <span className="font-mono text-[11px] tabular-nums text-content-muted">
                {done}/{total}
              </span>
            </div>
            <div
              className="mt-2 flex gap-1"
              role="img"
              aria-label={`${programme.label}: ${done} of ${total} phases done`}
            >
              {programme.phases.map((phase) => (
                <span
                  key={phase.key}
                  title={`${phase.key} — ${phase.label} (${phase.state})`}
                  className={`h-1.5 flex-1 rounded-full ${
                    PHASE_TONE[phase.state] ?? "bg-content-primary/10"
                  }`}
                />
              ))}
            </div>
            {/*
              The caveat is shown, not hidden behind a tooltip: a reader needs it
              BEFORE trusting any number in the row, and a roadmap marked stale
              that reads as current is how planning goes wrong.
            */}
            <p className="mt-2 text-[11.5px] leading-4 text-content-muted">
              {programme.standing === "stale" ? (
                <span className="font-semibold text-accent-warning">Stale — </span>
              ) : null}
              {programme.caveat}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function sourceOf(item: TrackedItem): string | null {
  const p = item.provenance;
  if (!p) return null;
  return p.doc ?? p.commit ?? p.session ?? p.note ?? null;
}

function ItemRow({ item, doc }: { item: TrackedItem; doc: TrackerDoc }) {
  const { title, level, href, works, gap, evidence, area, lane, state } = item;
  const blockers = resolveBlockers(doc, item);
  const source = sourceOf(item);

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
        <span className="text-[10px] uppercase tracking-wider text-content-muted/70">
          {area}
          {lane === "idea" ? <span className="ml-1.5 normal-case">· not started</span> : null}
          {state === "blocked" || state === "needs-decision" ? (
            <span className="ml-1.5 normal-case text-accent-warning/80">
              · {state.replace("-", " ")}
            </span>
          ) : null}
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

      {blockers.length > 0 ? (
        <p className="mt-1.5 text-[12px] leading-5 text-content-muted">
          <span className="text-content-muted/70">Blocked by </span>
          {blockers.map((b, i) => (
            <span key={`${b.label}-${i}`}>
              {i > 0 ? "; " : ""}
              {b.label}
              {b.state ? <span className="text-content-muted/70"> ({b.state})</span> : null}
            </span>
          ))}
        </p>
      ) : null}

      {evidence || source ? (
        <p className="mt-1.5 font-mono text-[10px] tracking-tight text-content-muted/70">
          {evidence ?? source}
        </p>
      ) : null}
    </li>
  );
}
