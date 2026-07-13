"use client";

import { useActionState } from "react";
import { connectStripeApiKey, type ConnectApiKeyState } from "@/app/(dashboard)/connections/[id]/actions";

const INITIAL_STATE: ConnectApiKeyState = {};

export function StripeConnectForm({ installationId }: { installationId: string }) {
  const [state, formAction, pending] = useActionState(connectStripeApiKey, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="installationId" value={installationId} />
      <label htmlFor="secretKey" className="text-xs font-medium text-content-secondary">
        Stripe restricted API key
      </label>
      <input
        id="secretKey"
        name="secretKey"
        type="password"
        autoComplete="off"
        placeholder="rk_live_..."
        required
        className="rounded-xl border border-border-default bg-content-primary/[0.02] px-4 py-2.5 text-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
      />
      {state.error && <p className="text-xs text-accent-danger">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-accent-primary hover:bg-accent-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors self-end"
      >
        {pending ? "Connecting…" : "Connect Stripe account"}
      </button>
    </form>
  );
}
