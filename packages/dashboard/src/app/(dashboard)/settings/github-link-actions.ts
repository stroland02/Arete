'use server';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { buildGithubLinkAuthorizeUrl } from '@/lib/github-link';

/**
 * Server action backing the Settings page's "Connect GitHub" button
 * (Phase UI wires the actual <form action={connectGithub}> button — see
 * plan Task U2). Redirects the already-signed-in user to GitHub's OAuth
 * authorize endpoint for the dedicated account-link OAuth App.
 */
export async function connectGithub(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  redirect(buildGithubLinkAuthorizeUrl(session.user.id));
}
