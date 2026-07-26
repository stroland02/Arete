import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { AGENTS } from "@/components/dashboard/agents/agent-catalog";
import {
  AgentConfigSaveError,
  getAgentConfig,
  parseAgentConfig,
  saveAgentConfig,
} from "@/lib/agent-config";

// Session-scoped; never statically prerendered.
export const dynamic = "force-dynamic";

function resolveAgent(id: string) {
  return AGENTS.find((a) => a.id === id) ?? null;
}

/**
 * GET /api/agents/[id]/config — the saved config, or the defaults.
 *
 * Always answers 200 with a usable config: an agent with nothing saved runs on
 * defaults, which is a real state rather than a missing one, so there is no 404
 * to distinguish. Tenant scope is derived from the session inside the lib and is
 * never taken from the request.
 */
export async function GET(
  _req: NextRequest,
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

  return NextResponse.json({ config: await getAgentConfig(id) });
}

/**
 * PUT /api/agents/[id]/config — save this agent's config.
 *
 * Returns the config that was actually stored, so the client renders what the
 * database holds rather than what it hoped it sent. Every failure answers with a
 * non-2xx and a reason: a save that could not happen must never look like one
 * that did — which is precisely why the Save button was disabled before this
 * route existed.
 */
export async function PUT(
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = parseAgentConfig(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const saved = await saveAgentConfig(id, parsed.config);
    return NextResponse.json({ config: saved });
  } catch (err) {
    // 409, not 500: nothing is wrong with the server or the request — this
    // installation simply has no repository connected to scope a config
    // against, and the message says what to do about it.
    if (err instanceof AgentConfigSaveError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[agent-config] save failed:", err);
    return NextResponse.json({ error: "Could not save. Nothing was changed." }, { status: 500 });
  }
}
