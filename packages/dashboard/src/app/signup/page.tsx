import { redirect } from 'next/navigation';
import { auth } from '../../lib/auth';
import { SignupForm } from './signup-form';
import { AuthBrandPanel } from '@/components/auth/auth-brand-panel';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const session = await auth();
  if (session) {
    redirect('/overview');
  }

  // Prefill from the login page's "create one?" hand-off so the user never
  // retypes the email they just tried to sign in with.
  const { email } = await searchParams;

  return (
    <div className="grid min-h-screen grid-cols-1 bg-surface-0 lg:grid-cols-2">
      <AuthBrandPanel />
      <div className="flex items-center justify-center px-6 py-12">
        <SignupForm initialEmail={email ?? ''} />
      </div>
    </div>
  );
}
