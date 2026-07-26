import { IconUserCircle } from "@tabler/icons-react";
import type { AuthorizedInstallation } from "@/lib/installations";

/**
 * Signed-in identity banner for Connections. When a tenant is empty (no
 * installations yet), the most common misread is "my data is gone" — so this
 * states plainly WHO you're signed in as and that an empty workspace is empty,
 * not lost. It never fabricates a workspace: with none connected it shows the
 * honest empty state, not an invented org name.
 */
export function AccountIdentity({
  email,
  workspaces,
}: {
  email: string;
  workspaces: AuthorizedInstallation[];
}) {
  return (
    <div className="glass-panel flex items-center gap-4 p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border-default bg-content-primary/5 text-content-secondary">
        <IconUserCircle className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-content-muted">Signed in as</p>
        <p className="truncate text-sm font-medium text-content-primary">{email}</p>
        {workspaces.length > 0 ? (
          <p className="mt-0.5 truncate text-xs text-content-muted">
            {workspaces.length === 1 ? "Workspace" : "Workspaces"}:{" "}
            {workspaces.map((w) => w.owner).join(", ")}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-content-muted">
            No repositories connected yet — this workspace is empty, not lost. Install the Kuma
            GitHub App below to get started.
          </p>
        )}
      </div>
    </div>
  );
}
