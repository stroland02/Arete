import { describe, it, expect } from "vitest";
import { decideGithubSetupRedirect, type GithubSetupInput } from "./github-setup";

const base: GithubSetupInput = {
  isSignedIn: true,
  isGithubLinked: true,
  installationId: "42",
  setupAction: "install",
  authorizedExternalIds: [42],
  returnUrl: "/api/github/setup?installation_id=42&setup_action=install",
};

describe("decideGithubSetupRedirect", () => {
  it("sends an anonymous visitor to login with a return to the setup route", () => {
    const d = decideGithubSetupRedirect({ ...base, isSignedIn: false });
    expect(d.location).toBe(
      "/login?callbackUrl=" + encodeURIComponent(base.returnUrl)
    );
  });

  it("sends a signed-in-but-unlinked user to connect GitHub first (no bypass)", () => {
    const d = decideGithubSetupRedirect({ ...base, isGithubLinked: false });
    expect(d.location).toContain("/settings");
    expect(d.location).toContain("connect=github");
  });

  it("lands an authorized user on /overview as connected", () => {
    const d = decideGithubSetupRedirect(base);
    expect(d.location).toBe("/overview?setup=connected");
  });

  it("ADVERSARIAL: an installation the user does NOT administer is never connected", () => {
    // Attacker opens the setup URL with an installation_id belonging to an org
    // they have no authorized login for. authorizedExternalIds is resolved from
    // THEIR own logins and does not include it.
    const d = decideGithubSetupRedirect({
      ...base,
      installationId: "999", // a different tenant's installation
      authorizedExternalIds: [42], // user's own installs — 999 not among them
    });
    expect(d.location).not.toContain("setup=connected");
    expect(d.location).toBe("/overview?setup=installation_not_authorized");
  });

  it("ADVERSARIAL: empty authorized set can never yield connected", () => {
    const d = decideGithubSetupRedirect({ ...base, authorizedExternalIds: [] });
    expect(d.location).toBe("/overview?setup=installation_not_authorized");
  });

  it("treats a missing/garbage installation_id as not authorized", () => {
    expect(decideGithubSetupRedirect({ ...base, installationId: null }).location).toBe(
      "/overview?setup=installation_not_authorized"
    );
    expect(decideGithubSetupRedirect({ ...base, installationId: "abc" }).location).toBe(
      "/overview?setup=installation_not_authorized"
    );
  });
});
