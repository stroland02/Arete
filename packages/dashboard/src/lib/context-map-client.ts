import type { CodeGraphExport } from '@arete/topology';
import { internalAuthHeaders } from '@/lib/internal-auth';

// Reuses the dashboard's existing agents-service convention (see agent-chat.ts /
// packages/webhook/src/config.ts): the same FastAPI service that serves /chat
// serves /context-map/graph. Server-only — imported by the /overview view-model,
// never a client component.
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? 'http://127.0.0.1:8000';
const GRAPH_TIMEOUT_MS = 10_000;

/**
 * Fetch the normalized code graph for an installation from the agents service.
 * Returns null when nothing is indexed yet ({available:false}) or on ANY fetch
 * error/timeout — an honest empty, never a throw into the server component and
 * never a fabricated graph. The caller renders the honest empty state.
 */
export async function fetchCodeGraph(installationId: number): Promise<CodeGraphExport | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/context-map/graph/${installationId}`, {
      cache: 'no-store',
      signal: controller.signal,
      // The agents service's GET /context-map/* surface is behind the shared
      // internal bearer with a fail-closed 503 (arete_agents/internal_auth.py)
      // -- the read-side twin of the POST guard in agent-chat.ts above. This
      // is the ONLY caller of /context-map/graph in the repo (confirmed by a
      // full-repo sweep); nothing browser-facing reaches this fetch.
      headers: { ...internalAuthHeaders() },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { available: boolean; graph: CodeGraphExport | null };
    return body.available ? body.graph : null;
  } catch {
    return null; // honest empty — never break the page on a context-map hiccup
  } finally {
    clearTimeout(timer);
  }
}
