"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconPlus, IconTrash } from "@tabler/icons-react";

/**
 * Local-development editor for the master build tracker.
 *
 * Writes through to `data/build-tracker.json`, so every change you make here
 * shows up as a git diff you review and commit — the tracker stays
 * hand-authored and stays the one thing both this page and the agents read.
 * Rendered only in development; the route behind it 404s in production.
 */

const LANES = ["inventory", "idea"] as const;
const AREAS = [
  "Product surfaces",
  "Built, but unreachable",
  "Partially wired",
  "Not built yet",
] as const;
const LEVELS = ["live", "preview", "partial", "soon"] as const;
const STATES = ["shipped", "next", "blocked", "someday", "needs-decision"] as const;
const IMPORTANCES = ["critical", "high", "medium", "low"] as const;

const EMPTY = {
  title: "",
  lane: "idea" as string,
  area: "Not built yet" as string,
  level: "soon" as string,
  state: "someday" as string,
  importance: "medium" as string,
  works: "",
  gap: "",
  evidence: "",
};

export function BuildStatusEditor({ items }: { items: { id: string; title: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState("");

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function send(url: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status}).`);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the dev route. Is the dev server running?");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const payload = Object.fromEntries(
      Object.entries(form).filter(([, v]) => String(v).trim() !== "")
    );
    const ok = await send("/api/build-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (ok) setForm(EMPTY);
  }

  async function remove() {
    if (!removing) return;
    const ok = await send(`/api/build-status?id=${encodeURIComponent(removing)}`, {
      method: "DELETE",
    });
    if (ok) setRemoving("");
  }

  const field =
    "w-full rounded-lg border border-border-default bg-surface-0 px-2.5 py-1.5 text-sm text-content-primary placeholder:text-content-muted/60";
  const label = "text-[11px] font-medium uppercase tracking-wider text-content-muted";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-1 px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:border-border-strong hover:bg-content-primary/5"
      >
        <IconPlus size={14} stroke={1.75} aria-hidden />
        Edit this list
      </button>
    );
  }

  return (
    <section className="glass-panel space-y-4 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-content-primary">Edit the tracker</h2>
          <p className="mt-0.5 text-xs text-content-muted">
            Writes to <span className="font-mono">data/build-tracker.json</span> — review the diff
            before committing. Development only.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-content-muted hover:text-content-primary"
        >
          Close
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-accent-danger/25 bg-accent-danger/10 px-3 py-2 text-xs text-accent-danger">
          {error}
        </p>
      ) : null}

      <form onSubmit={add} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label} htmlFor="bs-title">What it is</label>
            <input
              id="bs-title"
              className={field}
              value={form.title}
              onChange={set("title")}
              placeholder="In your own words, e.g. Self-serve plan upgrade"
              required
            />
          </div>

          <div>
            <label className={label} htmlFor="bs-lane">Lane</label>
            <select id="bs-lane" className={field} value={form.lane} onChange={set("lane")}>
              {LANES.map((l) => (
                <option key={l} value={l}>
                  {l === "inventory" ? "inventory — it exists today" : "idea — worth building"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="bs-importance">Importance</label>
            <select
              id="bs-importance"
              className={field}
              value={form.importance}
              onChange={set("importance")}
            >
              {IMPORTANCES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="bs-state">State</label>
            <select id="bs-state" className={field} value={form.state} onChange={set("state")}>
              {STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="bs-level">How finished</label>
            <select id="bs-level" className={field} value={form.level} onChange={set("level")}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="bs-area">Area</label>
            <select id="bs-area" className={field} value={form.area} onChange={set("area")}>
              {AREAS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className={label} htmlFor="bs-works">What genuinely works today</label>
            <input id="bs-works" className={field} value={form.works} onChange={set("works")} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="bs-gap">The honest gap</label>
            <input id="bs-gap" className={field} value={form.gap} onChange={set("gap")} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="bs-evidence">Evidence (file:line)</label>
            <input
              id="bs-evidence"
              className={field}
              value={form.evidence}
              onChange={set("evidence")}
              placeholder="so a reader can check the claim"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-primary px-3 text-sm font-medium text-white disabled:opacity-50"
        >
          <IconPlus size={14} stroke={2} aria-hidden />
          Add to the tracker
        </button>
      </form>

      <div className="border-t border-border-subtle pt-3">
        <label className={label} htmlFor="bs-remove">Remove an item</label>
        <div className="mt-1 flex gap-2">
          <select
            id="bs-remove"
            className={field}
            value={removing}
            onChange={(e) => setRemoving(e.target.value)}
          >
            <option value="">— pick one —</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>{i.title}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={remove}
            disabled={busy || !removing}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-accent-danger/30 px-3 text-sm font-medium text-accent-danger disabled:opacity-40"
          >
            <IconTrash size={14} stroke={1.75} aria-hidden />
            Remove
          </button>
        </div>
      </div>
    </section>
  );
}
