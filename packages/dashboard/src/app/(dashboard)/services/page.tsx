import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { ServicesWorkspace } from "@/components/dashboard/services/services-workspace";

// Session-scoped like every dashboard page; never statically prerendered.
export const dynamic = "force-dynamic";

// Services "Triage Inbox" — production signals from connected telemetry,
// compiled per service, with the agent's proposed fix and a human-approve
// flow. This first cut renders illustrative sample data against the real
// Service/Issue contract (see services-workspace.tsx); the backend ingestion
// pipeline will populate it next.
export default async function ServicesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <PageReveal className="space-y-6">
      <RevealItem>
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-content-primary">Services</h1>
          <p className="mt-1 text-sm text-content-muted">
            Issues from your connected services, compiled and triaged — pick a service to see what
            Areté caught and the fix it proposes.
          </p>
        </div>
      </RevealItem>
      <RevealItem>
        <ServicesWorkspace />
      </RevealItem>
    </PageReveal>
  );
}
