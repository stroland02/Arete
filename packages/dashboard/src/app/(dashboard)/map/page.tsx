import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveSelectedInstallationIds } from "@/lib/queries";
import { getSensoriumViewModel } from "@/lib/sensorium";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { CodeMapWorkspace } from "@/components/dashboard/code-map-workspace";
import type { CodeMapSelection } from "@/lib/code-map-sidebar";

// Session-scoped Prisma reads on every request — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function CodeMapPage({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string; node?: string; folder?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { installation, node, folder } = await searchParams;
  // Tenancy: installations come from the session, never from the client.
  const installationIds = resolveSelectedInstallationIds(session.installations ?? [], installation);
  const graphExternalId = (session.installations ?? []).find((i) => i.id === installationIds[0])?.externalId;
  const sensorium = await getSensoriumViewModel(db, installationIds, graphExternalId);

  // Deep link: /map?node=<fileId> or /map?folder=<folderPath>. An unknown id is
  // simply ignored by the workspace (buildSidebarModel returns null → no drawer).
  const initialSelection: CodeMapSelection | null = node
    ? { kind: "file", id: node }
    : folder
      ? { kind: "folder", id: folder }
      : null;

  return (
    <PageReveal className="flex h-full min-h-0 flex-col space-y-4">
      <RevealItem>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-content-primary">Code map</h1>
          <p className="text-sm text-content-muted">
            Your codebase as Kuma sees it — folders, files, and the live signals on them. Click
            anything to inspect it.
          </p>
        </div>
      </RevealItem>

      <RevealItem className="min-h-0 flex-1">
        {sensorium.hasAccess && sensorium.available ? (
          <CodeMapWorkspace
            topology={sensorium.topology!}
            sensors={sensorium.sensors!}
            findings={sensorium.findings ?? []}
            initialSelection={initialSelection}
          />
        ) : (
          <div className="rounded-xl border border-border-subtle bg-surface-1 p-10 text-center text-sm text-content-muted">
            {sensorium.hasAccess
              ? (sensorium.reason ?? "Kuma is building your code map from your connected repository.")
              : "Connect a repository to see your code map."}
          </div>
        )}
      </RevealItem>
    </PageReveal>
  );
}
