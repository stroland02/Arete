import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { detectOllama, OLLAMA_CANDIDATES } from "@/lib/ollama-detect";

// Session-scoped; never statically prerendered.
export const dynamic = "force-dynamic";

/**
 * Auto-pull a local Ollama model so clicking "Test" can mean "connect" — no
 * manual `ollama pull` step required for the common case. Re-detects the live
 * candidate server-side from the FIXED OLLAMA_CANDIDATES list (never trusts a
 * client-supplied baseUrl for this operation — no new SSRF surface beyond what
 * /api/ollama/detect already has), then proxies POST {baseUrl}/api/pull,
 * streaming Ollama's own NDJSON progress straight through as the response body.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { model?: unknown };
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) {
    return NextResponse.json({ error: "model is required" }, { status: 400 });
  }

  const detected = await detectOllama(
    (url) => fetch(url, { signal: AbortSignal.timeout(2500) }),
    OLLAMA_CANDIDATES,
  );
  if (!detected.running || !detected.baseUrl) {
    return NextResponse.json({ error: "Ollama not detected" }, { status: 503 });
  }

  const upstream = await fetch(`${detected.baseUrl}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model }),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": "application/x-ndjson" },
  });
}
