/**
 * GET /api/containers/[id]/stream — Server-Sent Events transcript stream.
 * See docs/superpowers/specs/2026-07-13-synthesizer-component-and-critic.md §5.1.
 *
 * The container id IS a Kuma review id. We resolve the REAL review (tenancy-
 * scoped) and project it into a container, then emit `init` (the snapshot),
 * one `step` per reconstructed SynthStep, and a terminal `done`. A stored review
 * is terminal, so steps emit in order without pacing. No sample data is ever
 * served here — an unknown / not-yours id returns a uniform 404 and the console
 * shows empty.
 */

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getReviewContainer } from "@/lib/issue-pipeline/review-container-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;
  const installationIds = (session.installations ?? []).map((i) => i.id);
  const container = await getReviewContainer(db, installationIds, id);
  if (!container) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("init", container);
      for (const step of container.transcript) {
        send("step", step);
      }
      send("done", { ok: true });
      controller.close();
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
