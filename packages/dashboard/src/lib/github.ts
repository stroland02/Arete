/**
 * Determines which GitHub account/org logins a dashboard user administers,
 * using their OAuth access token (from the standard GitHub OAuth App used
 * for dashboard login — NOT the Kuma GitHub App's own credentials).
 *
 * This is matched against `Installation.owner` (provider='github') in
 * lib/installations.ts to derive which installations' data the user may
 * view. We match on owner *login* rather than the GitHub App installation
 * id itself: a plain OAuth App access token cannot list installations of a
 * different GitHub App (the `/user/installations` endpoint requires a
 * user-to-server token minted for that specific App), but it can list the
 * orgs/personal account the user controls, which is what Installation.owner
 * records at webhook-persistence time.
 */
export async function fetchAuthorizedGithubLogins(accessToken: string): Promise<string[]> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const meRes = await fetch('https://api.github.com/user', { headers });
  if (!meRes.ok) {
    throw new Error(`GitHub /user failed: ${meRes.status}`);
  }
  const me = (await meRes.json()) as { login: string };

  const logins = new Set<string>([me.login]);

  // Orgs where the user's role is 'admin' — mirrors "admin access to the
  // org" as a proxy for "authorized to administer the Kuma installation".
  const orgsRes = await fetch('https://api.github.com/user/memberships/orgs?state=active', {
    headers,
  });
  if (orgsRes.ok) {
    const memberships = (await orgsRes.json()) as Array<{
      role: string;
      organization: { login: string };
    }>;
    for (const membership of memberships) {
      if (membership.role === 'admin') {
        logins.add(membership.organization.login);
      }
    }
  } else {
    console.error(`[github] failed to list org memberships: ${orgsRes.status}`);
  }

  return [...logins];
}
