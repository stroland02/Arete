import { describe, it, expect } from "vitest";
import { HttpStagingClient, STAGING_SEND_PATH, type StagingOutcome } from "./staging-client";

/** A fake fetch returning a fixed status + body, capturing the request. */
function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: unknown }> = [];
  const fetch = async (url: string, init: unknown) => {
    calls.push({ url, init });
    return { status, json: async () => body };
  };
  return { fetch, calls };
}

async function sendWith(status: number, body: unknown): Promise<StagingOutcome> {
  const { fetch } = fakeFetch(status, body);
  const client = new HttpStagingClient({ baseUrl: "https://stg.example", fetch });
  return client.send({ containerId: "c1" });
}

describe("HttpStagingClient — maps Eng1's /staging/send contract to typed outcomes", () => {
  it("POSTs the container id to the staging path", async () => {
    const { fetch, calls } = fakeFetch(200, { status: "opened" });
    await new HttpStagingClient({ baseUrl: "https://stg.example", fetch }).send({ containerId: "c9" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://stg.example${STAGING_SEND_PATH}`);
    expect((calls[0].init as { method: string }).method).toBe("POST");
    expect((calls[0].init as { body: string }).body).toContain("c9");
  });

  it("200 opened → opened, carrying the PR identity", async () => {
    expect(await sendWith(200, { status: "opened", prNumber: 42, url: "https://gh/pr/42" })).toEqual({
      status: "opened",
      prNumber: 42,
      url: "https://gh/pr/42",
    });
  });

  it("200 already_open → already_open (idempotent re-send)", async () => {
    expect(await sendWith(200, { status: "already_open", prNumber: 42, url: "https://gh/pr/42" })).toEqual({
      status: "already_open",
      prNumber: 42,
      url: "https://gh/pr/42",
    });
  });

  it("409 → not_approved (solution gate not cleared)", async () => {
    expect(await sendWith(409, {})).toEqual({ status: "not_approved" });
  });

  it("404 → not_found", async () => {
    expect(await sendWith(404, {})).toEqual({ status: "not_found" });
  });

  it("400 → bad_request with the reason", async () => {
    expect(await sendWith(400, { reason: "containerId required" })).toEqual({
      status: "bad_request",
      reason: "containerId required",
    });
  });

  it("502 → failed with the reason", async () => {
    expect(await sendWith(502, { reason: "github unreachable" })).toEqual({
      status: "failed",
      reason: "github unreachable",
    });
  });

  it("an unexpected status degrades to failed, never a false success", async () => {
    const out = await sendWith(418, {});
    expect(out.status).toBe("failed");
  });
});
