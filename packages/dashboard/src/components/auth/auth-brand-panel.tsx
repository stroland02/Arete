import Link from "next/link";
import { IconCheck, IconTopologyStar3 } from "@tabler/icons-react";

// Left-hand marketing panel shared by the /login and /signup split-screen
// layouts. Presentational only. Copy mirrors the landing hero so the brand
// reads consistently from marketing into the auth flow.
const POINTS = [
  "Six specialist agents review every pull request in parallel",
  "A Synthesizer verifies each finding against your actual diff",
  "Only what it can prove is posted to your PR — signal, not noise",
];

export function AuthBrandPanel() {
  return (
    <div className="relative hidden flex-col border-r border-border-subtle bg-surface-1 px-12 py-10 lg:flex">
      <Link href="/" className="flex w-fit items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent-primary/30 bg-accent-primary/10 text-accent-primary">
          <IconTopologyStar3 className="h-4 w-4" stroke={1.75} />
        </span>
        <span className="font-serif text-xl font-semibold tracking-tight text-content-primary">
          Aret<span className="text-accent-secondary">é</span> AI
        </span>
      </Link>

      <div className="my-auto max-w-md">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">
          Verified AI code review
        </p>
        <h1 className="mt-4 font-serif text-4xl font-semibold leading-[1.1] tracking-tight text-content-primary">
          Code review that <span className="italic text-accent-primary">checks its own work</span>.
        </h1>
        <ul className="mt-8 flex flex-col gap-3">
          {POINTS.map((point) => (
            <li key={point} className="flex items-start gap-3 text-sm text-content-secondary">
              <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-success" />
              {point}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-content-muted">© 2026 Areté AI · First 50 PRs free</p>
    </div>
  );
}
