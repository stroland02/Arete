/**
 * GitHub App post-install "Setup URL" decision logic.
 *
 * When a user installs the Kuma GitHub App, GitHub redirects to the App's
 * configured Setup URL with `?installation_id=<n>&setup_action=install`. This
 * pure function decides where to send them next, so the redirect policy is
 * unit-testable (including the adversarial cross-tenant case) without a live
 * session, DB, or GitHub API.
 *
 * TENANT-SAFETY: this NEVER attaches an installation to a user by
 * `installation_id` alone. Data visibility stays gated by the existing
 * owner-login model (auth.ts jwt callback → getAuthorizedInstallations →
 * session.installations). Here we only confirm the just-installed
 * installation's externalId resolves into the caller's ALREADY-authorized set
 * (owner ∈ the logins they administer). An installation owned by an org the
 * user does not administer is never treated as "connected" — same gate class
 * as the f4b9c88 cross-tenant fix.
 */

export interface GithubSetupInput {
  isSignedIn: boolean;
  /** Does the signed-in user have a linked GitHub identity (Account row)? */
  isGithubLinked: boolean;
  /** `installation_id` from GitHub's setup redirect. */
  installationId: string | null;
  /** `setup_action` from GitHub's setup redirect (install | update). */
  setupAction: string | null;
  /**
   * externalIds of the installations the user is AUTHORIZED for, freshly
   * resolved (owner-login match). The tenant gate — an installation_id not in
   * here is not the user's to see.
   */
  authorizedExternalIds: number[];
  /** This route's own path+query, for a post-login return. */
  returnUrl: string;
}

export interface GithubSetupDecision {
  location: string;
}

export function decideGithubSetupRedirect(i: GithubSetupInput): GithubSetupDecision {
  // Not signed in → log in first, then come straight back here to finish.
  if (!i.isSignedIn) {
    return { location: `/login?callbackUrl=${encodeURIComponent(i.returnUrl)}` };
  }

  // Signed in but no linked GitHub identity → we cannot authorize any
  // installation's owner for this user yet. Send them to connect GitHub
  // (the existing identity-link flow); no bypass, no fake success.
  if (!i.isGithubLinked) {
    return { location: `/settings?connect=github&reason=app_install` };
  }

  // Tenant gate: only "connected" if the installed installation's externalId
  // is among the user's authorized installations (owner they administer).
  const idNum = i.installationId ? Number(i.installationId) : Number.NaN;
  const authorized = Number.isFinite(idNum) && i.authorizedExternalIds.includes(idNum);
  if (!authorized) {
    // Honest: not a data leak (session.installations wouldn't include it
    // anyway), but tell them the install isn't linked to this account.
    return { location: `/overview?setup=installation_not_authorized` };
  }

  return { location: `/overview?setup=connected` };
}
