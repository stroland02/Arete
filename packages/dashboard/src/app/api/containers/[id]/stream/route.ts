/**
 * GET /api/containers/[id]/stream — Server-Sent Events transcript stream.
 * See docs/superpowers/specs/2026-07-13-synthesizer-component-and-critic.md §5.1.
 *
 * Emits `init` (the container snapshot), then one `step` event per SynthStep in
 * order, then a terminal `done`. One-directional and append-only, so SSE — not a
 * WebSocket — is the right primitive. Tenancy-scoped: the container is resolved
 * only under an installation the caller holds (plus the sample tenant, since no
 * real GitHub installs exist yet — see auth.ts). Not-found is uniform.
 */

import { auth } from "@/lib/auth";
import { sampleContainerStore } from "@/lib/issue-pipeline/container-store";
import { SAMPLE_INSTALLATION_ID } from "@/lib/issue-pipeline/sample-containers";
import type { IssueContainer } from "@/lib/issue-pipeline/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const store = sampleContainerStore;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;

  // Scope to the caller's installations; the sample tenant is appended because
  // real installs are always [] until GitHub linking lands (auth.ts). Real
  // installations win when they exist — swap this list for the DB scope then.
  const scopes = [...(session.installations ?? []).map((i) => i.id), SAMPLE_INSTALLATION_ID];
  let found: IssueContainer | null = null;
  for (const installationId of scopes) {
    found = await store.get(installationId, id);
    if (found) break;
  }
  if (!found) {
    return new Response("Not found", { status: 404 });
  }
  const container = found;

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};

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
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
      );
    },
    cancel() {
      unsubscribe();
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
