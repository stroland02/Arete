import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ServicesWorkspace } from "@/components/dashboard/services/services-workspace";

// Session-scoped like every dashboard page; never statically prerendered.
export const dynamic = "force-dynamic";

// Services "Triage Inbox" — production signals from connected telemetry,
// compiled per service, with the agent's proposed fix and a human-approve
// flow. Renders with NO services/issues today (no connector ingestion wired
// yet) — ServicesWorkspace shows its honest empty state and routes to
// /connections. Real data will be passed in here once the backend ingestion
// pipeline (Sentry etc.) populates the Service/Issue contract.
export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ container?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { container } = await searchParams;
  const connected = (session.installations ?? []).length > 0;
  return <ServicesWorkspace connected={connected} containerId={container ?? null} />;
}
