/**
 * ContainerStore — the read/subscribe interface the SSE route depends on.
 * See docs/superpowers/specs/2026-07-13-synthesizer-component-and-critic.md §5.2.
 *
 * The interface is tenancy-scoped (`installationId` on every read) so it maps
 * cleanly onto @arete/db later (pipeline spec §6.1, single-owner schema). The
 * in-memory implementation here is the "sample producer": it serves the sample
 * fixtures and streams a container's transcript — instantly for finished
 * containers, paced for a working one so the SSE path exercises real streaming.
 */

import type { IssueContainer, SynthStep } from "./types";
import { SAMPLE_CONTAINERS } from "./sample-containers";

export interface ContainerStore {
  /** Read one container, scoped to the tenant. Null if absent OR not this tenant. */
  get(installationId: string, id: string): Promise<IssueContainer | null>;
  /**
   * Stream a container's transcript steps in order, then signal completion.
   * Returns an unsubscribe that cancels any pending emission.
   */
  subscribe(id: string, onStep: (s: SynthStep) => void, onDone: () => void): () => void;
}

/** Container states past the live pipeline — their transcript is history, streamed instantly. */
const TERMINAL_STATES = new Set([
  "ready",
  "solution_approved",
  "posted",
  "changes_requested",
  "merged",
  "dismissed",
  "fix_failed",
]);

export class InMemoryContainerStore implements ContainerStore {
  private readonly byId: Map<string, IssueContainer>;
  /** ms between streamed steps for a working container (0 = instant). */
  private readonly stepDelayMs: number;

  constructor(containers: IssueContainer[], stepDelayMs = 450) {
    this.byId = new Map(containers.map((c) => [c.id, c]));
    this.stepDelayMs = stepDelayMs;
  }

  async get(installationId: string, id: string): Promise<IssueContainer | null> {
    const c = this.byId.get(id);
    if (!c || c.installationId !== installationId) return null; // tenancy scope
    return c;
  }

  subscribe(id: string, onStep: (s: SynthStep) => void, onDone: () => void): () => void {
    const c = this.byId.get(id);
    if (!c) {
      onDone();
      return () => {};
    }

    // Finished containers replay history instantly; a working one is paced so
    // the console animates as steps arrive (spec §4, live-only).
    const live = !TERMINAL_STATES.has(c.state);
    const delay = live ? this.stepDelayMs : 0;
    const steps = c.transcript;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let i = 0;
    let cancelled = false;

    const emitNext = () => {
      if (cancelled) return;
      if (i >= steps.length) {
        onDone();
        return;
      }
      onStep(steps[i++]);
      if (delay === 0) emitNext();
      else timers.push(setTimeout(emitNext, delay));
    };

    if (delay === 0) emitNext();
    else timers.push(setTimeout(emitNext, delay));

    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
    };
  }
}

/** Process-wide sample store — the source behind the SSE route until @arete/db lands. */
export const sampleContainerStore = new InMemoryContainerStore(SAMPLE_CONTAINERS);
