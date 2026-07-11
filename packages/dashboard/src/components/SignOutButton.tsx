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
        className="text-xs text-content-muted hover:text-content-secondary transition-colors"
      >
        Sign out
      </button>
    </form>
  );
}
