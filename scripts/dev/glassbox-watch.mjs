#!/usr/bin/env node
/**
 * Glass Box sidecar — the dev-only live cockpit backend.
 * Design: docs/superpowers/specs/2026-07-15-glass-box-cockpit-design.md §3, §9.
 *
 * ONE dev-only Node process that:
 *   1) PRODUCES events — polls git (commits / branch moves) and, best-effort,
 *      bridges BullMQ queue lifecycle events (review-pr / approval-exec).
 *   2) SERVES them as SSE at http://localhost:4517/glassbox/stream (CORS-open to
 *      the dashboard origin), replaying a ring buffer on connect.
 *
 * Why a sidecar instead of a Next.js route (documented deviation from the design
 * doc §3.4): reading Redis/BullMQ and shelling to git from inside the Next
 * dashboard would add runtime deps + lockfile churn for a dev-only feature. All
 * infra-touching code lives here; the dashboard stays purely presentational and
 * just opens an EventSource. Zero new dashboard dependencies.
 *
 * Uses ONLY Node builtins for the load-bearing path (git watch + SSE). The
 * BullMQ bridge is a best-effort dynamic import that degrades to a logged notice
 * if bullmq/ioredis aren't resolvable from here — the git live-monitor still
 * works. Run with: pnpm dev:glassbox
 */
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Best-effort load the repo-root .env so REDIS_URL/GLASSBOX_REDIS_URL are
// available to the queue bridge when launched directly (Node 20.6+/24).
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  /* no .env — git monitor still works; queue bridge just stays off */
}

const execFileP = promisify(execFile);
const PORT = Number(process.env.GLASSBOX_PORT ?? 4517);
const ORIGIN = process.env.GLASSBOX_ALLOW_ORIGIN ?? "http://localhost:3000";
const POLL_MS = Number(process.env.GLASSBOX_POLL_MS ?? 1500);
const RING_MAX = 500;

// ---- event spine (in-memory ring buffer + subscriber fan-out) --------------
let seq = 0;
const ring = [];
const clients = new Set();

function emit(source, kind, title, opts = {}) {
  const event = {
    id: String(++seq),
    at: new Date().toISOString(),
    source,
    kind,
    title,
    detail: opts.detail,
    refs: opts.refs,
    severity: opts.severity,
  };
  ring.push(event);
  if (ring.length > RING_MAX) ring.shift();
  const frame = `id: ${event.id}\nevent: gbx\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(frame);
  console.log(`[glassbox] ${kind}: ${title}`);
}

// ---- git producer (Node builtins only; robust on Windows) ------------------
async function git(args) {
  const { stdout } = await execFileP("git", args, { cwd: process.cwd() });
  return stdout.trim();
}

let lastSha = null;
let lastBranch = null;

async function pollGit() {
  try {
    const [sha, branch] = await Promise.all([
      git(["rev-parse", "HEAD"]),
      git(["rev-parse", "--abbrev-ref", "HEAD"]),
    ]);
    if (lastSha === null) {
      lastSha = sha;
      lastBranch = branch;
      return; // first tick just establishes baseline (hello already sent)
    }
    if (branch !== lastBranch) {
      emit("git", "git.branch_updated", `Checked out ${branch}`, { refs: { branch, sha } });
      lastBranch = branch;
    }
    if (sha !== lastSha) {
      let subject = "";
      let files = [];
      try {
        subject = await git(["log", "-1", "--format=%s", sha]);
        const nameOnly = await git(["diff", "--name-only", `${lastSha}..${sha}`]);
        files = nameOnly ? nameOnly.split("\n").filter(Boolean) : [];
      } catch {
        /* best-effort enrichment */
      }
      emit("git", "git.commit", subject || "New commit", {
        detail: subject,
        refs: { branch, sha, files },
      });
      lastSha = sha;
    }
  } catch (err) {
    // transient (e.g. mid-rebase) — don't crash the sidecar
    if (process.env.GLASSBOX_DEBUG) console.error("[glassbox] git poll error", err?.message);
  }
}

// ---- best-effort BullMQ bridge (optional) ----------------------------------
async function startQueueBridge() {
  const url = process.env.GLASSBOX_REDIS_URL ?? process.env.REDIS_URL;
  if (!url) {
    console.log("[glassbox] no REDIS_URL — queue bridge disabled (git monitor still live).");
    return;
  }
  let QueueEvents;
  try {
    ({ QueueEvents } = await import("bullmq"));
  } catch {
    console.log("[glassbox] bullmq not resolvable here — queue bridge skipped. Run via a context where it resolves to enable queue.* events.");
    return;
  }
  const connection = { url };
  for (const queue of ["review-pr", "approval-exec"]) {
    try {
      const qe = new QueueEvents(queue, { connection });
      const label = queue === "review-pr" ? "review" : "approval";
      qe.on("active", ({ jobId }) =>
        emit("queue", `queue.${label}.active`, `${queue} job active`, { refs: { queue, jobId } }));
      qe.on("completed", ({ jobId }) =>
        emit("queue", `queue.${label}.completed`, `${queue} job completed`, { refs: { queue, jobId }, severity: "success" }));
      qe.on("failed", ({ jobId, failedReason }) =>
        emit("queue", `queue.${label}.failed`, `${queue} job failed`, { detail: failedReason, refs: { queue, jobId }, severity: "error" }));
      qe.on("error", () => {}); // ignore transient redis blips
    } catch (err) {
      console.log(`[glassbox] queue bridge for ${queue} not started: ${err?.message}`);
    }
  }
  console.log("[glassbox] queue bridge live on review-pr + approval-exec.");
}

// ---- SSE server ------------------------------------------------------------
const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/glassbox/stream") {
    res.writeHead(404, corsHeaders());
    res.end("not found");
    return;
  }
  res.writeHead(200, {
    ...corsHeaders(),
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  // replay ring from Last-Event-ID (resume) or from the start
  const lastId = Number(req.headers["last-event-id"] ?? url.searchParams.get("lastEventId") ?? 0);
  for (const e of ring) {
    if (e.id && Number(e.id) > lastId) {
      res.write(`id: ${e.id}\nevent: gbx\ndata: ${JSON.stringify(e)}\n\n`);
    }
  }
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  clients.add(res);
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Headers": "Last-Event-ID",
  };
}

// ---- boot ------------------------------------------------------------------
async function main() {
  let branch = "?";
  let sha = "";
  try {
    branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    sha = await git(["rev-parse", "HEAD"]);
    lastBranch = branch;
    lastSha = sha;
  } catch {
    /* not a git repo? still serve */
  }
  server.listen(PORT, () => {
    console.log(`[glassbox] SSE live at http://localhost:${PORT}/glassbox/stream (CORS ${ORIGIN})`);
    // provenance hello — which checkout/sha is actually being served
    emit("system", "system.hello", `serving ${branch}`, {
      refs: { branch, sha, repoRoot: process.cwd() },
    });
  });
  setInterval(pollGit, POLL_MS);
  await startQueueBridge();
}

main().catch((err) => {
  console.error("[glassbox] fatal", err);
  process.exit(1);
});
