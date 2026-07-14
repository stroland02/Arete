import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { AGENTS } from "@/components/dashboard/agents/agent-catalog";
import { sendAgentChat } from "@/lib/agent-chat";

// Session-scoped; never statically prerendered.
export const dynamic = "force-dynamic";

/**
 * Dashboard -> agent chat. Authenticates the session, validates the agent id
 * against the real catalog, then proxies to the Python /chat service via
 * sendAgentChat. On any upstream failure (including a missing model key, which
 * makes the service refuse to start) it returns a truthful 503 — the composer
 * renders that as its honest disabled notice, never a fabricated reply.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  try {
    const reply = await sendAgentChat({ agent, message });
    return NextResponse.json({ reply });
  } catch {
    return NextResponse.json(
      { error: "The agents service is unavailable. Live chat activates when it is running." },
      { status: 503 },
    );
  }
}
