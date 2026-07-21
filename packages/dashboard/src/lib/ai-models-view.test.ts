import { describe, it, expect } from "vitest";
import {
  findProviderConnection,
  disconnectControl,
  activeConnectionId,
  connectionBadge,
  setActiveControl,
} from "./ai-models-view";
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

describe("activeConnectionId", () => {
  it("returns null when nothing is connected", () => {
    expect(activeConnectionId([])).toBeNull();
  });

  it("returns the id of the newest connection (newest connectedAt = active)", () => {
    // Deliberately out of order: the newest by connectedAt wins regardless of
    // array position, mirroring the server's orderBy createdAt desc.
    const out: ModelConnection[] = [
      { id: "old", provider: "anthropic", model: "claude-opus-4-8", connectedAt: "2026-07-18T09:00:00.000Z" },
      { id: "new", provider: "ollama", model: "qwen2.5-coder", connectedAt: "2026-07-19T12:30:00.000Z" },
      { id: "mid", provider: "openai", model: "gpt", connectedAt: "2026-07-19T08:00:00.000Z" },
    ];
    expect(activeConnectionId(out)).toBe("new");
  });

  it("returns the sole connection's id when only one exists", () => {
    expect(activeConnectionId([rows[0]])).toBe("a1");
  });
});

describe("connectionBadge", () => {
  it("shows nothing for an unconnected, non-default provider", () => {
    expect(connectionBadge({ hasConnection: false, isActive: false, freeDefault: false })).toBeNull();
  });

  it("shows the free-default badge for an unconnected free-default provider", () => {
    expect(connectionBadge({ hasConnection: false, isActive: false, freeDefault: true })).toBe("free-default");
  });

  it("shows 'active' for the live connection and 'connected' for a saved-but-idle one", () => {
    expect(connectionBadge({ hasConnection: true, isActive: true, freeDefault: false })).toBe("active");
    expect(connectionBadge({ hasConnection: true, isActive: false, freeDefault: false })).toBe("connected");
  });

  it("prefers the connected state over free-default once a default provider is saved", () => {
    // A connected-but-idle Ollama reads "Connected", not "Free default".
    expect(connectionBadge({ hasConnection: true, isActive: false, freeDefault: true })).toBe("connected");
  });
});

describe("setActiveControl", () => {
  it("is hidden when nothing is connected", () => {
    expect(setActiveControl({ hasConnection: false, isActive: false, switching: false })).toEqual({
      show: false,
      label: "Set active",
      disabled: false,
    });
  });

  it("is hidden for the already-active connection — nothing to switch to", () => {
    expect(setActiveControl({ hasConnection: true, isActive: true, switching: false })).toEqual({
      show: false,
      label: "Set active",
      disabled: false,
    });
  });

  it("is shown and enabled for a saved-but-idle connection", () => {
    expect(setActiveControl({ hasConnection: true, isActive: false, switching: false })).toEqual({
      show: true,
      label: "Set active",
      disabled: false,
    });
  });

  it("shows in-flight state and disables while the switch runs", () => {
    expect(setActiveControl({ hasConnection: true, isActive: false, switching: true })).toEqual({
      show: true,
      label: "Switching…",
      disabled: true,
    });
  });
});
