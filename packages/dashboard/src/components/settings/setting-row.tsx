import type * as React from "react";
import Link from "next/link";
import { IconChevronRight } from "@tabler/icons-react";

/**
 * The two Settings row primitives, shared by the Settings page and the
 * Settings Connections card.
 *
 * They used to be file-local to `app/(dashboard)/settings/page.tsx`, but a
 * Next.js App Router page module may not have arbitrary named exports — the
 * generated page type guard (`Diff<…, TEntry, ''>`) tags every export that is
 * not `default`/`metadata`/`dynamic`/… as an invalid page export field, so
 * `next build` would fail. Extracting them here keeps ONE definition that both
 * surfaces import, so the Settings rows can never drift apart.
 */

/** A label/value row: the value is a real fact, never a placeholder. */
export function SettingRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-content-muted">{label}</span>
      <span className={`text-sm text-content-secondary ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

/** A navigational row into a workspace surface that now lives under Settings
 *  (Connections, AI Models, Review History). `detail` takes a node so callers
 *  can render real state (status line + names) under the label; `badge` and
 *  `action` are optional affordances used by the Connections card. */
export function SettingLink({
  href,
  label,
  detail,
  badge,
  action,
}: {
  href: string;
  label: string;
  detail: React.ReactNode;
  badge?: React.ReactNode;
  action?: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 transition-colors"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-content-primary group-hover:text-accent-primary">
            {label}
          </span>
          {badge}
        </div>
        <div className="text-xs text-content-muted">{detail}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {action && (
          <span className="text-xs font-medium text-content-muted group-hover:text-accent-primary">
            {action}
          </span>
        )}
        <IconChevronRight className="h-4 w-4 shrink-0 text-content-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent-primary" />
      </div>
    </Link>
  );
}
