"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IconWebhook, IconPlus, IconCheck } from "@tabler/icons-react";
import type { WebhookEndpointView } from "@/lib/webhook-endpoints-api";

export function WebhooksCard({
  endpoints,
  installations,
}: {
  endpoints: WebhookEndpointView[];
  installations: { id: string; owner: string; isPlatformInstallation: boolean }[];
}) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string>("review.completed, issue.created");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const platformInstalls = installations.filter((i) => i.isPlatformInstallation);
  const [selectedInst, setSelectedInst] = useState(platformInstalls[0]?.id ?? "");

  if (platformInstalls.length === 0) {
    return null;
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNewSecret(null);
    try {
      const res = await fetch("/api/webhooks/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationId: selectedInst,
          url,
          events: events.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create webhook.");
        return;
      }
      setNewSecret(data.secret);
      setIsAdding(false);
      setUrl("");
      router.refresh();
    } catch {
      setError("Network error creating webhook.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconWebhook className="w-5 h-5 text-content-secondary" />
          Outbound Webhooks
        </CardTitle>
      </CardHeader>
      <div className="p-4 space-y-4">
        {endpoints.length === 0 && !isAdding ? (
          <p className="text-sm text-content-muted">
            No outbound webhooks configured. Configure webhooks to receive real-time updates.
          </p>
        ) : (
          <ul className="space-y-3">
            {endpoints.map((ep) => (
              <li key={ep.id} className="flex items-center justify-between p-3 border border-border-subtle rounded-lg bg-surface-1/50">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] text-content-primary truncate">{ep.url}</span>
                    <Badge variant={ep.enabled ? "positive" : "neutral"}>
                      {ep.enabled ? "Active" : "Disabled"}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-content-muted tracking-wide truncate">
                    {ep.events.join(", ")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {newSecret && (
          <div className="p-4 border border-accent-success/20 bg-accent-success/5 rounded-xl space-y-2">
            <h4 className="text-sm font-semibold text-accent-success flex items-center gap-2">
              <IconCheck className="w-4 h-4" /> Webhook created
            </h4>
            <p className="text-xs text-content-secondary">
              Please copy this signing secret now. You won't be able to see it again.
            </p>
            <code className="block p-2 text-xs font-mono bg-surface-0 border border-border-default rounded text-content-primary">
              {newSecret}
            </code>
          </div>
        )}

        {isAdding ? (
          <form onSubmit={handleAdd} className="p-4 border border-border-strong rounded-xl bg-surface-1 space-y-3 mt-4">
            {error && <p className="text-xs text-accent-danger">{error}</p>}
            <div className="space-y-1">
              <label className="text-xs font-medium text-content-secondary">Target URL</label>
              <input
                required
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.example.com/webhooks"
                className="w-full text-sm p-2 rounded-lg border border-border-default bg-surface-0 text-content-primary placeholder:text-content-muted/50"
              />
            </div>
            {platformInstalls.length > 1 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-content-secondary">Installation</label>
                <select
                  value={selectedInst}
                  onChange={(e) => setSelectedInst(e.target.value)}
                  className="w-full text-sm p-2 rounded-lg border border-border-default bg-surface-0 text-content-primary"
                >
                  {platformInstalls.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.owner}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium text-content-secondary">Events</label>
              <input
                required
                value={events}
                onChange={(e) => setEvents(e.target.value)}
                placeholder="review.completed, issue.created"
                className="w-full text-sm p-2 rounded-lg border border-border-default bg-surface-0 text-content-primary placeholder:text-content-muted/50"
              />
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                disabled={busy}
                className="px-3 py-1.5 text-sm font-medium bg-accent-primary text-white rounded-lg hover:bg-accent-primary/90 disabled:opacity-50"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-3 py-1.5 text-sm font-medium text-content-secondary hover:text-content-primary"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-content-secondary hover:text-accent-primary transition-colors"
          >
            <IconPlus className="w-4 h-4" /> Add endpoint
          </button>
        )}
      </div>
    </Card>
  );
}
