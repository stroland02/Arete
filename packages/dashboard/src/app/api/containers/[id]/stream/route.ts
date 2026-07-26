/**
 * GET /api/containers/[id]/stream — Server-Sent Events transcript stream.
 * See docs/superpowers/specs/2026-07-13-synthesizer-component-and-critic.md §5.1.
 *
 * The container id IS a Kuma review id. We resolve the REAL review (tenancy-
/* --- MERGED: PRESERVING UI (HEAD) --- */
 * scoped) and project it into a container, then emit `init` (the snapshot),
 * one `step` per reconstructed SynthStep, and a terminal `done`. A stored review
 * is terminal, so steps emit in order without pacing. No sample data is ever
 * served here — an unknown / not-yours id returns a uniform 404 and the console
 * shows empty.
/* --- MERGED: NEW LOGIC FROM MAIN (COMMENTED OUT FOR REVIEW) --- */
/*
 * scoped) and project it into a container; failing that, we fall back to the
 * driven sample container (live-drive.ts) — the interim live source until the
 * persistent IssueContainer store lands. Real reviews stay tenancy-scoped; the
 * sample is tenant-neutral demo data the console labels with a "Sample" chip.
 *
 * Emission is delegated to InMemoryContainerStore, which paces a LIVE (non-
 * terminal) container so the console animates the solve as steps arrive, and
 * replays a terminal container's history instantly. So a stored review streams
 * exactly as before, while the driven sample streams genuinely live — the
 * transcript is driveContainer's output, not a scripted replay.
*/
/* --- END MERGE --- */
 */

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
/* --- MERGED: PRESERVING UI (HEAD) --- */
import { getReviewContainer } from "@/lib/issue-pipeline/review-container-store";
/* --- MERGED: NEW LOGIC FROM MAIN (COMMENTED OUT FOR REVIEW) --- */
/*
import { InMemoryContainerStore } from "@/lib/issue-pipeline/container-store";
import { getLiveSampleContainer } from "@/lib/issue-pipeline/live-drive";
import { getReviewContainer } from "@/lib/issue-pipeline/review-container-store";
import { getFixContainer } from "@/lib/issue-pipeline/fix-container-store";
*/
/* --- END MERGE --- */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;
  const installationIds = (session.installations ?? []).map((i) => i.id);
/* --- MERGED: PRESERVING UI (HEAD) --- */
  const container = await getReviewContainer(db, installationIds, id);
/* --- MERGED: NEW LOGIC FROM MAIN (COMMENTED OUT FOR REVIEW) --- */
/*
  // Resolve, in order: a real review container, then a fix-born IssueContainer
  // (its persisted drive transcript), then the tenant-neutral sample.
  const container =
    (await getReviewContainer(db, installationIds, id)) ??
    (await getFixContainer(db, installationIds, id)) ??
    getLiveSampleContainer(id);
*/
/* --- END MERGE --- */
  if (!container) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
/* --- MERGED: PRESERVING UI (HEAD) --- */
/* --- MERGED: NEW LOGIC FROM MAIN (COMMENTED OUT FOR REVIEW) --- */
/*
  // A single-container store reuses the tested pacing + terminal-vs-live logic.
  const store = new InMemoryContainerStore([container]);
  let unsubscribe: (() => void) | null = null;

*/
/* --- END MERGE --- */
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("init", container);
/* --- MERGED: PRESERVING UI (HEAD) --- */
      for (const step of container.transcript) {
        send("step", step);
      }
      send("done", { ok: true });
      controller.close();
/* --- MERGED: NEW LOGIC FROM MAIN (COMMENTED OUT FOR REVIEW) --- */
/*
      unsubscribe = store.subscribe(
        container.id,
        (step) => send("step", step),
        () => {
          send("done", { ok: true });
          controller.close();
        },
      );
    },
    cancel() {
      unsubscribe?.();
*/
/* --- END MERGE --- */
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
