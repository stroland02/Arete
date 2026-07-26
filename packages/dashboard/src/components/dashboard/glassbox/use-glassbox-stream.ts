"use client";

/**
 * useGlassBoxStream — subscribe to the Glass Box live event feed over SSE.
 * Design: docs/superpowers/specs/2026-07-15-glass-box-cockpit-design.md §4.2.
 *
 * Mirrors the proven useSynthStream pattern (thin EventSource adapter). The SSE
 * endpoint is served by the dev-only Glass Box sidecar (scripts/dev/glassbox-watch.mjs),
 * NOT a Next route — so the dashboard needs no Redis/BullMQ dependency (design
 * deviation, doc §9). If the sidecar isn't running, `connected` stays false and
 * the dock shows an honest "offline" state — never fabricated activity.
 *
 * Returns the last N narration items (ring buffer), the connection state, the
 * latest system.hello provenance, and a monotonically-increasing `landingTick`
 * that bumps on every git.* event so the dock can trigger router.refresh().
 */

import { useEffect, useRef, useState } from "react";
import type { GlassBoxEvent } from "@/lib/glassbox/types";
import { narrate, type NarrationItem } from "@/lib/glassbox/narrate";

const MAX_ITEMS = 200;

export interface GlassBoxStreamView {
  items: NarrationItem[];
  connected: boolean;
  hello: GlassBoxEvent | null;
  /** Bumps whenever a git.* event arrives — the live-monitor refresh trigger. */
  landingTick: number;
}

export function useGlassBoxStream(url: string | null): GlassBoxStreamView {
  const [items, setItems] = useState<NarrationItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [hello, setHello] = useState<GlassBoxEvent | null>(null);
  const [landingTick, setLandingTick] = useState(0);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!url) return;
    seen.current = new Set();
    const source = new EventSource(url);

    source.onopen = () => setConnected(true);

    source.addEventListener("gbx", (e) => {
      let event: GlassBoxEvent;
      try {
        event = JSON.parse((e as MessageEvent).data) as GlassBoxEvent;
      } catch {
        return; // ignore malformed frames rather than crash the feed
      }
      if (seen.current.has(event.id)) return; // idempotent on replay/reconnect
      seen.current.add(event.id);

      if (event.kind === "system.hello") setHello(event);
      if (event.source === "git") setLandingTick((t) => t + 1);

      setItems((prev) => {
        const next = [...prev, narrate(event)];
        return next.length > MAX_ITEMS ? next.slice(next.length - MAX_ITEMS) : next;
      });
    });

    source.onerror = () => {
      // EventSource auto-reconnects; reflect the drop so the dock can show it.
      setConnected(false);
    };

    return () => {
      source.close();
      setConnected(false);
    };
  }, [url]);

  return { items, connected, hello, landingTick };
}
