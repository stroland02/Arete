import type { ReactNode } from "react";
import { IconChartBar } from "@tabler/icons-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ConnectPrompt, type ConnectKind } from "./connect-prompt";

export interface WidgetProps {
  title: string;
  /** Small caption under the title (e.g. "as of last review"). */
  caption?: string;
  /** When true, render the honest empty state instead of children. */
  isEmpty?: boolean;
  emptyLabel?: string;
  /** When set, render a "connect a repository/service" prompt in place of
   *  data — the honest not-connected preview. Takes precedence over isEmpty,
   *  and suppresses the header action (there is no data to summarize yet). */
  connect?: ConnectKind;
  /** Optional right-aligned header slot (badge, count). */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Widget({ title, caption, isEmpty, emptyLabel = "Nothing to show yet", connect, action, className, children }: WidgetProps) {
  return (
    <Card className={className}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-content-primary">{title}</h3>
          {caption && <p className="mt-0.5 text-[11px] text-content-muted">{caption}</p>}
        </div>
        {connect ? null : action}
      </div>
      {connect ? (
        <ConnectPrompt kind={connect} />
      ) : isEmpty ? (
        <EmptyState icon={<IconChartBar className="h-5 w-5" />} title={emptyLabel} />
      ) : (
        children
      )}
    </Card>
  );
}
