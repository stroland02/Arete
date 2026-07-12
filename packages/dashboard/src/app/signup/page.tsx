import { redirect } from 'next/navigation';
import { auth } from '../../lib/auth';
import { SignupForm } from './signup-form';

export default async function SignupPage() {
  const session = await auth();
  if (session) {
    redirect('/overview');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
      <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />

      <SignupForm />
    </div>
  );
}
