"use client";

/**
 * useSynthStream — subscribe to a container's transcript over SSE.
 * See docs/superpowers/specs/2026-07-13-synthesizer-component-and-critic.md §5.1.
 *
 * Thin adapter: it opens an EventSource to /api/containers/[id]/stream and feeds
 * every event into the pure `synthStreamReducer`, returning a derived `SynthView`.
 * All ordering/counting/phase logic is in synth-stream-model.ts (tested there).
 *
 * One hook instance streams ONE container. To switch containers, remount via a
 * React `key={containerId}` so the reducer starts fresh — the parent workspace
 * does exactly that.
 */

import { useEffect, useReducer } from "react";
import type { IssueContainer, SynthStep } from "@/lib/issue-pipeline/types";
import {
  synthStreamReducer,
  initialSynthStreamState,
  deriveSynthView,
  type SynthView,
} from "./synth-stream-model";

export function useSynthStream(containerId: string | null): SynthView {
  const [state, dispatch] = useReducer(synthStreamReducer, initialSynthStreamState);

  useEffect(() => {
    if (!containerId) return;
    const source = new EventSource(`/api/containers/${encodeURIComponent(containerId)}/stream`);

    source.addEventListener("init", (e) => {
      dispatch({ type: "init", container: JSON.parse((e as MessageEvent).data) as IssueContainer });
    });
    source.addEventListener("step", (e) => {
      dispatch({ type: "step", step: JSON.parse((e as MessageEvent).data) as SynthStep });
    });
    source.addEventListener("done", () => {
      dispatch({ type: "done" });
      source.close();
    });
    source.onerror = () => {
      // The server closes the stream after `done`; only treat an unexpected drop
      // as an error. EventSource fires onerror on normal close too, so guard.
      if (source.readyState === EventSource.CLOSED) return;
      dispatch({ type: "error", message: "stream disconnected" });
      source.close();
    };

    return () => source.close();
  }, [containerId]);

  return deriveSynthView(state);
}
