'use server';
import { headers } from 'next/headers';
import { signIn } from '@/lib/auth';
import { authGuard } from '@/lib/auth-rate-limit';
import { db } from '@/lib/db';
import { classifyAccount } from '@/lib/users';

/**
 * `kind` lets the form surface a specific remedy instead of a dead-end error:
 *  - no_account   → offer "create one?" (carries the typed email to /signup)
 *  - oauth_google → point the user at "Continue with Google"
 *  - oauth_other  → point the user at their OAuth provider
 * Absent → a plain wrong-password message with no special affordance.
 */
export interface LoginState {
  error: string | null;
  kind?: 'no_account' | 'oauth_google' | 'oauth_other';
  /** The email the user typed, echoed back so the "create one?" link can prefill signup. */
  email?: string;
}

export async function loginWithPassword(_prev: unknown, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  // Brute-force guard BEFORE any credential work: per caller IP and per
  // target email. The limited message is honest about the wait; every other
  // path below is untouched.
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const limited = authGuard.check('login', ip, email);
  if (limited.limited) return { error: limited.error };

  try {
    await signIn('credentials', { email, password, redirectTo: '/overview' });
  } catch (err) {
    // next-auth throws a redirect on success; only real auth errors fall here.
    if (err instanceof Error && err.name === 'CredentialsSignin') {
      return explainLoginFailure(email);
    }
    throw err;
  }
  return { error: null };
}

// Turn a failed credentials login into the TRUTH about the email, so the user
// isn't stuck guessing a password for an account that doesn't exist or that
// only has a Google sign-in. Falls back to the generic message if the input
// is too malformed to classify.
async function explainLoginFailure(email: string): Promise<LoginState> {
  if (!email.includes('@')) return { error: 'Invalid email or password.' };
  const account = await classifyAccount(db, email);
  switch (account.kind) {
    case 'none':
      return { error: `No Kuma account for ${email}.`, kind: 'no_account', email };
    case 'oauth':
      if (account.provider === 'google') {
        return {
          error: 'This email signed up with Google. Use “Continue with Google” above.',
          kind: 'oauth_google',
        };
      }
      return {
        error: 'This email is registered through a connected sign-in provider — use that to continue.',
        kind: 'oauth_other',
      };
    case 'password':
      return { error: 'Invalid email or password.' };
  }
}

export async function googleSignIn() {
  await signIn('google', { redirectTo: '/overview' });
}
