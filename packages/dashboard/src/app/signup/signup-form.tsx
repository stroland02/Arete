'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { googleSignIn } from '../login/actions';
import { signup } from './actions';

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signup, { error: null as string | null });

  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <div className="text-center">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-content-primary">
          Create your Aret<span className="text-accent-secondary">é</span> account
        </h1>
        <p className="mt-2 text-sm text-content-muted">Start free — no credit card required.</p>
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
        or continue with email
        <div className="h-px flex-1 bg-border-default" />
      </div>

      <form action={formAction} className="w-full flex flex-col gap-3">
        <label className="text-left text-xs text-content-muted" htmlFor="signup-name">
          Name <span className="opacity-60">(optional)</span>
        </label>
        <input
          id="signup-name"
          name="name"
          type="text"
          autoComplete="name"
          className="w-full px-4 py-2.5 rounded-xl bg-surface-2 border border-border-default text-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/30"
          placeholder="Ada Lovelace"
        />
        <label className="text-left text-xs text-content-muted" htmlFor="signup-email">
          Email
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full px-4 py-2.5 rounded-xl bg-surface-2 border border-border-default text-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/30"
          placeholder="you@company.com"
        />
        <label className="text-left text-xs text-content-muted" htmlFor="signup-password">
          Password
        </label>
        <input
          id="signup-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full px-4 py-2.5 rounded-xl bg-surface-2 border border-border-default text-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/30"
          placeholder="At least 8 characters"
        />
        {state?.error ? (
          <p role="alert" className="text-sm text-accent-danger">
            {state.error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="mt-1 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-medium text-white bg-accent-primary shadow-sm hover:bg-accent-primary/90 transition-colors disabled:opacity-60"
        >
          Create account
        </button>
      </form>

      <p className="text-center text-sm text-content-muted">
        Already have an account?{' '}
        <Link href="/login" className="text-accent-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
