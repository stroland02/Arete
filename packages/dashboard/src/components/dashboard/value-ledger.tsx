/**
 * Quiet, confident page greeting (Noiro / SuperLog / Tsenta-inspired) — no
 * oversized display headline, no metric cards (those live in MetricsGrid;
 * this component previously duplicated them here — see
 * docs/superpowers/specs/2026-07-12-overview-cleanup-and-setup-path-design.md).
 */

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const dateLabel = () =>
  new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

export function ValueLedger() {
  return (
    <div className="flex items-baseline justify-between">
      <h1 className="text-lg font-semibold text-content-primary">
        {greeting()}
        <span className="text-content-muted font-normal"> — here&apos;s what Areté handled for you</span>
      </h1>
      <span className="hidden sm:block text-xs text-content-muted">{dateLabel()}</span>
    </div>
  );
}
