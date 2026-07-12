'use server';
import { signIn } from '@/lib/auth';

export async function loginWithPassword(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  try {
    await signIn('credentials', { email, password, redirectTo: '/overview' });
  } catch (err) {
    // next-auth throws a redirect on success; only real auth errors fall here.
    if (err instanceof Error && err.name === 'CredentialsSignin') {
      return { error: 'Invalid email or password.' };
    }
    throw err;
  }
  return { error: null };
}

export async function googleSignIn() {
  await signIn('google', { redirectTo: '/overview' });
}
