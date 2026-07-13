import { redirect } from 'next/navigation';
import { auth } from '../../lib/auth';
import { LoginForm } from './login-form';
import { AuthBrandPanel } from '@/components/auth/auth-brand-panel';

export default async function LoginPage() {
  const session = await auth();
  if (session) {
    redirect('/overview');
  }

  return (
    <div className="grid min-h-screen grid-cols-1 bg-surface-0 lg:grid-cols-2">
      <AuthBrandPanel />
      <div className="flex items-center justify-center px-6 py-12">
        <LoginForm />
      </div>
    </div>
  );
}
