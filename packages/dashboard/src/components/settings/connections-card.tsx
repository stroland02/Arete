import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SettingLink } from "@/components/settings/setting-row";
import type { ConnectionRow, ConnectionsSummary } from "@/lib/settings-connections";

/**
 * Settings → Connections: ONE place that states what this account actually has
 * connected — repositories, AI model, services — and links out to manage each.
 *
 * It summarizes; it does not manage. `/connections` (and `/connections/ai-models`)
 * remain the management home, so this card only ever renders state + a link.
 *
 * Presentational only: every value comes from `deriveConnectionsSummary`, which
 * is derived from `getAccountState` and the real per-tenant queries. Nothing
 * here invents a value — a row with nothing connected renders its explicit
 * "Not connected" copy and a connect CTA, never a plausible-looking placeholder.
 * A connected-but-idle row (repo connected, no reviews yet) renders as
 * CONNECTED with its real repositories listed — the three-state rule.
 */
export function ConnectionsCard({ summary }: { summary: ConnectionsSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connections</CardTitle>
        <Badge variant={summary.connectedCount > 0 ? "positive" : "neutral"}>
          {summary.connectedCount} of {summary.totalCount} connected
        </Badge>
      </CardHeader>
      <div className="divide-y divide-border-subtle">
        {summary.rows.map((row) => (
          <SettingLink
            key={row.id}
            href={row.href}
            label={row.label}
            badge={<StatusBadge row={row} />}
            action={row.actionLabel}
            detail={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{row.status}</span>
                {row.items.map((item) => (
                  <span
                    key={item}
                    className="rounded-md border border-border-subtle bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-content-secondary"
                  >
                    {item}
                  </span>
                ))}
              </span>
            }
          />
        ))}
      </div>
      <p className="mt-4 border-t border-border-subtle pt-4 text-xs text-content-muted">
        Connections are managed on the Connections page — this is a read-only summary of what
        Kuma is connected to right now.
      </p>
    </Card>
  );
}

/** Connected / connected-but-idle / not connected — never collapsed together. */
function StatusBadge({ row }: { row: ConnectionRow }) {
  if (!row.connected) return <Badge variant="neutral">Not connected</Badge>;
  if (row.idle) return <Badge variant="neutral">Connected · idle</Badge>;
  return <Badge variant="positive">Connected</Badge>;
}
