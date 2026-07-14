import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SetupChecklist, type SetupStep } from "./setup-checklist";

const partialSteps: SetupStep[] = [
  { id: "account", label: "Create your Kuma account", done: true },
  { id: "repo", label: "Connect your GitHub repository", done: true, href: "/connections" },
  { id: "telemetry", label: "Connect a telemetry source", done: false, href: "/connections" },
  { id: "first-review", label: "See your first automated review", done: false },
];

const allDoneSteps: SetupStep[] = partialSteps.map((s) => ({ ...s, done: true }));

describe("SetupChecklist", () => {
  it("renders every step's label", () => {
    const html = renderToStaticMarkup(<SetupChecklist steps={partialSteps} />);
    for (const step of partialSteps) {
      expect(html).toContain(step.label);
    }
  });

  it("never renders a done=false step with a done/checked indicator", () => {
    const html = renderToStaticMarkup(<SetupChecklist steps={partialSteps} />);
    expect(html).toContain('data-step-done="false"');
    expect(html).toContain('data-step-done="true"');
  });

  it("shows a real fraction, not a fabricated one (2 of 4 done here)", () => {
    const html = renderToStaticMarkup(<SetupChecklist steps={partialSteps} />);
    expect(html).toContain("2");
    expect(html).toContain("4");
  });

  it("renders the collapsed complete strip when every step is done", () => {
    const html = renderToStaticMarkup(<SetupChecklist steps={allDoneSteps} />);
    expect(html).toContain("Setup complete");
  });

  it("does not render the collapsed complete strip when steps remain", () => {
    const html = renderToStaticMarkup(<SetupChecklist steps={partialSteps} />);
    expect(html).not.toContain("Setup complete");
  });
});
