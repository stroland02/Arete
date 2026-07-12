'use server';
import { signIn } from '@/lib/auth';
import { db } from '@/lib/db';
import { createEmailUser, DuplicateEmailError } from '@/lib/users';

export async function signup(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim() || null;
  const password = String(formData.get('password') ?? '');
  if (!email.includes('@')) return { error: 'Enter a valid email address.' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
  try {
    await createEmailUser(db, { email, name, password });
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return { error: 'An account with this email already exists.' };
    }
    throw err;
  }
  await signIn('credentials', { email, password, redirectTo: '/overview' });
  return { error: null };
}
