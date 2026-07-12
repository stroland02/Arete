import { IconChartBar } from "@tabler/icons-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "./empty-state";
import type { CategoryCount } from "@/lib/queries";

/**
 * "Comments by Category" analytics panel (SuperLog-style): one thin
 * horizontal bar per category, single hue (magnitude of one measure — count
 * per category — so no multi-hue legend is needed), direct count labels in
 * text tokens. Purely presentational; driven by the real
 * `commentsByCategory` aggregation, empty state when there are none.
 */

/** "test_coverage" → "Test Coverage" — category ids are the agent ids. */
function formatCategory(category: string): string {
  return category
    .split(/[_-]/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export function CommentsByCategory({ categories }: { categories: CategoryCount[] }) {
  const max = Math.max(...categories.map((c) => c.count), 1);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Comments by Category</CardTitle>
      </CardHeader>

      {categories.length === 0 ? (
        <EmptyState
          icon={<IconChartBar className="h-6 w-6" />}
          title="No findings yet"
          description="The category breakdown appears after your first reviewed pull request."
        />
      ) : (
        <ul className="space-y-4">
          {categories.map((entry) => {
            const label = formatCategory(entry.category);
            return (
              <li
                key={entry.category}
                className="flex items-center gap-3"
                aria-label={`${label}: ${entry.count} comment${entry.count === 1 ? "" : "s"}`}
              >
                <span className="w-32 shrink-0 truncate text-xs font-medium text-content-secondary">
                  {label}
                </span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/5">
                  <span
                    className="block h-full rounded-full bg-accent-primary/80"
                    style={{ width: `${Math.max((entry.count / max) * 100, 2)}%` }}
                    data-bar
                  />
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-content-primary">
                  {entry.count}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
