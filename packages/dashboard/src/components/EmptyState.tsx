import { IconBrandGithub } from '@tabler/icons-react';

/**
 * Shown when the logged-in user is authenticated but authorized for zero
 * Installations — either they haven't installed the Areté GitHub App yet,
 * or they aren't an admin of any org/account that has. Never falls back to
 * rendering empty/zeroed metrics for this case, which would be
 * indistinguishable from "everything is fine, zero reviews so far".
 */
export function EmptyState() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center animate-in fade-in duration-500">
      <div className="glass-panel max-w-md w-full p-8 flex flex-col items-center gap-6 text-center bg-white/5 border border-white/10 rounded-2xl">
        <div className="p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
          <IconBrandGithub className="w-8 h-8 text-indigo-400" />
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">
            Install the Areté GitHub App
          </h2>
          <p className="text-sm text-slate-400">
            We couldn&apos;t find any installation you administer. Install the Areté GitHub App on
            your account or org, or ask an org admin to, then come back and refresh.
          </p>
        </div>
        <a
          href="https://github.com/apps/arete-ai-code-review"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-500/20 border border-indigo-500/30 hover:bg-indigo-500/30 transition-colors"
        >
          <IconBrandGithub className="w-4 h-4" />
          Install on GitHub
        </a>
      </div>
    </div>
  );
}
