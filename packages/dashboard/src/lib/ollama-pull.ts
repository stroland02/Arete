// Consumes a local Ollama model pull (POST /api/pull's NDJSON stream) so
// clicking "Test" can mean "connect" end-to-end — no manual `ollama pull`
// step required for the common case. The pull TARGET is always
// server-determined (see app/api/ollama/pull/route.ts, which re-detects a live
// candidate from ollama-detect.ts's fixed OLLAMA_CANDIDATES) — this module
// only parses/consumes the resulting stream, it never picks the target itself.

export interface PullLine {
  status?: string;
  error?: string;
  completed?: number;
  total?: number;
}

/** Parse one NDJSON line from Ollama's /api/pull stream. Returns null for a
 *  blank/unparseable line (skip rather than fail the whole pull on stray
 *  output). */
export function parsePullLine(line: string): PullLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as PullLine;
  } catch {
    return null;
  }
}

export interface PullOutcome {
  ok: boolean;
  detail?: string;
}

/** Consume an already-fetched Ollama /api/pull response stream to completion.
 *  onLine (optional) is invoked per parsed progress line for live UI feedback.
 *  Resolves ok:true only once a line reports status "success"; any line
 *  carrying an `error` field is treated as the (immediate) failure detail. */
export async function consumePullStream(
  body: ReadableStream<Uint8Array> | null,
  onLine?: (line: PullLine) => void,
): Promise<PullOutcome> {
  if (!body) return { ok: false, detail: "no response body" };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastStatus: PullLine | null = null;
  let errorDetail: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const raw of lines) {
      const parsed = parsePullLine(raw);
      if (!parsed) continue;
      if (parsed.error) errorDetail = parsed.error;
      lastStatus = parsed;
      onLine?.(parsed);
    }
    if (done) break;
  }

  if (errorDetail) return { ok: false, detail: errorDetail };
  if (lastStatus?.status === "success") return { ok: true };
  return {
    ok: false,
    detail: lastStatus?.status ? `pull ended at "${lastStatus.status}"` : "pull produced no output",
  };
}
