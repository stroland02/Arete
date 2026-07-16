import { describe, it, expect } from "vitest";
import { MODEL_PROVIDERS, getModelProvider } from "./model-catalog";

describe("model catalog", () => {
  it("offers exactly the five providers, in order", () => {
    expect(MODEL_PROVIDERS.map((p) => p.id)).toEqual(["anthropic", "openai", "gemini", "openrouter", "ollama"]);
  });

  it("Ollama is the free default and uses a base URL", () => {
    const ollama = getModelProvider("ollama")!;
    expect(ollama.freeDefault).toBe(true);
    expect(ollama.authKind).toBe("base-url");
    expect(ollama.name).toContain("Ollama");
  });

  it("only Anthropic is the native model; every other provider notes verification runs on the connected model", () => {
    expect(getModelProvider("anthropic")!.isAnthropic).toBe(true);
    for (const p of MODEL_PROVIDERS.filter((p) => !p.isAnthropic)) {
      expect(p.note.toLowerCase()).toContain("verification runs on your connected model");
    }
  });

  it("never oversells the free tier — no 'infinite' or 'unlimited' claims anywhere", () => {
    const blob = JSON.stringify(MODEL_PROVIDERS).toLowerCase();
    expect(blob).not.toContain("infinite");
    expect(blob).not.toContain("unlimited");
  });

  it("routers/local runtimes accept custom model ids; hosted key providers do not", () => {
    expect(getModelProvider("openrouter")!.customModelAllowed).toBe(true);
    expect(getModelProvider("ollama")!.customModelAllowed).toBe(true);
    expect(getModelProvider("anthropic")!.customModelAllowed).toBe(false);
  });
});
