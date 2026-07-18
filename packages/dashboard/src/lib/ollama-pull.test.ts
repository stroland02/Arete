import { describe, expect, it, vi } from "vitest";
import { consumePullStream, parsePullLine } from "./ollama-pull";

function streamOf(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + "\n"));
      controller.close();
    },
  });
}

describe("parsePullLine", () => {
  it("parses a valid NDJSON progress line", () => {
    expect(parsePullLine('{"status":"downloading","completed":10,"total":100}')).toEqual({
      status: "downloading",
      completed: 10,
      total: 100,
    });
  });

  it("returns null for a blank line", () => {
    expect(parsePullLine("   ")).toBeNull();
  });

  it("returns null for unparseable JSON", () => {
    expect(parsePullLine("not json")).toBeNull();
  });
});

describe("consumePullStream", () => {
  it("resolves ok:true when the stream ends with status success", async () => {
    const stream = streamOf([
      '{"status":"pulling manifest"}',
      '{"status":"downloading","completed":50,"total":100}',
      '{"status":"success"}',
    ]);
    const outcome = await consumePullStream(stream);
    expect(outcome).toEqual({ ok: true });
  });

  it("resolves ok:false with the error detail when a line reports an error", async () => {
    const stream = streamOf([
      '{"status":"pulling manifest"}',
      '{"error":"model not found"}',
    ]);
    const outcome = await consumePullStream(stream);
    expect(outcome).toEqual({ ok: false, detail: "model not found" });
  });

  it("resolves ok:false when the stream ends without a success status", async () => {
    const stream = streamOf(['{"status":"downloading","completed":5,"total":100}']);
    const outcome = await consumePullStream(stream);
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("downloading");
  });

  it("resolves ok:false with no response body", async () => {
    const outcome = await consumePullStream(null);
    expect(outcome).toEqual({ ok: false, detail: "no response body" });
  });

  it("invokes onLine for each parsed progress line", async () => {
    const stream = streamOf(['{"status":"downloading","completed":1,"total":2}', '{"status":"success"}']);
    const onLine = vi.fn();
    await consumePullStream(stream, onLine);
    expect(onLine).toHaveBeenCalledWith({ status: "downloading", completed: 1, total: 2 });
    expect(onLine).toHaveBeenCalledWith({ status: "success" });
  });

  it("handles a chunk split mid-line (partial JSON across reads)", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"status":'));
        controller.enqueue(encoder.encode('"success"}\n'));
        controller.close();
      },
    });
    const outcome = await consumePullStream(stream);
    expect(outcome).toEqual({ ok: true });
  });
});
