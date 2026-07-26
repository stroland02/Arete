import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The Dashboards charts now live as a section of the Overview page (one home,
 * not two tabs). This route is kept only to redirect old links/bookmarks —
 * preserving any `?installation=` selection so the redirect is lossless.
 */
export default async function DashboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string }>;
}) {
  const { installation } = await searchParams;
  redirect(installation ? `/overview?installation=${encodeURIComponent(installation)}` : "/overview");
}
