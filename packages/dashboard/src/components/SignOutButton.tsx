import { signOut } from '../lib/auth';

export function SignOutButton() {
  return (
    <form
      action={async () => {
        'use server';
        await signOut({ redirectTo: '/login' });
      }}
    >
      <button
        type="submit"
        className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        Sign out
      </button>
    </form>
  );
}
