import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { isGithubLinked } from '@/lib/github-link';
import { decryptGithubToken } from '@/lib/github-credentials';
import { fetchAuthorizedGithubLogins } from '@/lib/github';
import { getAuthorizedInstallations } from '@/lib/installations';
import { adoptPendingModelConnections } from '@/lib/model-connection-adoption';
import { internalAuthHeaders } from '@/lib/internal-auth';
import { decideGithubSetupRedirect } from '@/lib/github-setup';

/**
 * GitHub App "Setup URL" landing (App settings → General → Setup URL).
 * After a user installs the Kuma GitHub App, GitHub redirects here with
 * `?installation_id=<n>&setup_action=install`. We bring the user back into the
 * dashboard and route them through the EXISTING owner-login authorization model
 * — never attaching an installation to a user by installation_id alone.
 *
 * Set the App's Setup URL to: {origin}/api/github/setup  (locally
 * http://localhost:3000/api/github/setup). "Redirect on update" may be on.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const installationId = req.nextUrl.searchParams.get('installation_id');
  const setupAction = req.nextUrl.searchParams.get('setup_action');
  const returnUrl = req.nextUrl.pathname + req.nextUrl.search;

  const session = await auth();
  if (!session?.user?.id) {
    const d = decideGithubSetupRedirect({
      isSignedIn: false,
      isGithubLinked: false,
      installationId,
      setupAction,
      authorizedExternalIds: [],
      returnUrl,
    });
    return NextResponse.redirect(new URL(d.location, req.url));
  }

  const linked = await isGithubLinked(db, session.user.id);

  // Fresh, accurate authorization at setup time: the JWT-cached
  // session.installations may predate this brand-new install, so we resolve the
  // owner-login gate directly here — reusing the EXACT functions auth.ts uses,
  // no new authorization logic. Fail closed on any error.
  let authorizedExternalIds: number[] = [];
  if (linked) {
    try {
      const account = await db.account.findFirst({
        where: { userId: session.user.id, provider: 'github' },
        select: { githubAccessTokenEncrypted: true },
      });
      if (account?.githubAccessTokenEncrypted) {
        const token = decryptGithubToken(account.githubAccessTokenEncrypted);
        const logins = await fetchAuthorizedGithubLogins(token);
        const installs = await getAuthorizedInstallations(db, logins);
        authorizedExternalIds = installs.map((i) => i.externalId);

        // The user is confirmed authorized for the just-installed installation
        // (externalId from GitHub's redirect resolves inside their authorized
        // set) → adopt any PENDING model connections into its INTERNAL id and
        // poke the scan trigger fire-and-forget, so the first scan starts the
        // moment the repo+model pair completes. The webhook re-checks all gates
        // server-side; a failure here falls into the fail-closed catch below.
        const externalIdNum = installationId ? Number(installationId) : Number.NaN;
        const justInstalled = installs.find((i) => i.externalId === externalIdNum);
        if (justInstalled) {
          await adoptPendingModelConnections(db, session.user.id, justInstalled.id);
          const webhookBase = process.env.WEBHOOK_SERVICE_URL;
          if (webhookBase) {
            const scanAuthHeaders = await internalAuthHeaders();
            void fetch(`${webhookBase}/scan/trigger`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...scanAuthHeaders },
              body: JSON.stringify({ installationId: justInstalled.id }),
            }).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error('[github-setup] failed to resolve authorized installations', err);
      // leave authorizedExternalIds empty → treated as not-authorized (fail closed)
    }
  }

  const decision = decideGithubSetupRedirect({
    isSignedIn: true,
    isGithubLinked: linked,
    installationId,
    setupAction,
    authorizedExternalIds,
    returnUrl,
  });
  return NextResponse.redirect(new URL(decision.location, req.url));
}
