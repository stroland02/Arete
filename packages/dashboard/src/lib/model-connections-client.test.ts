import { describe, it, expect } from "vitest";
import {
  HttpModelConnectionsClient,
  MODEL_CONNECTIONS_PATH,
  type ModelTestOutcome,
} from "./model-connections-client";

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init?: unknown }> = [];
  const fetch = async (url: string, init?: unknown) => {
    calls.push({ url, init });
    return { status, json: async () => body };
  };
  return { fetch, calls };
}

async function testWith(status: number, body: unknown): Promise<ModelTestOutcome> {
  const { fetch } = fakeFetch(status, body);
  return new HttpModelConnectionsClient({ baseUrl: "https://api.example", fetch }).test({
    provider: "openai",
    model: "gpt-4o",
    apiKey: "sk-x",
  });
}

describe("HttpModelConnectionsClient.test — maps the model-connections contract", () => {
  it("POSTs to the /test path", async () => {
    const { fetch, calls } = fakeFetch(200, { ok: true });
    await new HttpModelConnectionsClient({ baseUrl: "https://api.example", fetch }).test({ provider: "ollama", model: "llama3.1", baseUrl: "http://localhost:11434" });
    expect(calls[0].url).toBe(`https://api.example${MODEL_CONNECTIONS_PATH}/test`);
  });

  it("200 ok → connected, echoing the model when the body omits it", async () => {
    expect(await testWith(200, { ok: true })).toEqual({ status: "connected", model: "gpt-4o" });
  });

  it("200 ok with a model → connected on that model", async () => {
    expect(await testWith(200, { ok: true, model: "gpt-4o-mini" })).toEqual({ status: "connected", model: "gpt-4o-mini" });
  });

  it("200 not-ok → failed with the reason", async () => {
    expect(await testWith(200, { ok: false, error: "model not found" })).toEqual({ status: "failed", reason: "model not found" });
  });

  it("401/403 → unauthorized", async () => {
    expect((await testWith(401, {})).status).toBe("unauthorized");
    expect((await testWith(403, {})).status).toBe("unauthorized");
  });

  it("404 → not_configured (Eng1's route isn't deployed yet)", async () => {
    expect(await testWith(404, {})).toEqual({ status: "not_configured" });
  });

  it("503 → unreachable", async () => {
    expect(await testWith(503, {})).toEqual({ status: "unreachable" });
  });

  it("a thrown fetch (host down) → unreachable, never an exception", async () => {
    const client = new HttpModelConnectionsClient({
      baseUrl: "https://api.example",
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await expect(client.test({ provider: "ollama", model: "llama3.1", baseUrl: "http://localhost:1" })).resolves.toEqual({
      status: "unreachable",
    });
  });

  it("list returns [] when the route is absent (non-200)", async () => {
    const { fetch } = fakeFetch(404, {});
    const out = await new HttpModelConnectionsClient({ baseUrl: "https://api.example", fetch }).list();
    expect(out).toEqual([]);
  });
});
