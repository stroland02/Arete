import Link from "next/link";
import { IconArrowRight, IconExternalLink, IconFlame } from "@tabler/icons-react";
import { ReadinessBadge } from "@/components/ui/readiness-badge";
import { TrackerItem, verificationLabel } from "@/lib/build-tracker";

export function FocusRail({ items }: { items: TrackerItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent-warning">
          <IconFlame size={14} stroke={2.5} />
          Focus Rail
        </h2>
        <span className="font-mono text-[11px] tabular-nums text-content-muted">
          Top {items.length} open items
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.id}
            className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-accent-warning/20 bg-gradient-to-br from-surface-1 to-surface-2 p-4 shadow-sm transition-all hover:border-accent-warning/40 hover:shadow-md"
          >
            {/* Subtle glow effect */}
            <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-accent-warning/5 blur-2xl transition-all group-hover:bg-accent-warning/10" />

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <ReadinessBadge level={item.level} />
                <span className="rounded bg-accent-warning/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-accent-warning">
                  {item.importance}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-content-muted/70">
                  {item.area}
                </span>
              </div>

              <div className="space-y-1.5">
                {item.href ? (
                  <Link
                    href={item.href}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-content-primary transition-colors hover:text-accent-primary"
                  >
                    {item.title}
                    <IconExternalLink size={13} stroke={2} className="text-content-muted" />
                  </Link>
                ) : (
                  <h3 className="text-sm font-semibold text-content-primary">{item.title}</h3>
                )}
                
                {item.works ? (
                  <p className="line-clamp-2 text-[12px] leading-relaxed text-content-secondary">
                    {item.works}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {item.gap ? (
                <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-content-muted">
                  <IconArrowRight
                    size={13}
                    stroke={2}
                    className="mt-0.5 shrink-0 text-accent-warning/70"
                    aria-hidden
                  />
                  <span className="line-clamp-2">{item.gap}</span>
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-between border-t border-border-subtle/50 pt-3">
                <span className="text-[9px] uppercase tracking-wider text-content-muted/50">
                  {verificationLabel(item)}
                </span>
                {item.provenance?.doc || item.evidence ? (
                  <span className="font-mono text-[9px] tracking-tight text-content-muted/70">
                    {[item.evidence, item.provenance?.doc].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
