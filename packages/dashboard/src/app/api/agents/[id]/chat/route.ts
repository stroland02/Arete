import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { AGENTS } from "@/components/dashboard/agents/agent-catalog";
import { sendAgentChat } from "@/lib/agent-chat";
import { resolveActiveLlmForChat } from "@/lib/model-connections-api";
import { listChatTurns, appendChatTurn } from "@/lib/agent-chat-history";

// Session-scoped; never statically prerendered.
export const dynamic = "force-dynamic";

function resolveAgent(id: string) {
  return AGENTS.find((a) => a.id === id) ?? null;
}

/** ?containerId= scopes the thread to a specific work item/problem; omitted
 *  (or blank) is the "general" thread for this agent. */
function containerIdFromParam(value: string | null): string | null {
  return value && value.trim() ? value.trim() : null;
}

/**
 * GET /api/agents/[id]/chat?containerId= — the thread's saved turns, oldest
 * first, so switching agents (or work items) and coming back restores the
 * conversation instead of starting blank. Never fails the page: an unreadable
 * history renders as an empty thread.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!resolveAgent(id)) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
  }

  const containerId = containerIdFromParam(req.nextUrl.searchParams.get("containerId"));
  const turns = await listChatTurns(id, containerId);
  return NextResponse.json({ turns });
}

/**
 * Dashboard -> agent chat. Authenticates the session, validates the agent id
 * against the real catalog, then proxies to the Python /chat service via
 * sendAgentChat. On any upstream failure (including a missing model key, which
 * makes the service refuse to start) it returns a truthful 503 — the composer
 * renders that as its honest disabled notice, never a fabricated reply.
 *
 * Persists both turns to the thread identified by (agent, containerId) — a
 * specific work item's container, or the "general" thread when none is open —
 * so the conversation survives navigating away and reloading. Persistence is
 * best-effort (see agent-chat-history.ts) and never blocks or fails the reply.
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
  const agent = resolveAgent(id);
  if (!agent) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }
  const containerId = typeof body?.containerId === "string" && body.containerId.trim() ? body.containerId.trim() : null;

  void appendChatTurn(id, containerId, { role: "user", text: message });

  try {
    // Run chat on the tenant's connected model (same resolution as reviews);
    // null → the agents service default. Never blocks the reply.
    const llm = await resolveActiveLlmForChat();
    const reply = await sendAgentChat({ agent, message, llm });
    void appendChatTurn(id, containerId, { role: "agent", text: reply || "(no response)" });
    return NextResponse.json({ reply });
  } catch (err) {
    console.error("[agents/chat] upstream chat failed", err);
    return NextResponse.json(
      { error: "The agents service is unavailable. Live chat activates when it is running." },
      { status: 503 },
    );
  }
}
