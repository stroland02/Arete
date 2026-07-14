import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { verifyGithubLinkState } from '@/lib/github-link-state';
import { exchangeGithubLinkCode, linkGithubAccount, GithubAccountConflictError } from '@/lib/github-link';

/**
 * Plain Next.js route handler (NOT /api/auth/callback/*) for the
 * "Connect GitHub" flow — entirely outside NextAuth's OAuth callback
 * machinery, per the plan's Architecture section. Can call auth() directly
 * to know exactly which already-signed-in dashboard user is linking, no
 * cookie-decoding or account-linking trickery required.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');

  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
  }

  const verified = verifyGithubLinkState(state);
  if (!verified) {
    return NextResponse.json({ error: 'Invalid or expired state' }, { status: 400 });
  }

  // Defense in depth: the signed state already proves intent, but also
  // confirm the CURRENT session belongs to the same user who initiated the
  // link — guards against a stale/replayed callback URL being opened in a
  // different browser session.
  const session = await auth();
  if (!session?.user?.id || session.user.id !== verified.userId) {
    return NextResponse.json({ error: 'Session mismatch' }, { status: 400 });
  }

  const exchanged = await exchangeGithubLinkCode(code);
  if (!exchanged) {
    return NextResponse.redirect(new URL('/settings?error=github_link_failed', req.url));
  }

  try {
    await linkGithubAccount(db, {
      userId: verified.userId,
      githubUserId: exchanged.githubUserId,
      accessToken: exchanged.accessToken,
    });
  } catch (error) {
    if (error instanceof GithubAccountConflictError) {
      return NextResponse.redirect(new URL('/settings?error=github_account_conflict', req.url));
    }
    console.error('[github-link] failed to persist linked GitHub account', error);
    return NextResponse.redirect(new URL('/settings?error=github_link_failed', req.url));
  }

  return NextResponse.redirect(new URL('/settings?connected=github', req.url));
}
