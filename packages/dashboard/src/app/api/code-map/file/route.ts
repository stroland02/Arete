import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { resolveSelectedInstallationIds } from '@/lib/queries';
import { fetchFileFromWebhook, statusForFileResult } from '@/lib/code-map-file-api';

// Session-scoped on every request — never statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * GET /api/code-map/file?path=<repo-relative path>[&installation=<id>]
 *
 * Source text for the code map's reading panel. Tenancy: the installation is
 * resolved from the SESSION's authorized list (the optional `installation`
 * param can only select among the caller's own installations — identical to
 * /map and /overview); the repo-relative `path` is validated again in the
 * webhook (isSafeRepoPath) before any GitHub call.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  const path = req.nextUrl.searchParams.get('path');
  if (!path) {
    return NextResponse.json({ ok: false, reason: 'invalid_path' }, { status: 400 });
  }

  const installationParam = req.nextUrl.searchParams.get('installation') ?? undefined;
  const installations = session.installations ?? [];
  const installationIds = resolveSelectedInstallationIds(installations, installationParam);
  const externalId = installations.find((i) => i.id === installationIds[0])?.externalId;
  if (externalId == null) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });
  }

  const result = await fetchFileFromWebhook(externalId, path);
  return NextResponse.json(result, { status: statusForFileResult(result) });
}
