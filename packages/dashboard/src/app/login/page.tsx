import { IconBrandGithub } from '@tabler/icons-react';
import { redirect } from 'next/navigation';
import { auth, signIn } from '../../lib/auth';

export default async function LoginPage() {
  const session = await auth();
  if (session) {
    redirect('/overview');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
      <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />

      <div className="glass-panel max-w-sm w-full p-8 flex flex-col items-center gap-6 text-center">
        <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-cyan-400 to-teal-300 tracking-tight">
          Areté AI
        </h1>
        <p className="text-sm text-content-muted">
          Sign in with the same GitHub account or org that installed the Areté GitHub App.
        </p>
        <form
          action={async () => {
            'use server';
            await signIn('github', { redirectTo: '/overview' });
          }}
          className="w-full"
        >
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-medium text-white bg-accent-primary/20 border border-accent-primary/30 hover:bg-accent-primary/30 transition-colors"
          >
            <IconBrandGithub className="w-5 h-5" />
            Sign in with GitHub
          </button>
        </form>
      </div>
    </div>
  );
}
