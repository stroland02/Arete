'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { loginWithPassword, googleSignIn } from './actions';

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginWithPassword, { error: null as string | null });

  return (
    <div className="glass-panel max-w-sm w-full p-8 flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold font-serif text-content-primary tracking-tight">
          Aret<span className="text-accent-secondary">é</span>
        </h1>
        <p className="mt-2 text-sm text-content-muted">Sign in to your Areté account.</p>
      </div>

      <form action={googleSignIn} className="w-full">
        <button
          type="submit"
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-medium text-content-primary bg-surface-2 border border-border-default hover:bg-content-primary/5 transition-colors"
        >
          Continue with Google
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-content-muted">
        <div className="h-px flex-1 bg-border-default" />
        or
        <div className="h-px flex-1 bg-border-default" />
      </div>

      <form action={formAction} className="w-full flex flex-col gap-3">
        <label className="text-left text-xs text-content-muted" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full px-4 py-2.5 rounded-xl bg-surface-2 border border-border-default text-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/30"
          placeholder="you@company.com"
        />
        <label className="text-left text-xs text-content-muted" htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full px-4 py-2.5 rounded-xl bg-surface-2 border border-border-default text-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/30"
          placeholder="••••••••"
        />
        {state?.error ? (
          <p role="alert" className="text-sm text-accent-danger">
            {state.error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-medium text-white bg-accent-primary shadow-sm hover:bg-accent-primary/90 transition-colors disabled:opacity-60"
        >
          Sign in
        </button>
      </form>

      <p className="text-center text-sm text-content-muted">
        New to Areté?{' '}
        <Link href="/signup" className="text-accent-primary hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
