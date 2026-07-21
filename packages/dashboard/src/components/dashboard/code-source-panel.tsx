"use client";

import { useEffect, useState } from "react";
import { IconFile, IconX } from "@tabler/icons-react";
import { buildSourceLines, type SourceFindingLike, type SourceLine } from "@/lib/code-map-source";

/**
 * The code map's reading panel: the selected file's live source (fetched from
 * GitHub via the session-scoped /api/code-map/file route) as minimal monospace
 * with line numbers and severity markers on lines carrying open findings.
 * Deliberately austere — no toolbar, no syntax colors; only what the reader
 * needs (Marble & Ink discipline: severity colors are the only accents here).
 *
 * Split presentational/container so every render state is testable under
 * renderToStaticMarkup without a fetch.
 */

export type SourceViewState =
  | { kind: "loading" }
  | { kind: "ok"; lines: SourceLine[]; truncated: boolean }
  | { kind: "binary" }
  | { kind: "too_large" }
  | { kind: "not_found" }
  | { kind: "unavailable" };

const STATE_COPY: Record<string, string> = {
  binary: "Binary file — no text preview.",
  too_large: "This file is too large to preview.",
  not_found: "File not found in the repository (it may have moved since the last index).",
  unavailable: "Source is unavailable right now — try again shortly.",
};

const SEV_ROW: Record<string, string> = {
  error: "bg-accent-danger/10",
  warning: "bg-accent-warning/10",
  info: "bg-accent-info/10",
};
const SEV_DOT: Record<string, string> = {
  error: "bg-accent-danger",
  warning: "bg-accent-warning",
  info: "bg-accent-info",
};

export function CodeSourceView({
  path,
  state,
  onClose,
}: {
  path: string;
  state: SourceViewState;
  onClose: () => void;
}) {
  return (
    <aside className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-1 shadow-[var(--shadow-card)]">
      <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
        <IconFile size={14} stroke={1.75} className="shrink-0 text-content-secondary" aria-hidden />
        <span className="truncate font-mono text-[12px] font-semibold text-content-primary">{path}</span>
        {state.kind === "ok" && state.truncated && (
          <span className="shrink-0 rounded-full border border-border-default bg-surface-2 px-2 py-0.5 text-[10px] text-content-muted">
            Large file — showing the first part
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close source view"
          className="ml-auto rounded p-1 text-content-muted hover:bg-surface-2 hover:text-content-secondary"
        >
          <IconX size={14} stroke={2} />
        </button>
      </header>

      {state.kind === "loading" && (
        <div className="flex-1 space-y-2 p-4" aria-label="Loading source">
          <span className="sr-only">Loading…</span>
          {[80, 60, 90, 40, 70].map((w, i) => (
            <div key={i} className="h-3 animate-pulse rounded bg-surface-2" style={{ width: `${w}%` }} aria-hidden />
          ))}
        </div>
      )}

      {state.kind === "ok" && (
        <pre className="flex-1 overflow-auto py-2 font-mono text-[12px] leading-5 text-content-secondary">
          {state.lines.map((l) => (
            <div
              key={l.n}
              data-severity={l.severity ?? undefined}
              title={l.note}
              className={`flex gap-3 px-3 ${l.severity ? (SEV_ROW[l.severity] ?? "") : ""}`}
            >
              <span className="w-9 shrink-0 select-none text-right text-content-muted/70" aria-hidden>
                {l.n}
              </span>
              <span className="relative min-w-0 flex-1 whitespace-pre">
                {l.severity && (
                  <span
                    className={`absolute -left-2 top-1.5 h-1.5 w-1.5 rounded-full ${SEV_DOT[l.severity] ?? "bg-content-muted"}`}
                    aria-hidden
                  />
                )}
                {l.text || " "}
              </span>
            </div>
          ))}
          {state.lines.length === 0 && <div className="px-3 text-content-muted">Empty file.</div>}
        </pre>
      )}

      {state.kind !== "loading" && state.kind !== "ok" && (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-content-muted">
          {STATE_COPY[state.kind]}
        </div>
      )}
    </aside>
  );
}

export function CodeSourcePanel({
  path,
  findings,
  onClose,
}: {
  path: string;
  findings: SourceFindingLike[];
  onClose: () => void;
}) {
  const [state, setState] = useState<SourceViewState>({ kind: "loading" });

  // Reset to the loading skeleton the instant `path` or `findings` changes,
  // rather than in the effect below — adjusting state during render (per
  // https://react.dev/learn/you-might-not-need-an-effect) avoids painting a
  // frame of the *previous* file's content under the new path before the
  // effect gets a chance to run.
  const [prevPath, setPrevPath] = useState(path);
  const [prevFindings, setPrevFindings] = useState(findings);
  if (path !== prevPath || findings !== prevFindings) {
    setPrevPath(path);
    setPrevFindings(findings);
    setState({ kind: "loading" });
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/code-map/file?path=${encodeURIComponent(path)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | { ok: true; text: string; truncated: boolean }
          | { ok: false; reason?: string }
          | null;
        if (cancelled) return;
        if (body && "ok" in body && body.ok === true) {
          setState({ kind: "ok", lines: buildSourceLines(body.text, findings), truncated: body.truncated });
        } else {
          const reason = body && "reason" in body ? body.reason : undefined;
          setState(
            reason === "binary" || reason === "too_large" || reason === "not_found"
              ? { kind: reason }
              : { kind: "unavailable" },
          );
        }
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [path, findings]);

  // Esc closes the panel — the one keyboard affordance a reading pane needs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return <CodeSourceView path={path} state={state} onClose={onClose} />;
}
