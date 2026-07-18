/**
 * StagingClient — the typed seam to Eng1's PR staging endpoint (POST /staging/send).
 * Wave-2 ③ / Part B — now LIVE: the Send-PR route drives this against the real
 * webhook service (base URL injected), and its outcomes are rendered honestly in
 * the staged-PR view.
 *
 * Contract (HTTP status → outcome), per the webhook send-handler:
 *   200  opened | already_open  → the PR is open (already_open = idempotent re-send)
 *   409  not_approved           → solution gate not cleared (canPost === false)
 *   404  not_found              → no such container for this tenant
 *   502  failed                 → host/upstream failed to open the PR
 *   400  bad_request            → missing / invalid input
 *
 * The handler requires BOTH ids in the body ({ containerId, installationId });
 * omitting either is the handler's own 400 bad_request. The read on the far side
 * is tenancy-scoped by installationId, so the id pair is mandatory, not optional.
 */

export interface StagingSendInput {
  /** The container whose approved solution is being sent as a PR. */
  containerId: string;
  /** Tenant scope — the send is resolved by (containerId, installationId). The
   *  webhook returns 400 bad_request if this is missing. */
  installationId: string;
}

/**
 * The result of a send, discriminated by outcome. `opened`/`already_open` carry
 * the PR identity when the endpoint returns it; the exact success-body shape is
 * confirmed against Eng1's response at integration (optional here so the mapping
 * never throws on a body we haven't pinned down).
 */
export type StagingOutcome =
  | { status: "opened"; prNumber?: number; url?: string }
  | { status: "already_open"; prNumber?: number; url?: string }
  | { status: "not_approved" }
  | { status: "not_found" }
  | { status: "failed"; reason?: string }
  | { status: "bad_request"; reason?: string };

export interface StagingClient {
  send(input: StagingSendInput): Promise<StagingOutcome>;
}

export const STAGING_SEND_PATH = "/staging/send";

/** Minimal shape of what `send` needs from a fetch — so tests can inject a fake. */
type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface HttpStagingClientOptions {
  /** Origin of Eng1's staging service. Defaults to same-origin (""). */
  baseUrl?: string;
  /** Injectable for tests; defaults to the global fetch. */
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
 * HTTP implementation over `POST /staging/send`. It ONLY maps the transport
 * contract to a typed outcome — it takes no product decision, so it stays a thin,
 * swappable seam. It is not called anywhere yet (see the inert note above).
 */
export class HttpStagingClient implements StagingClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: HttpStagingClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  async send(input: StagingSendInput): Promise<StagingOutcome> {
    const res = await this.fetchImpl(`${this.baseUrl}${STAGING_SEND_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });

    const body = await readBody(res);
    const prNumber = typeof body.prNumber === "number" ? body.prNumber : undefined;
    const url = typeof body.url === "string" ? body.url : undefined;
    const reason = typeof body.reason === "string" ? body.reason : undefined;

    switch (res.status) {
      case 200:
        // 200 covers both opened and the idempotent already_open — the body says which.
        return body.status === "already_open"
          ? { status: "already_open", prNumber, url }
          : { status: "opened", prNumber, url };
      case 409:
        return { status: "not_approved" };
      case 404:
        return { status: "not_found" };
      case 400:
        return { status: "bad_request", reason };
      case 502:
        return { status: "failed", reason };
      default:
        return { status: "failed", reason: reason ?? `unexpected status ${res.status}` };
    }
  }
}
