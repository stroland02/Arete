import { describe, expect, it, vi } from "vitest";
import { detectOllama } from "./ollama-detect";

function res(ok: boolean, body?: unknown) {
  return { ok, json: async () => body };
}

describe("detectOllama", () => {
  it("returns running + real models from the first reachable candidate", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/version")) return res(true, { version: "0.32.1" });
      if (url.endsWith("/api/tags"))
        return res(true, { models: [{ name: "qwen2.5-coder:latest" }, { name: "llama3.1" }] });
      return res(false);
    });

    const out = await detectOllama(fetchImpl, ["http://127.0.0.1:11434"]);
    expect(out).toEqual({
      running: true,
      baseUrl: "http://127.0.0.1:11434",
      models: ["qwen2.5-coder:latest", "llama3.1"],
    });
  });

  it("falls through to the next candidate when the first is unreachable", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith("http://127.0.0.1")) throw new Error("ECONNREFUSED");
      if (url.endsWith("/api/version")) return res(true, {});
      if (url.endsWith("/api/tags")) return res(true, { models: [] });
      return res(false);
    });

    const out = await detectOllama(fetchImpl, [
      "http://127.0.0.1:11434",
      "http://host.docker.internal:11434",
    ]);
    expect(out.running).toBe(true);
    expect(out.baseUrl).toBe("http://host.docker.internal:11434");
  });

  it("reports not-running (never throws) when every candidate fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const out = await detectOllama(fetchImpl, ["http://127.0.0.1:11434"]);
    expect(out).toEqual({ running: false, baseUrl: null, models: [] });
  });

  it("running with no pulled models yields an empty model list, still running", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/version")) return res(true, {});
      if (url.endsWith("/api/tags")) return res(true, { models: [] });
      return res(false);
    });
    const out = await detectOllama(fetchImpl, ["http://127.0.0.1:11434"]);
    expect(out.running).toBe(true);
    expect(out.models).toEqual([]);
  });
});
