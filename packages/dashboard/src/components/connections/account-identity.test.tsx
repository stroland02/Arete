import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountIdentity } from "./account-identity";
import type { AuthorizedInstallation } from "@/lib/installations";

const inst = (owner: string): AuthorizedInstallation => ({
  id: `inst-${owner}`,
  provider: "github",
  owner,
  externalId: 1,
});

describe("AccountIdentity", () => {
  it("names the signed-in email and the connected workspaces", () => {
    const html = renderToStaticMarkup(
      <AccountIdentity email="ada@acme.com" workspaces={[inst("acme"), inst("globex")]} />,
    );
    expect(html).toContain("ada@acme.com");
    expect(html).toContain("acme");
    expect(html).toContain("globex");
  });

  it("reassures — empty, not lost — when no workspace is connected (no fabricated workspace)", () => {
    const html = renderToStaticMarkup(<AccountIdentity email="ada@acme.com" workspaces={[]} />);
    expect(html).toContain("ada@acme.com");
    expect(html.toLowerCase()).toContain("empty"); // an empty tenant reads as empty, not data loss
    expect(html.toLowerCase()).not.toContain("acme.com's workspace"); // nothing invented
  });
});
