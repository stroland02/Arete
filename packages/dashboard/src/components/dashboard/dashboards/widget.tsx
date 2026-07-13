import type { ReactNode } from "react";
import { IconChartBar } from "@tabler/icons-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";

export interface WidgetProps {
  title: string;
  /** Small caption under the title (e.g. "as of last review"). */
  caption?: string;
  /** When true, render the honest empty state instead of children. */
  isEmpty?: boolean;
  emptyLabel?: string;
  /** Optional right-aligned header slot (badge, count). */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Widget({ title, caption, isEmpty, emptyLabel = "Nothing to show yet", action, className, children }: WidgetProps) {
  return (
    <Card className={className}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-content-primary">{title}</h3>
          {caption && <p className="mt-0.5 text-[11px] text-content-muted">{caption}</p>}
        </div>
        {action}
      </div>
      {isEmpty ? <EmptyState icon={<IconChartBar className="h-5 w-5" />} title={emptyLabel} /> : children}
    </Card>
  );
}
