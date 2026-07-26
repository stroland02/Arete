'use server';
import { headers } from 'next/headers';
import { signIn } from '@/lib/auth';
import { authGuard } from '@/lib/auth-rate-limit';
import { db } from '@/lib/db';
import { classifyAccount, createEmailUser, DuplicateEmailError } from '@/lib/users';

export async function signup(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim() || null;
  const password = String(formData.get('password') ?? '');
  if (!email.includes('@')) return { error: 'Enter a valid email address.' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };

  // Abuse guard BEFORE any account work: per caller IP and per target email
  // (stricter than login — account creation is rarer than a typo'd password).
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const limited = authGuard.check('signup', ip, email);
  if (limited.limited) return { error: limited.error };

  try {
    await createEmailUser(db, { email, name, password });
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      // Never silently create a second tenant over an existing email. Tell the
      // user the truth about the account they already have so they can sign in
      // the right way — a Google-registered email must not read as "taken".
      const account = await classifyAccount(db, email);
      if (account.kind === 'oauth' && account.provider === 'google') {
        return { error: 'This email signed up with Google. Sign in with “Continue with Google” instead.' };
      }
      return { error: 'An account with this email already exists — sign in instead.' };
    }
    throw err;
  }
  await signIn('credentials', { email, password, redirectTo: '/overview' });
  return { error: null };
}
