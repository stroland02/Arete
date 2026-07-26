import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AiModelsSection } from "./ai-models-section";
import type { ModelConnectionsClient } from "@/lib/model-connections-client";

// The rows call useRouter() (router.refresh() after connect/disconnect); a
// static render has no app-router context, so mock it — same pattern the
// glass-box dock test uses.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const stubClient: ModelConnectionsClient = {
  list: async () => [],
  connect: async () => ({ id: "x", provider: "x", model: "x", connectedAt: "" }),
  disconnect: async () => {},
  test: async () => ({ status: "not_configured" }),
};

const html = renderToStaticMarkup(<AiModelsSection client={stubClient} />);

describe("AiModelsSection", () => {
  it("renders a card for each of the five providers", () => {
    expect(html).toContain("Anthropic");
    expect(html).toContain("OpenAI");
    expect(html).toContain("Gemini");
    expect(html).toContain("OpenRouter");
    expect(html).toContain("Local · Ollama");
  });

  it("badges Ollama as the free default but never claims it is infinite/unlimited", () => {
    expect(html).toContain("Free default");
    expect(html.toLowerCase()).not.toContain("infinite");
    expect(html.toLowerCase()).not.toContain("unlimited");
  });

  it("states that verification runs on the connected model for non-Anthropic providers", () => {
    expect(html.toLowerCase()).toContain("verification runs on your connected model");
  });

  it("offers credential + model-select + Connect per provider", () => {
    expect(html).toContain("API key");
    expect(html).toContain("Base URL"); // Ollama
    expect(html).toContain("Connect"); // the connect action (formerly labelled "Test")
    expect(html).toContain("claude-opus-4-8"); // a selectable model
  });

  it("fabricates no connected/active state before list() hydrates", () => {
    // With an empty list() (the stub), no provider is connected — so neither the
    // "Connected" badge nor the "Active" badge is fabricated from a bare render.
    // (The section's intro copy mentions the word "Active", so we assert the
    // Active *badge* is absent via its unique title rather than the bare word.)
    expect(html).not.toContain("Connected");
    expect(html).not.toContain("Kuma runs reviews on this model");
    // ...and Disconnect / Set active are offered only for a PERSISTED connection
    // (an id from list() or connect()), never from a bare Test result.
    expect(html).not.toContain("Disconnect");
    expect(html).not.toContain("Set active");
  });
});
