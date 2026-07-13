'use client'; // Error boundaries must be Client Components

import { useEffect } from 'react';
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';

export default function Error({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  // Added in Next.js 16.2: re-fetches Server Component data before re-rendering,
  // unlike reset() which only clears the error state.
  unstable_retry?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const retry = unstable_retry ?? reset;

  return (
    <div className="flex min-h-[60vh] items-center justify-center animate-in fade-in duration-500">
      <div className="glass-panel max-w-md w-full p-8 flex flex-col items-center gap-6 text-center bg-content-primary/5 border border-border-default rounded-2xl">
        <div className="p-4 bg-accent-danger/10 rounded-2xl border border-accent-danger/25">
          <IconAlertTriangle className="w-8 h-8 text-accent-danger" />
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">
            Something went wrong
          </h2>
          <p className="text-sm text-content-muted">
            We couldn&apos;t load the dashboard data. This is usually temporary
            &mdash; try again in a moment.
          </p>
          {error.digest && (
            <p className="text-xs text-content-muted font-mono">Error digest: {error.digest}</p>
          )}
        </div>
        <button
          onClick={() => retry()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-500/20 border border-indigo-500/30 hover:bg-indigo-500/30 transition-colors"
        >
          <IconRefresh className="w-4 h-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
