"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconAlertTriangle,
  IconBolt,
  IconBrain,
  IconCheck,
  IconChevronRight,
  IconCpu,
  IconDiamond,
  IconExternalLink,
  IconLoader2,
  IconRoute,
  IconSparkles,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { MODEL_PROVIDERS, type ModelProviderDef } from "@/lib/model-catalog";
import {
  HttpModelConnectionsClient,
  type ModelConnection,
  type ModelConnectionsClient,
  type ModelTestOutcome,
} from "@/lib/model-connections-client";
import { consumePullStream } from "@/lib/ollama-pull";
import {
  activeConnectionId,
  connectionBadge,
  disconnectControl,
  findProviderConnection,
  setActiveControl,
} from "@/lib/ai-models-view";

/**
 * The "AI Models" Connections section. Providers render as rows in the same
 * list style as the connector catalog below (icon · name · badge · tagline ·
 * chevron); a row expands in place to the connect → model-select → Test →
 * Connected flow. The collapsed form stays in the DOM (hidden) so the section
 * is fully server-renderable.
 *
 * SEAM-FIRST: Test/connect go through ModelConnectionsClient (Eng1's
 * /api/model-connections). Until that route lands, `test` returns `not_configured`
 * and the row says so — it never fabricates a "Connected" state.
 *
 * ACTIVE = NEWEST: several providers can be connected, but reviews run on the
 * newest connection ("newest = active", mirroring getActiveModelConnection). The
 * section lists once, marks that one Active, and offers "Set active" on the rest.
 *
 * HONESTY: Ollama is badged the free default but never "infinite"; a non-Anthropic
 * provider states that verification runs on the connected model.
 */
const defaultClient: ModelConnectionsClient = new HttpModelConnectionsClient();

const PROVIDER_ICONS: Record<string, typeof IconSparkles> = {
  anthropic: IconSparkles,
  openai: IconBrain,
  gemini: IconDiamond,
  openrouter: IconRoute,
  ollama: IconCpu,
};

