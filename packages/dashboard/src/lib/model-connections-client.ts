/**
 * ModelConnectionsClient — the typed seam to Eng1's model-connections API
 * (/api/model-connections CRUD + /test). Wave-2 AI Models section.
 *
 * SEAM-FIRST / INERT-TOLERANT: built now so the AI Models UI is unblocked before
 * Eng1's route lands. Every call degrades honestly — a 404 (route not deployed)
 * maps to `not_configured`, so the UI can say "not available yet" instead of
 * pretending. When Eng1 ships /api/model-connections this seam lights up with no
 * UI rewrite.
 *
 * Contract (best-effort mapping; aligned to Eng1's responses at integration):
 *   list      GET    /api/model-connections            → ModelConnection[]
 *   connect   POST   /api/model-connections            → ModelConnection
 *   disconnect DELETE /api/model-connections/:id
 *   test      POST   /api/model-connections/test       → { ok, model?, error? }
 */

export interface ModelConnection {
  id: string;
  provider: string;
  model: string;
  connectedAt: string;
}

export interface ModelConnectInput {
  provider: string;
  model: string;
  /** api-key providers. */
  apiKey?: string;
  /** base-url providers (Ollama). */
  baseUrl?: string;
}

/** Result of a Test, discriminated by outcome — never a bare boolean. */
export type ModelTestOutcome =
  | { status: "connected"; model: string }
  | { status: "unauthorized" } // credential rejected
  | { status: "unreachable" } // host/base-url down (Ollama offline, network)
  | { status: "not_configured" } // Eng1's route isn't deployed yet (404)
  | { status: "failed"; reason?: string };

export interface ModelConnectionsClient {
  list(): Promise<ModelConnection[]>;
  connect(input: ModelConnectInput): Promise<ModelConnection>;
  disconnect(id: string): Promise<void>;
  test(input: ModelConnectInput): Promise<ModelTestOutcome>;
}

export const MODEL_CONNECTIONS_PATH = "/api/model-connections";

type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface HttpModelConnectionsClientOptions {
  baseUrl?: string;
  fetch?: FetchLike;
}

async function readBody(res: { json: () => Promise<unknown> }): Promise<Record<string, unknown>> {
  try {
    const b = await res.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * HTTP implementation. It only maps transport → typed results; it takes no
 * product decision and is not wired end-to-end until Eng1's route + the
 * ModelConnection store land. `test` never throws — network failure is a typed
 * `unreachable`, not an exception the UI must guess at.
 */
export class HttpModelConnectionsClient implements ModelConnectionsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: HttpModelConnectionsClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    // Bind to the global: native fetch throws "Illegal invocation" if called as
    // a method (this !== window), which is what happens when it's stored on the
    // instance and invoked as this.fetchImpl(...).
    this.fetchImpl = options.fetch ?? (globalThis.fetch.bind(globalThis) as unknown as FetchLike);
  }

  private url(suffix = ""): string {
    return `${this.baseUrl}${MODEL_CONNECTIONS_PATH}${suffix}`;
  }

  async list(): Promise<ModelConnection[]> {
    const res = await this.fetchImpl(this.url());
    if (res.status !== 200) return [];
    const body = await res.json().catch(() => null);
    return Array.isArray(body) ? (body as ModelConnection[]) : [];
  }

  async connect(input: ModelConnectInput): Promise<ModelConnection> {
    const res = await this.fetchImpl(this.url(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`connect failed (${res.status})`);
    }
    return (await res.json()) as ModelConnection;
  }

  async disconnect(id: string): Promise<void> {
    await this.fetchImpl(this.url(`/${encodeURIComponent(id)}`), { method: "DELETE" });
  }

  async test(input: ModelConnectInput): Promise<ModelTestOutcome> {
    let res: { status: number; json: () => Promise<unknown> };
    try {
      res = await this.fetchImpl(this.url("/test"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
    } catch {
      // A thrown fetch means we could not reach the host at all.
      return { status: "unreachable" };
    }

    const body = await readBody(res);
    const reason = typeof body.error === "string" ? body.error : undefined;

    switch (res.status) {
      case 200:
        return body.ok === true
          ? { status: "connected", model: typeof body.model === "string" ? body.model : input.model }
          : { status: "failed", reason };
      case 401:
      case 403:
        return { status: "unauthorized" };
      case 404:
        return { status: "not_configured" };
      case 502:
      case 503:
      case 504:
        return { status: "unreachable" };
      default:
        return { status: "failed", reason: reason ?? `unexpected status ${res.status}` };
    }
  }
}
