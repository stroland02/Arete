"use client";

import { useEffect, useState } from "react";
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
  type ModelConnectionsClient,
  type ModelTestOutcome,
} from "@/lib/model-connections-client";

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
  return (
    <section aria-label="AI Models" className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-content-primary">AI Models</h2>
        <p className="text-xs text-content-muted">
          Choose the model Kuma runs reviews on. Local · Ollama is the free default; connect a hosted
          provider with your own key to run on it instead.
        </p>
      </div>
      <div className="glass-panel divide-y divide-border-subtle overflow-hidden">
        {MODEL_PROVIDERS.map((provider) => (
          <ModelProviderRow key={provider.id} provider={provider} client={client} />
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

function ModelProviderRow({ provider, client }: { provider: ModelProviderDef; client: ModelConnectionsClient }) {
  const isKey = provider.authKind === "api-key";
  const [open, setOpen] = useState(false);
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
            {connected ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent-success/25 bg-accent-success/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-success">
                <IconCheck className="h-3 w-3" stroke={2.25} aria-hidden />
                Connected
              </span>
            ) : provider.freeDefault ? (
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
        {provider.id === "ollama" && detect && (
          <p className="mt-2 text-[10px] leading-relaxed text-content-muted/80">
            {detect.running && detect.models.length > 0
              ? "Detected Ollama — Base URL and models auto-filled."
              : detect.running
                ? "Ollama is running but no models are pulled yet — run: ollama pull qwen2.5-coder"
                : "Ollama not detected — install it, run `ollama pull qwen2.5-coder`, keep it running, then reopen this page."}
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
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
    </div>
  );
}
