import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The Incidents inbox lives as a section of the Overview page (same "one
 * home" pattern as /dashboards → /overview). This route exists only so the
 * sidebar's "Incidents" entry — and any deep link to /incidents — lands
 * somewhere real instead of 404ing; individual incidents still resolve at
 * /incidents/[id]. Preserves any `?installation=` selection losslessly.
 */
export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string }>;
}) {
  const { installation } = await searchParams;
  redirect(installation ? `/overview?installation=${encodeURIComponent(installation)}` : "/overview");
}
