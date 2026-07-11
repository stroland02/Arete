import { IconMessageOff } from "@tabler/icons-react";
import { EmptyState } from "./empty-state";

export interface CategoryCount {
  category: string;
  count: number;
}

function formatCategory(category: string): string {
  return category
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function categoryColor(category: string): string {
  switch (category.toLowerCase()) {
    case "security":
      return "bg-accent-danger";
    case "performance":
      return "bg-accent-primary";
    case "style":
    case "quality":
    case "maintainability":
      return "bg-accent-info";
    case "test":
    case "testing":
    case "coverage":
      return "bg-accent-success";
    default:
      return "bg-accent-secondary";
  }
}

export function CategoryBreakdown({ categories }: { categories: CategoryCount[] }) {
  if (categories.length === 0) {
    return (
      <EmptyState
        icon={<IconMessageOff className="w-6 h-6" />}
        title="No review comments yet"
        description="Comment categories will appear here once reviews run."
      />
    );
  }

  const sorted = [...categories].sort((a, b) => b.count - a.count);
  const total = sorted.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <div className="space-y-3">
      {sorted.map((entry) => {
        const pct = total > 0 ? (entry.count / total) * 100 : 0;
        return (
          <div key={entry.category} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-sm text-content-secondary font-medium truncate">
              {formatCategory(entry.category)}
            </span>
            <div className="flex-1 h-2.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full rounded-full ${categoryColor(entry.category)}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-xs text-content-muted font-mono tabular-nums">
              {entry.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}
