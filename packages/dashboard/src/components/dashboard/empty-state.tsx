import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  className?: string;
}

export function EmptyState({ icon, title, description, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className)}>
      <div className="p-3 bg-content-primary/5 rounded-2xl border border-border-default text-content-muted">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-content-secondary">{title}</p>
        {description && <p className="text-sm text-content-muted max-w-xs">{description}</p>}
      </div>
    </div>
  );
}
