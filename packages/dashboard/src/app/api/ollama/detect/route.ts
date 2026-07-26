import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { detectOllama } from "@/lib/ollama-detect";

// Session-scoped; never statically prerendered.
export const dynamic = "force-dynamic";

/**
 * Auto-detect a running local Ollama for the "Local · Ollama" connect card.
 * Probes FIXED loopback candidates (127.0.0.1, then host.docker.internal)
 * server-side — no customer-supplied URL, so no SSRF surface and no net-guard.
 * Returns { running, baseUrl, models } so the UI can prefill the Base URL and
 * offer the user's actually-pulled models. Never throws.
 */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { running: false, baseUrl: null, models: [] },
      { status: 401 },
    );
  }

  const result = await detectOllama((url) =>
    fetch(url, { signal: AbortSignal.timeout(2500) }),
  );
  return NextResponse.json(result);
}
