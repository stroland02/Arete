#!/usr/bin/env node
/**
 * dev-all — one command to bring up the local dogfooding stack.
 * Design: docs/superpowers/specs/2026-07-15-glass-box-cockpit-design.md §6, §10.
 *
 * This is the reusable BOOTSTRAP that the future "Live Preview" service (design
 * §10) productizes. Flow, fully automatic — no manual steps:
 *   1. ensure Docker daemon (auto-start Docker Desktop on Windows if down)
 *   2. infra:up (postgres/redis/clickhouse) + wait for postgres healthy
 *   3. sync DB schema (prisma db push — see migration-defect note in §6)
 *   4. run dashboard dev server + Glass Box sidecar (prefixed logs)
 *   5. auto-open http://localhost:3000
 *
 * Node builtins only. Ctrl-C tears down the child dev processes (not infra).
 */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";

const execFileP = promisify(execFile);
const ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const COMPOSE = ["compose", "-f", "infra/docker-compose.yml"];

async function dockerUp() {
  try {
    await execFileP("docker", ["info"]);
    return true;
  } catch {
    return false;
  }
}

async function ensureDocker() {
  if (await dockerUp()) return log("docker", "daemon already running");
  if (os.platform() !== "win32") {
    throw new Error("Docker daemon not running — start it and re-run (auto-start only implemented for Windows).");
  }
  log("docker", "daemon down — launching Docker Desktop…");
  const exe = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";
  spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 120; i++) {
    if (await dockerUp()) return log("docker", `ready after ${i * 2}s`);
    await sleep(2000);
  }
  throw new Error("Docker Desktop did not become ready in time.");
}

async function run(cmd, args, opts = {}) {
  // shell:true so Windows resolves the pnpm.cmd shim — execFile cannot launch a
  // .cmd without a shell (it throws ENOENT). Harmless for docker.exe elsewhere.
  await execFileP(cmd, args, { cwd: ROOT, shell: true, ...opts });
}

async function waitPostgres() {
  for (let i = 0; i < 60; i++) {
    try {
      const { stdout } = await execFileP("docker", [...COMPOSE, "ps", "-q", "postgres"], { cwd: ROOT });
      const id = stdout.trim();
      if (id) {
        const { stdout: h } = await execFileP("docker", ["inspect", "--format", "{{.State.Health.Status}}", id]);
        if (h.trim() === "healthy") return log("infra", "postgres healthy");
      }
    } catch { /* keep polling */ }
    await sleep(2000);
  }
  log("infra", "postgres health not confirmed — continuing anyway");
}

function log(tag, msg) {
  console.log(`\x1b[36m[${tag}]\x1b[0m ${msg}`);
}

function spawnPrefixed(tag, cmd, args) {
  const child = spawn(cmd, args, { cwd: ROOT, shell: true });
  const pipe = (stream) =>
    stream.on("data", (d) =>
      d.toString().split("\n").filter(Boolean).forEach((l) => console.log(`\x1b[35m[${tag}]\x1b[0m ${l}`)));
  pipe(child.stdout);
  pipe(child.stderr);
  return child;
}

async function openBrowser(url) {
  const cmd = os.platform() === "win32" ? ["cmd", ["/c", "start", "", url]]
    : os.platform() === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  try { spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref(); } catch { /* non-fatal */ }
}

async function main() {
  await ensureDocker();
  // Alertmanager's compose secret requires ALERTMANAGER_INGEST_TOKEN; without it
  // `docker compose up` aborts the whole stack. Default a dev-only value when
  // unset so `pnpm dev:all` works out of the box — a real deployment supplies
  // its own. This is never a production secret.
  if (!process.env.ALERTMANAGER_INGEST_TOKEN) {
    process.env.ALERTMANAGER_INGEST_TOKEN = "dev-local-alertmanager-token-not-prod";
    log("infra", "ALERTMANAGER_INGEST_TOKEN unset — using a dev-only default (not for production)");
  }
  log("infra", "bringing up postgres/redis/clickhouse…");
  await run("docker", [...COMPOSE, "up", "-d"]);
  await waitPostgres();
  log("db", "syncing schema (prisma db push)…");
  // NOTE: `migrate deploy` is preferred but currently blocked by a missing
  // create-migration for ApprovalPrompt/AgentMemory on integration (see §6).
  // db push syncs the DB to schema.prisma reliably until that's fixed.
  await run("pnpm", ["--filter", "@arete/db", "exec", "prisma", "db", "push", "--accept-data-loss"]);

  log("run", "starting dashboard + Glass Box sidecar…");
  const dash = spawnPrefixed("dashboard", "pnpm", ["--filter", "@arete/dashboard", "dev"]);
  const glass = spawnPrefixed("glassbox", "node", ["scripts/dev/glassbox-watch.mjs"]);

  await sleep(4000);
  await openBrowser("http://localhost:3000");
  log("run", "stack up → http://localhost:3000  (Ctrl-C to stop dev servers)");

  const stop = () => { dash.kill(); glass.kill(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(`\x1b[31m[dev-all] ${err.message}\x1b[0m`);
  process.exit(1);
});
