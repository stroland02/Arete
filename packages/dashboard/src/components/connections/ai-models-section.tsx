"use client";

import { useEffect, useState } from "react";
import { IconAlertTriangle, IconBolt, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { MODEL_PROVIDERS, type ModelProviderDef } from "@/lib/model-catalog";
import {
  HttpModelConnectionsClient,
  type ModelConnectionsClient,
  type ModelTestOutcome,
} from "@/lib/model-connections-client";

/**
 * The "AI Models" Connections section. Provider cards for the models a tenant can
 * run reviews on; each card carries the connect → model-select → Test → Connected
 * flow, mirroring the telemetry connector-card pattern.
 *
 * SEAM-FIRST: Test/connect go through ModelConnectionsClient (Eng1's
 * /api/model-connections). Until that route lands, `test` returns `not_configured`
 * and the card says so — it never fabricates a "Connected" state.
 *
 * HONESTY: Ollama is badged the free default but never "infinite"; a non-Anthropic
 * provider states that verification runs on the connected model.
 */
const defaultClient: ModelConnectionsClient = new HttpModelConnectionsClient();

export function AiModelsSection({ client = defaultClient }: { client?: ModelConnectionsClient }) {
  return (
    <section aria-label="AI Models" className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-content-primary">AI Models</h2>
        <p className="text-xs text-content-muted">
          Choose the model Kuma runs reviews on. Local · Ollama is the free default; connect a hosted
          provider with your own key to run on it instead.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {MODEL_PROVIDERS.map((provider) => (
          <ModelProviderCard key={provider.id} provider={provider} client={client} />
        ))}
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

function ModelProviderCard({ provider, client }: { provider: ModelProviderDef; client: ModelConnectionsClient }) {
  const isKey = provider.authKind === "api-key";
  const [secret, setSecret] = useState("");
  const [model, setModel] = useState(provider.models[0]);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<ModelTestOutcome | null>(null);
  // Auto-detect a running local Ollama: prefill the Base URL and offer the
  // user's actually-pulled models. null = not yet probed. Ollama card only.
  const [detect, setDetect] = useState<{ running: boolean; models: string[] } | null>(null);

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

  // Real pulled models take precedence, then the catalog's suggestions.
  const modelOptions =
    detect && detect.models.length > 0
      ? Array.from(new Set([...detect.models, ...provider.models]))
      : provider.models;

  const connected = outcome?.status === "connected";
  // api-key providers need a key; Ollama can fall back to its default base URL.
  const canTest = !testing && (!isKey || secret.trim().length > 0);

  async function runTest() {
    setTesting(true);
    setOutcome(null);
    const input = {
      provider: provider.id,
      model,
      ...(isKey ? { apiKey: secret } : { baseUrl: secret.trim() || provider.authPlaceholder }),
    };
    setOutcome(await client.test(input));
    setTesting(false);
  }

  const msg = outcome ? outcomeMessage(provider, outcome) : null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border-default bg-surface-1 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-content-primary">{provider.name}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-content-secondary">{provider.tagline}</p>
        </div>
        {connected ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent-success/30 bg-accent-success/10 px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-accent-success">
            <IconCheck size={11} aria-hidden />
            Connected
          </span>
        ) : provider.freeDefault ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent-primary/30 bg-accent-primary/10 px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-accent-primary">
            <IconBolt size={11} aria-hidden />
            Free default
          </span>
        ) : null}
      </div>

      <p className="text-[11px] leading-relaxed text-content-muted">{provider.note}</p>

      {/* connect: credential + model select */}
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-[11px] font-medium text-content-secondary">
          {provider.authLabel}
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

      {provider.id === "ollama" && detect && (
        <p className="text-[10px] leading-relaxed text-content-muted/80">
          {detect.running && detect.models.length > 0
            ? "Detected Ollama — Base URL and models auto-filled."
            : detect.running
              ? "Ollama is running but no models are pulled yet — run: ollama pull qwen2.5-coder"
              : "Ollama not detected — install it, run `ollama pull qwen2.5-coder`, keep it running, then reopen this page."}
        </p>
      )}

      <div className="mt-auto flex items-center gap-2">
        <Button size="sm" onClick={runTest} disabled={!canTest} className="h-8 rounded-lg text-[12px]">
          {testing ? <IconLoader2 size={13} className="motion-safe:animate-spin" aria-hidden /> : null}
          {testing ? "Testing…" : "Test"}
        </Button>
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
    </div>
  );
}
