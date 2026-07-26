import { redirect } from "next/navigation";
import Link from "next/link";
import { IconBrandGithub, IconChevronRight, IconCircleCheck, IconSparkles } from "@tabler/icons-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getConnectedRepositories, resolveSelectedInstallationIds } from "@/lib/queries";
import { CONNECTORS } from "@/lib/connector-catalog";
import { ConnectorIcon } from "@/components/connections/connector-icon";
import { AccountIdentity } from "@/components/connections/account-identity";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";

// Reads the session and the caller's real installation/repository state on
// every request — must never be statically prerendered (same reasoning as
// /overview: a session-scoped page baked at build time would be wrong or leak
// one tenant's data to everyone).
export const dynamic = "force-dynamic";

const GITHUB_APP_SLUG = process.env.GITHUB_APP_SLUG ?? "kumaservices";

export default async function ConnectionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const email = session.user.email ?? null;
  const installations = session.installations ?? [];
  const installationIds = resolveSelectedInstallationIds(installations, undefined);
  const connected = installationIds.length > 0;
  const repos = connected ? await getConnectedRepositories(db, installationIds) : [];

  return (
    <PageReveal className="mx-auto max-w-5xl space-y-6">
      <RevealItem>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-content-primary">Connect your data</h1>
          <p className="text-sm text-content-muted">
            Every connected source gives Kuma real production context — so a review can say
            &quot;this endpoint failed 6 times this week&quot; instead of judging the diff alone.
          </p>
        </div>
      </RevealItem>

      {email ? (
        <RevealItem>
          <AccountIdentity email={email} workspaces={installations} />
        </RevealItem>
      ) : null}

      <RevealItem>
        <div className="glass-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
              connected
                ? "border-accent-success/25 bg-accent-success/10 text-accent-success"
                : "border-accent-primary/20 bg-accent-primary/10 text-accent-primary"
            }`}
          >
            <IconBrandGithub className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-content-primary">Kuma GitHub App</span>
              {connected ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-accent-success/25 bg-accent-success/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-success">
                  <IconCircleCheck className="h-3 w-3" stroke={2.25} />
                  Connected
                </span>
              ) : (
                <span className="rounded-full border border-accent-primary/20 bg-accent-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-accent-primary/80">
                  Core
                </span>
              )}
            </div>
            {connected ? (
              <p className="mt-0.5 text-xs text-content-muted">
                {repos.length > 0 ? (
                  <>
                    Reviewing{" "}
                    <span className="font-medium text-content-secondary">
                      {repos.length === 1
                        ? repos[0]
                        : `${repos[0]} +${repos.length - 1} more`}
                    </span>
                    . Every pull request on {repos.length === 1 ? "it" : "these"} is reviewed automatically.
                  </>
                ) : (
                  <>Installed — Kuma is indexing your repositories. Open a pull request and its review appears on your overview.</>
                )}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-content-muted">
                Install the Kuma GitHub App on your account or org so Kuma can review your pull
                requests. This is the core connection that powers your overview dashboard.
              </p>
            )}

            {/* The concrete repositories Kuma is connected to. */}
            {repos.length > 1 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {repos.map((fullName) => (
                  <li
                    key={fullName}
                    className="rounded-md border border-border-subtle bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-content-secondary"
                  >
                    {fullName}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <a
            href={`https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`}
            className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
              connected
                ? "border-border-default bg-surface-2 text-content-secondary hover:bg-content-primary/5"
                : "border-accent-primary/30 bg-accent-primary/20 text-white hover:bg-accent-primary/30"
            }`}
          >
            <IconBrandGithub className="h-4 w-4" />
            {connected ? "Manage on GitHub" : "Install on GitHub"}
          </a>
        </div>
      </RevealItem>

      <RevealItem>
        <div className="glass-panel divide-y divide-border-subtle overflow-hidden">
          {/* AI Models is one catalog row like any other connection; the
              provider list (Anthropic … Local · Ollama) lives on its page. */}
          <Link
            href="/connections/ai-models"
            className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-content-primary/[0.03] group"
          >
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-content-primary/5 border border-border-default text-content-secondary shrink-0">
              <IconSparkles className="w-5 h-5" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-content-primary">AI Models</span>
                <span className="text-[10px] font-medium text-content-muted border border-border-subtle rounded-full px-1.5 py-0.5">
                  Review engine
                </span>
              </div>
              <p className="text-xs text-content-muted mt-0.5 truncate">
                Choose the model Kuma runs reviews on — Local · Ollama is the free default, or bring your own key.
              </p>
            </div>

            <IconChevronRight className="w-4 h-4 text-content-muted shrink-0 transition-transform group-hover:translate-x-0.5" />
          </Link>
          {CONNECTORS.map((connector) => (
            <Link
              key={connector.id}
              href={`/connections/${connector.id}`}
              className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-content-primary/[0.03] group"
            >
              <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-content-primary/5 border border-border-default text-content-secondary shrink-0">
                <ConnectorIcon id={connector.id} className="w-5 h-5" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-content-primary">{connector.name}</span>
                  <span className="text-[10px] font-medium text-content-muted border border-border-subtle rounded-full px-1.5 py-0.5">
                    {connector.category}
                  </span>
                  {connector.status === "planned" && (
                    <span className="text-[10px] font-medium text-accent-info/80 border border-accent-info/20 bg-accent-info/5 rounded-full px-1.5 py-0.5">
                      Planned
                    </span>
                  )}
                </div>
                <p className="text-xs text-content-muted mt-0.5 truncate">{connector.tagline}</p>
              </div>

              <IconChevronRight className="w-4 h-4 text-content-muted shrink-0 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </RevealItem>

      <RevealItem>
        <p className="text-xs text-content-muted text-center">
          Not ready yet? Every connector is optional — Kuma reviews from the diff alone until you connect one.
        </p>
      </RevealItem>
    </PageReveal>
  );
}
