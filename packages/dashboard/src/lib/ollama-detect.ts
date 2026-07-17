// Auto-detect a running local Ollama for the "Local · Ollama" connect card.
//
// Probes a FIXED set of loopback candidates (never customer-supplied), so there
// is no SSRF surface and this does NOT go through net-guard. 127.0.0.1 (IPv4)
// is tried first: Ollama binds IPv4 only, and Node resolves `localhost` to ::1
// first, which refuses. Pure + fetch-injected so it's unit-testable.

export interface OllamaDetectResult {
  running: boolean;
  /** The candidate that responded, to prefill the Base URL. */
  baseUrl: string | null;
  /** Actually-pulled model ids (from /api/tags), for the model dropdown. */
  models: string[];
}

export const OLLAMA_CANDIDATES = [
  "http://127.0.0.1:11434",
  "http://host.docker.internal:11434",
];

type DetectResponse = { ok: boolean; json(): Promise<unknown> };
export type DetectFetch = (url: string) => Promise<DetectResponse>;

function modelNames(tags: unknown): string[] {
  const models = (tags as { models?: unknown })?.models;
  if (!Array.isArray(models)) return [];
  return models
    .map((m) => String((m as { name?: unknown })?.name ?? "").trim())
    .filter((n) => n.length > 0);
}

/** Returns the first reachable candidate + its pulled models, or a
 *  not-running result. Never throws — an unreachable candidate is normal. */
export async function detectOllama(
  fetchImpl: DetectFetch,
  candidates: readonly string[] = OLLAMA_CANDIDATES,
): Promise<OllamaDetectResult> {
  for (const baseUrl of candidates) {
    try {
      const version = await fetchImpl(`${baseUrl}/api/version`);
      if (!version.ok) continue;
      let models: string[] = [];
      try {
        const tags = await fetchImpl(`${baseUrl}/api/tags`);
        if (tags.ok) models = modelNames(await tags.json());
      } catch {
        // Model list is a bonus; a reachable server still counts as running.
      }
      return { running: true, baseUrl, models };
    } catch {
      // Try the next candidate.
    }
  }
  return { running: false, baseUrl: null, models: [] };
}
