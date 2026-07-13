import type { ReviewSummary } from "@/lib/queries";
import { Widget } from "./widget";
import { ActivityList, type ActivityItem } from "@/components/dashboard/activity-list";

export interface TableWidgetProps {
  title: string;
  reviews: ReviewSummary[];
}

export function TableWidget({ title, reviews }: TableWidgetProps) {
  const items: ActivityItem[] = reviews.map((r) => ({
    id: r.id,
    repositoryName: r.repositoryFullName,
    prNumber: r.prNumber,
    createdAt: r.createdAt.toISOString(),
    riskLevel: r.riskLevel,
  }));
  return (
    <Widget title={title} isEmpty={items.length === 0} emptyLabel="No reviews yet">
      <ActivityList reviews={items} />
    </Widget>
  );
}
