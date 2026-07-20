import { describe, it, expect } from "vitest";
import { findProviderConnection, disconnectControl } from "./ai-models-view";
import type { ModelConnection } from "./model-connections-client";

const rows: ModelConnection[] = [
  { id: "a1", provider: "anthropic", model: "claude-opus-4-8", connectedAt: "2026-07-19T00:00:00.000Z" },
  { id: "o1", provider: "ollama", model: "qwen2.5-coder", connectedAt: "2026-07-19T00:00:00.000Z" },
];

describe("findProviderConnection", () => {
  it("returns the persisted connection (with its id) for a matching provider", () => {
    expect(findProviderConnection(rows, "ollama")).toEqual(rows[1]);
    expect(findProviderConnection(rows, "ollama")?.id).toBe("o1");
  });

  it("returns null when the provider has no persisted connection", () => {
    expect(findProviderConnection(rows, "openai")).toBeNull();
    expect(findProviderConnection([], "anthropic")).toBeNull();
  });
});

describe("disconnectControl", () => {
  it("is hidden when nothing is persisted — a Test result alone never offers Disconnect", () => {
    expect(disconnectControl(null, false)).toEqual({ show: false, label: "Disconnect", disabled: false });
  });

  it("is shown and enabled once a connection id exists", () => {
    expect(disconnectControl("o1", false)).toEqual({ show: true, label: "Disconnect", disabled: false });
  });

  it("shows in-flight state and disables while the delete runs", () => {
    expect(disconnectControl("o1", true)).toEqual({ show: true, label: "Disconnecting…", disabled: true });
  });
});
