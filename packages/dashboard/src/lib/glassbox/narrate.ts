/**
 * Glass Box narration — a PURE function from a typed GlassBoxEvent to a
 * human-readable line in the Synthesizer's voice. No LLM in v1: narration is
 * over structured data, so templates are instant, free, and cannot fabricate
 * (design §4.1). An LLM composer can later swap in behind this same seam.
 */

import type { GlassBoxEvent, GlassBoxSeverity } from "./types";

export interface NarrationItem {
  id: string;
  at: string;
  /** Rendered line in the Synthesizer's voice. */
  text: string;
  tone: GlassBoxSeverity;
  kind: string;
}

const short = (sha?: string) => (sha ? sha.slice(0, 7) : "");

const fileCount = (files?: string[]) =>
  !files || files.length === 0 ? "" : `${files.length} file${files.length === 1 ? "" : "s"}`;

export function narrate(e: GlassBoxEvent): NarrationItem {
  const tone: GlassBoxSeverity = e.severity ?? defaultTone(e.kind);
  return { id: e.id, at: e.at, kind: e.kind, tone, text: renderText(e) };
}

function defaultTone(kind: string): GlassBoxSeverity {
  if (kind.endsWith(".failed") || kind.endsWith(".error")) return "error";
  if (kind === "git.commit" || kind.endsWith(".completed") || kind.endsWith(".kept")) return "success";
  return "info";
}

function renderText(e: GlassBoxEvent): string {
  const r = e.refs ?? {};
  switch (e.kind) {
    case "system.hello": {
      const where = r.branch ? `\`${r.branch}\`${r.sha ? ` @ \`${short(r.sha)}\`` : ""}` : "the local checkout";
      return `Cockpit online — serving ${where}. I'm watching for work as it lands.`;
    }
    case "system.offline":
      return "Live monitor offline — I can't see the local event stream right now.";
    case "git.commit": {
      const files = fileCount(r.files);
      const subject = e.detail ? ` — “${e.detail.split("\n")[0]}”` : "";
      const on = r.branch ? ` on \`${r.branch}\`` : "";
      const sha = r.sha ? ` (\`${short(r.sha)}\`${files ? `, ${files}` : ""})` : files ? ` (${files})` : "";
      return `New work landed${on}${subject}${sha}. Refreshing the map now.`;
    }
    case "git.branch_updated":
      return `Branch \`${r.branch ?? "?"}\` moved${r.sha ? ` to \`${short(r.sha)}\`` : ""} — refreshing.`;
    case "queue.review.active":
      return `A review job just went active${r.jobId ? ` (#${r.jobId})` : ""} — the specialists are picking it up.`;
    case "queue.review.completed":
      return `Review job${r.jobId ? ` #${r.jobId}` : ""} finished.`;
    case "queue.review.failed":
      return `Review job${r.jobId ? ` #${r.jobId}` : ""} failed${e.detail ? `: ${e.detail}` : ""} — it'll back off and retry.`;
    default:
      // Unknown kind: honor the producer's human-readable title, else a
      // generic-but-non-blank line. Never throw, never render empty.
      return e.title && e.title.trim().length > 0 ? e.title : `Activity: ${e.kind}`;
  }
}
