"use client";

import { IconX, IconFile, IconFolder, IconArrowUpRight, IconArrowDownLeft } from "@tabler/icons-react";
import type { SidebarModel, DepRow } from "@/lib/code-map-sidebar";

export interface CodeMapDrawerProps {
  model: SidebarModel | null;
  onClose: () => void;
  onJump?: (sel: { kind: "file"; id: string }) => void;
}

const SEV_TEXT: Record<string, string> = {
  error: "text-accent-danger",
  warning: "text-accent-warning",
  info: "text-accent-info",
};
const SEV_DOT: Record<string, string> = {
  error: "bg-accent-danger",
  warning: "bg-accent-warning",
  info: "bg-accent-info",
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border-subtle px-4 py-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-content-secondary">{label}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-content-muted">{children}</p>;
}

function DepList({ rows, dir, onJump }: { rows: DepRow[]; dir: "imports" | "importedBy"; onJump?: CodeMapDrawerProps["onJump"] }) {
  if (rows.length === 0) return <Empty>{dir === "imports" ? "Imports nothing outside" : "Nothing imports this"}</Empty>;
  return (
    <ul className="space-y-1">
      {rows.map((d) => (
        <li key={`${dir}-${d.id}`}>
          <button
            type="button"
            onClick={() => onJump?.({ kind: "file", id: d.id })}
            className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border-default hover:bg-content-primary/[0.03]"
          >
            {dir === "imports" ? (
              <IconArrowUpRight size={12} stroke={2} className="shrink-0 text-content-muted" aria-hidden />
            ) : (
              <IconArrowDownLeft size={12} stroke={2} className="shrink-0 text-content-muted" aria-hidden />
            )}
            <span className="truncate font-mono text-[12px] text-content-secondary">{d.label}</span>
            {d.path && <span className="ml-auto truncate font-mono text-[10px] text-content-muted">{d.path}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The code map's detail drawer: Health / Contents / Dependencies / Activity for
 * the selected file or folder. Dumb renderer over buildSidebarModel's output —
 * every join/rollup rule is tested in lib/code-map-sidebar. Honest empties,
 * never fabricated data.
 */
export function CodeMapDrawer({ model, onClose, onJump }: CodeMapDrawerProps) {
  if (!model) return null;
  return (
    <aside className="flex h-full w-full max-w-sm shrink-0 flex-col overflow-y-auto rounded-xl border border-border-subtle bg-surface-1 shadow-[var(--shadow-card)]">
      <header className="flex items-start gap-2.5 px-4 py-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border-default bg-surface-2 text-content-secondary">
          {model.kind === "file" ? (
            <IconFile size={15} stroke={1.75} aria-hidden />
          ) : (
            <IconFolder size={15} stroke={1.75} className="text-accent-secondary" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-sm font-semibold text-content-primary">{model.title}</h2>
          {model.subtitle && <p className="truncate font-mono text-[11px] text-content-muted">{model.subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-content-muted hover:bg-surface-2 hover:text-content-secondary">
          <IconX size={14} stroke={2} />
        </button>
      </header>

      <Section label="Health">
        {model.health.count === 0 ? (
          <Empty>No open findings</Empty>
        ) : (
          <ul className="space-y-1.5">
            {model.health.rows.map((f, i) => (
              <li key={i} className="rounded-lg border border-border-subtle bg-surface-0/50 px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${SEV_DOT[f.severity] ?? "bg-content-muted"}`} aria-hidden />
                  <span className={`text-[10px] font-semibold uppercase tracking-wide ${SEV_TEXT[f.severity] ?? "text-content-muted"}`}>{f.severity}</span>
                  <span className="ml-auto font-mono text-[10px] text-content-muted">{f.path.split("/").pop()}:{f.line}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-content-secondary">{f.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section label={model.kind === "folder" ? "Files" : "Contents"}>
        {model.contents.length === 0 ? (
          <Empty>{model.kind === "folder" ? "No files" : "No indexed functions"}</Empty>
        ) : (
          <ul className="space-y-1">
            {model.contents.map((c) => (
              <li key={c.id}>
                {model.kind === "folder" && onJump ? (
                  <button
                    type="button"
                    onClick={() => onJump({ kind: "file", id: c.id })}
                    className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border-default hover:bg-content-primary/[0.03]"
                  >
                    <span className="truncate font-mono text-[12px] text-content-secondary">{c.label}</span>
                    {c.findingCount > 0 && (
                      <span className={`ml-auto font-mono text-[10px] ${SEV_TEXT[c.maxSeverity ?? ''] ?? 'text-content-muted'}`}>{c.findingCount}</span>
                    )}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-content-muted">{c.kind}</span>
                    <span className="truncate font-mono text-[12px] text-content-secondary">{c.label}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section label="Dependencies">
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-content-muted">Imports</p>
            <DepList rows={model.dependencies.imports} dir="imports" onJump={onJump} />
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-content-muted">Imported by</p>
            <DepList rows={model.dependencies.importedBy} dir="importedBy" onJump={onJump} />
          </div>
        </div>
      </Section>

      <Section label="Agent activity">
        {model.activity.length === 0 ? (
          <Empty>No recent agent activity</Empty>
        ) : (
          <ul className="space-y-1">
            {model.activity.map((a) => (
              <li key={a} className="flex items-center gap-2 text-[12px] text-content-secondary">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-primary" aria-hidden />
                {a}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </aside>
  );
}
