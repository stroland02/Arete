import { IconBrandGithub } from '@tabler/icons-react';

/**
 * Shown when the logged-in user is authenticated but authorized for zero
 * Installations — either they haven't installed the Kuma GitHub App yet,
 * or they aren't an admin of any org/account that has. Never falls back to
 * rendering empty/zeroed metrics for this case, which would be
 * indistinguishable from "everything is fine, zero reviews so far".
 */
export function EmptyState() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center animate-in fade-in duration-500">
      <div className="glass-panel max-w-md w-full p-8 flex flex-col items-center gap-6 text-center">
        <div className="p-4 bg-accent-primary/10 rounded-2xl border border-accent-primary/20">
          <IconBrandGithub className="w-8 h-8 text-accent-primary" />
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold font-serif text-content-primary">
            Install the Kuma GitHub App
          </h2>
          <p className="text-sm text-content-muted">
            We couldn&apos;t find any installation you administer. Install the Kuma GitHub App on
            your account or org, or ask an org admin to, then come back and refresh.
          </p>
        </div>
        <a
          href={`https://github.com/apps/${process.env.GITHUB_APP_SLUG ?? 'kumaservices'}/installations/new`}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-accent-primary bg-accent-primary/10 border border-accent-primary/30 hover:bg-accent-primary/15 transition-colors"
        >
          <IconBrandGithub className="w-4 h-4" />
          Install on GitHub
        </a>
      </div>
    </div>
  );
}
