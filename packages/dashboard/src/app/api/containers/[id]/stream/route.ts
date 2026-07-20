/**
 * GET /api/containers/[id]/stream — Server-Sent Events transcript stream.
 * See docs/superpowers/specs/2026-07-13-synthesizer-component-and-critic.md §5.1.
 *
 * The container id IS a Kuma review id. We resolve the REAL review (tenancy-
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

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { InMemoryContainerStore } from "@/lib/issue-pipeline/container-store";
import { getLiveSampleContainer } from "@/lib/issue-pipeline/live-drive";
import { getReviewContainer } from "@/lib/issue-pipeline/review-container-store";
import { getStoredContainer } from "@/lib/issue-pipeline/stored-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;
  const installationIds = (session.installations ?? []).map((i) => i.id);
  // Resolution order: review projection → PERSISTED fix container (the
  // healing loop's real, incrementally-saved transcript — spec §4/§9, never
  // the sample for a real row) → tenant-neutral sample fallback.
  const container =
    (await getReviewContainer(db, installationIds, id)) ??
    (await getStoredContainer(db, installationIds, id)) ??
    getLiveSampleContainer(id);
  if (!container) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  // A single-container store reuses the tested pacing + terminal-vs-live logic.
  const store = new InMemoryContainerStore([container]);
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("init", container);
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
