import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AiModelsSection } from "./ai-models-section";
import type { ModelConnectionsClient } from "@/lib/model-connections-client";

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

  it("offers connect + model-select + Test per provider", () => {
    expect(html).toContain("API key");
    expect(html).toContain("Base URL"); // Ollama
    expect(html).toContain("Test");
    expect(html).toContain("claude-opus-4-8"); // a selectable model
  });

  it("fabricates no connected state before a successful Test", () => {
    // The green "Connected" badge only appears after test() returns connected.
    expect(html).not.toContain("Connected");
  });
});