export function AiModelsSection({ client = defaultClient }: { client?: ModelConnectionsClient }) {
  // One list() for the whole section: a single source of truth for which
  // connections exist and which one is active (newest). Each row derives its
  // own state from this — no per-row list() and no way for two rows to disagree
  // about which is the live model.
  const [rows, setRows] = useState<ModelConnection[]>([]);

  const reload = useCallback(async () => {
    try {
      setRows(await client.list());
    } catch {
      /* leave the last-known rows in place on a transient list() failure */
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    client
      .list()
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client]);

  const activeId = activeConnectionId(rows);

  return (
    <section aria-label="AI Models" className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-content-primary">AI Models</h2>
        <p className="text-xs text-content-muted">
          Choose the model Kuma runs reviews on. Local · Ollama is the free default; connect a hosted
          provider with your own key to run on it instead. With several connected, the one marked{" "}
          <span className="font-medium text-content-secondary">Active</span> is the model reviews use.
        </p>
      </div>
      <div className="glass-panel divide-y divide-border-subtle overflow-hidden">
        {MODEL_PROVIDERS.map((provider) => {
          const connection = findProviderConnection(rows, provider.id);
          return (
            <ModelProviderRow
              key={provider.id}
              provider={provider}
              client={client}
              connection={connection}
              isActive={!!connection && connection.id === activeId}
              reload={reload}
            />
          );
        })}
      </div>
    </section>
  );
}

function outcomeMessage(provider: ModelProviderDef, outcome: ModelTestOutcome): { tone: "ok" | "warn" | "err"; text: string } {
  switch (outcome.status) {
    case "connected":
      return { tone: "ok", text: `Connected · ${outcome.model}` };
    case "unauthorized":
      return { tone: "err", text: "Credential rejected — check your key." };
    case "unreachable":
      return {
        tone: "err",
        text: provider.id === "ollama" ? "Couldn't reach Ollama at that URL — is it running?" : "Couldn't reach the provider.",
      };
    case "not_configured":
      return { tone: "warn", text: "Model connections aren't available yet." };
    case "failed":
      return { tone: "err", text: outcome.reason ? `Test failed — ${outcome.reason}` : "Test failed." };
  }
}

function ModelProviderRow({
  provider,
  client,
  connection,
  isActive,
  reload,
}: {
  provider: ModelProviderDef;
  client: ModelConnectionsClient;
  /** This provider's persisted connection, or null. Owned by the section. */
  connection: ModelConnection | null;
  /** True when this connection is the newest one — the model reviews run on. */
  isActive: boolean;
  /** Re-list the section after a mutation so the Active badge moves at once. */
  reload: () => Promise<void>;
}) {
  const isKey = provider.authKind === "api-key";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [model, setModel] = useState(provider.models[0]);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<ModelTestOutcome | null>(null);
  // Auto-detect a running local Ollama: prefill the Base URL and offer the
  // user's actually-pulled models. null = not yet probed. Ollama card only.
  const [detect, setDetect] = useState<{ running: boolean; models: string[] } | null>(null);
  // Auto-pull state: when Test is clicked for a model Ollama hasn't pulled
  // yet, we pull it first — "Test" means "connect", no manual terminal step.
  const [pulling, setPulling] = useState(false);
  const [pullStatus, setPullStatus] = useState<string | null>(null);
  // In-browser diagnostics for the Test flow: the exact request + HTTP status +
  // response body, rendered in the card. Server-side probe logs aren't a surface
  // the user watches, so failures are shown here where the click happens.
  const [diag, setDiag] = useState<string | null>(null);
  // Switch-active in flight (delete old row + recreate = fresh createdAt = active).
  const [switching, setSwitching] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  // Disconnect DELETES the saved (encrypted) key, and providers don't re-issue
  // keys — so it's guarded behind an explicit confirm to prevent accidental loss.
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  useEffect(() => {
    if (provider.id !== "ollama") return;
    let cancelled = false;
    fetch("/api/ollama/detect")
      .then((r) => r.json())
      .then((d: { running?: boolean; baseUrl?: string | null; models?: string[] }) => {
        if (cancelled) return;
        const models = Array.isArray(d.models) ? d.models : [];
        setDetect({ running: !!d.running, models });
        if (d.running && d.baseUrl) {
          setSecret((s) => s || (d.baseUrl as string));
          if (models.length > 0) setModel((m) => (models.includes(m) ? m : models[0]));
        }
      })
      .catch(() => {
        if (!cancelled) setDetect({ running: false, models: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [provider.id]);

  // Reflect the PERSISTED selection: when this provider is saved, default the
  // model select to the stored model so reopening the row matches reality. The
  // section owns whether it's connected/active — this only seeds the dropdown.
  useEffect(() => {
    if (connection) setModel(connection.model);
  }, [connection?.id, connection?.model]);

  // Real pulled models take precedence, then the catalog's suggestions.
  const modelOptions =
    detect && detect.models.length > 0
      ? Array.from(new Set([...detect.models, ...provider.models]))
      : provider.models;

  // api-key providers need a key; Ollama can fall back to its default base URL.
  const canTest = !testing && !pulling && !switching && (!isKey || secret.trim().length > 0);

  // The connect input for this provider's current form state.
  function connectInput() {
    return {
      provider: provider.id,
      model,
      ...(isKey ? { apiKey: secret } : { baseUrl: secret.trim() || provider.authPlaceholder }),
    };
  }

  async function runTest() {
    setTesting(true);
    setOutcome(null);
    setDiag(null);

    // Ollama-only: if the selected model isn't pulled yet, pull it first —
    // clicking "Test" means "connect" end-to-end, no manual terminal step.
    if (provider.id === "ollama" && detect?.running && model && !detect.models.includes(model)) {
      setPulling(true);
      setPullStatus(`Pulling ${model}…`);
      try {
        const res = await fetch("/api/ollama/pull", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model }),
        });
        const pullOutcome = await consumePullStream(res.body, (line) => {
          if (!line.status) return;
          setPullStatus(
            line.total
              ? `${line.status} (${Math.round(((line.completed ?? 0) / line.total) * 100)}%)`
              : line.status,
          );
        });
        if (!res.ok || !pullOutcome.ok) {
          setOutcome({ status: "failed", reason: pullOutcome.detail ?? `pull failed (${res.status})` });
          setPulling(false);
          setPullStatus(null);
          setTesting(false);
          return;
        }
        setDetect((d) => (d ? { ...d, models: Array.from(new Set([...d.models, model])) } : d));
      } catch (err) {
        setOutcome({ status: "failed", reason: err instanceof Error ? err.message : "pull request failed" });
        setPulling(false);
        setPullStatus(null);
        setTesting(false);
        return;
      }
      setPulling(false);
      setPullStatus(null);
    }

    const input = connectInput();

    // Determine the outcome. API-key providers use the opaque typed seam; Ollama
    // uses the diagnostic path below so its exact HTTP status + body are visible.
    let result: ModelTestOutcome;
    if (provider.id !== "ollama") {
      result = await client.test(input);
    } else {
      // Diagnostic-capturing probe. redirect:"manual" means an auth-gate 307
      // shows up as an opaque redirect instead of being silently followed to the
      // HTML /login page (which returns 200-not-JSON and masquerades as a
      // generic failure).
      const url = "/api/model-connections/test";
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
          redirect: "manual",
        });
        if (r.type === "opaqueredirect" || r.status === 0) {
          setDiag(`POST ${url}\n→ redirected (auth gate). Your session cookie wasn't accepted for the API call.\nFix: sign out and back in, then retry.`);
          result = { status: "failed", reason: "auth redirect — session not recognized for the API call" };
        } else {
          const bodyText = await r.text();
          setDiag(`POST ${url}\n→ HTTP ${r.status}\n${bodyText.slice(0, 600)}`);
          // eslint-disable-next-line no-console
          console.info("[ollama-test]", { url, status: r.status, body: bodyText });
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(bodyText) as Record<string, unknown>;
          } catch {
            /* non-JSON body (e.g. an HTML error page) — leave parsed empty */
          }
          if (r.status === 200 && parsed.ok === true) {
            result = { status: "connected", model: typeof parsed.model === "string" ? parsed.model : model };
          } else if (r.status === 401 || r.status === 403) {
            result = { status: "unauthorized" };
          } else if (r.status === 404) {
            result = { status: "not_configured" };
          } else if (r.status >= 500) {
            result = { status: "unreachable" };
          } else {
            result = { status: "failed", reason: typeof parsed.error === "string" ? parsed.error : `HTTP ${r.status}` };
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setDiag(`POST ${url}\n→ fetch threw: ${msg}`);
        result = { status: "unreachable" };
      }
    }

    // Persist on success so the selection is saved ONCE and every surface — the
    // sidebar chip and the review/scan path (resolveModelConnectionForReview) —
    // runs on it. A Connect/Reconnect also PROMOTES: if this provider is already
    // saved, recreate the row so it gets a fresh createdAt (newest = active). The
    // probe above already validated the key, so the brief delete→create is safe.
    // router.refresh() re-runs the server layout so the sidebar updates at once.
    if (result.status === "connected") {
      try {
        if (connection) await client.disconnect(connection.id);
        await client.connect(input);
        await reload();
        router.refresh();
      } catch (err) {
        result = {
          status: "failed",
          reason: err instanceof Error ? err.message : "connected, but couldn't save the selection",
        };
      }
    }

    setOutcome(result);
    setTesting(false);
  }

  // Set active: make this saved connection the one reviews run on. Keyless
  // (Ollama) promotes in one click — delete the row + recreate = fresh createdAt
  // = newest. An api-key provider can't be re-POSTed without the key (we never
  // store it), so open the row and let the user re-enter it; Connect then
  // promotes through the same path above.
  async function runSetActive() {
    if (!connection || isActive || switching) return;
    if (isKey) {
      setOpen(true);
      return;
    }
    setSwitching(true);
    setOutcome(null);
    try {
      const input = connectInput();
      await client.disconnect(connection.id);
      await client.connect(input);
      await reload();
      router.refresh();
    } catch (err) {
      setOutcome({ status: "failed", reason: err instanceof Error ? err.message : "couldn't switch the active model" });
      await reload();
    } finally {
      setSwitching(false);
    }
  }

  // Disconnect: delete the persisted connection by id and return the row to its
  // not-connected state. router.refresh() re-runs the server layout so the
  // sidebar chip drops the model at once.
  async function runDisconnect() {
    if (!connection) return;
    setDisconnecting(true);
    try {
      await client.disconnect(connection.id);
      setOutcome(null);
      setDiag(null);
      await reload();
      router.refresh();
    } catch (err) {
      setOutcome({
        status: "failed",
        reason: err instanceof Error ? err.message : "couldn't disconnect",
      });
    } finally {
      setDisconnecting(false);
    }
  }

  const msg = outcome ? outcomeMessage(provider, outcome) : null;
  const badge = connectionBadge({ hasConnection: !!connection, isActive, freeDefault: provider.freeDefault });
  const disconnect = disconnectControl(connection?.id ?? null, disconnecting);
  const switchTo = setActiveControl({ hasConnection: !!connection, isActive, switching });
  const RowIcon = PROVIDER_ICONS[provider.id] ?? IconSparkles;
  const panelId = `model-provider-${provider.id}`;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-content-primary/[0.03] group"
      >
        <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-content-primary/5 border border-border-default text-content-secondary shrink-0">
          <RowIcon className="w-5 h-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-content-primary">{provider.name}</span>
            <span className="text-[10px] font-medium text-content-muted border border-border-subtle rounded-full px-1.5 py-0.5">
              AI model
            </span>
            {badge === "active" ? (
              <span
                title="Kuma runs reviews on this model"
                className="inline-flex items-center gap-1 rounded-full border border-accent-success/25 bg-accent-success/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-success"
              >
                <IconCheck className="h-3 w-3" stroke={2.25} aria-hidden />
                Active
              </span>
            ) : badge === "connected" ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border-default bg-content-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-content-secondary">
                Connected
              </span>
            ) : badge === "free-default" ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent-primary/25 bg-accent-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-primary">
                <IconBolt className="h-3 w-3" aria-hidden />
                Free default
              </span>
            ) : null}
          </div>
          <p className="text-xs text-content-muted mt-0.5 truncate">{provider.tagline}</p>
        </div>

        <IconChevronRight
          className={`w-4 h-4 text-content-muted shrink-0 transition-transform ${
            open ? "rotate-90" : "group-hover:translate-x-0.5"
          }`}
        />
      </button>

      {/* connect: credential + model select + Test. Kept in the DOM when
          collapsed (hidden) so server rendering carries the full form. */}
      <div id={panelId} hidden={!open} className="px-5 pb-4 pl-[4.75rem]">
        <p className="text-[11px] leading-relaxed text-content-muted">{provider.note}</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[11px] font-medium text-content-secondary">
            <span className="flex items-center justify-between gap-2">
              {provider.authLabel}
              <a
                href={provider.setupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-normal text-accent-primary hover:underline"
              >
                {provider.setupLabel}
                <IconExternalLink size={11} aria-hidden />
              </a>
            </span>
            <input
              type={isKey ? "password" : "text"}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={provider.authPlaceholder}
              spellCheck={false}
              autoComplete="off"
              className="rounded-lg border border-border-default bg-surface-2/40 px-2.5 py-1.5 font-mono text-[12px] text-content-primary placeholder:text-content-muted/60 focus:border-accent-primary/50 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-content-secondary">
            Model
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-lg border border-border-default bg-surface-2/40 px-2.5 py-1.5 font-mono text-[12px] text-content-primary focus:border-accent-primary/50 focus:outline-none"
            >
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {provider.customModelAllowed && (
              <span className="text-[10px] text-content-muted/80">Any {provider.name} model id is accepted.</span>
            )}
          </label>
        </div>
        {/* Keyed provider that's connected but idle: switching needs the key we
            never stored, so prompt for it — Connect then promotes it to active. */}
        {connection && !isActive && isKey && (
          <p className="mt-2 text-[10px] leading-relaxed text-accent-primary/90">
            Re-enter your key and Connect to make this the active model.
          </p>
        )}
        {provider.id === "ollama" && detect && (
          <p className="mt-2 text-[10px] leading-relaxed text-content-muted/80">
            {detect.running && detect.models.includes(model)
              ? "Detected Ollama — Base URL and models auto-filled."
              : detect.running
                ? "Ollama is running — click Test to pull the selected model and connect (no terminal needed)."
                : "Ollama not detected — install it, keep it running, then reopen this page."}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={runTest} disabled={!canTest} className="h-8 rounded-lg text-[12px]">
            {testing ? <IconLoader2 size={13} className="motion-safe:animate-spin" aria-hidden /> : null}
            {pulling ? (pullStatus ?? "Pulling…") : testing ? "Connecting…" : connection ? "Reconnect" : "Connect"}
          </Button>
          {switchTo.show && (
            <Button
              size="sm"
              variant="ghost"
              onClick={runSetActive}
              disabled={switchTo.disabled}
              className="h-8 rounded-lg text-[12px]"
            >
              {switching ? <IconLoader2 size={13} className="motion-safe:animate-spin" aria-hidden /> : null}
              {switchTo.label}
            </Button>
          )}
          {disconnect.show && !confirmingDisconnect && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmingDisconnect(true)}
              disabled={disconnect.disabled}
              className="h-8 rounded-lg text-[12px]"
            >
              Disconnect
            </Button>
          )}
          {disconnect.show && confirmingDisconnect && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmingDisconnect(false)}
              disabled={disconnecting}
              className="h-8 rounded-lg text-[12px]"
            >
              Cancel
            </Button>
          )}
          {disconnect.show && confirmingDisconnect && (
            <Button
              size="sm"
              onClick={() => {
                setConfirmingDisconnect(false);
                void runDisconnect();
              }}
              disabled={disconnecting}
              className="h-8 rounded-lg bg-accent-danger text-[12px] text-white hover:bg-accent-danger/90"
            >
              {disconnecting ? <IconLoader2 size={13} className="motion-safe:animate-spin" aria-hidden /> : null}
              {isKey ? "Remove key" : "Remove"}
            </Button>
          )}
          {msg && (
            <span
              className={`inline-flex items-center gap-1 text-[11px] ${
                msg.tone === "ok" ? "text-accent-success" : msg.tone === "warn" ? "text-accent-warning" : "text-accent-danger"
              }`}
            >
              {msg.tone === "ok" ? <IconCheck size={12} aria-hidden /> : <IconAlertTriangle size={12} aria-hidden />}
              {msg.text}
            </span>
          )}
        </div>
        {confirmingDisconnect && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-accent-warning">
            <IconAlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
            {isKey
              ? "This permanently deletes the saved API key. Your provider won't show it again — you'll need to paste a new key to reconnect. To just switch models, connect a different one instead (no need to disconnect)."
              : "This removes the saved connection. To switch models, connect a different one instead."}
          </p>
        )}
        {diag && (
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border-subtle bg-surface-2/40 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-content-muted">
            {diag}
          </pre>
        )}
      </div>
    </div>
  );
}
