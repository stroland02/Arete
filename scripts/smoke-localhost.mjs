#!/usr/bin/env node
/**
 * Smoke-check the local dev servers, and say WHICH CHECKOUT each one serves.
 *
 * Four agents run four worktrees, and each `next dev` serves the files on
 * *its own* disk. A change you just pushed to main is invisible on a port
 * whose worktree is on another branch — no amount of refreshing helps. That
 * confusion cost real time, so this reports branch and commit per port before
 * it reports anything else.
 *
 * Honest by construction: it reports what it observed. A page behind a login
 * is recorded as "auth wall (expected)", never as a pass, because a 200 from
 * the sign-in page proves the server is up and proves nothing about the page
 * you asked for.
 *
 *   node scripts/smoke-localhost.mjs            # scan the usual ports
 *   node scripts/smoke-localhost.mjs 3000 3009  # scan specific ports
 */

import { execSync } from "node:child_process";

const PORTS = process.argv.slice(2).length
  ? process.argv.slice(2).map(Number)
  : [3000, 3001, 3002, 3005, 3009];

/** Paths a dev server may be served from, discovered via the process list. */
function servingWorktrees() {
  const found = new Map(); // port -> directory
  try {
    const ps =
      process.platform === "win32"
        ? execSync(
            'powershell -NoProfile -Command "Get-CimInstance Win32_Process | ' +
              "Where-Object { $_.CommandLine -match 'next' } | " +
              'Select-Object -ExpandProperty CommandLine"',
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
          )
        : execSync("ps -eo args | grep -i 'next dev' | grep -v grep", {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          });
    for (const line of ps.split(/\r?\n/)) {
      const dir = line.match(/([A-Za-z]:\\[^"]*?|\/[^"\s]*?)[\\/]packages[\\/]dashboard/);
      const port = line.match(/-p\s+(\d+)/);
      if (dir) found.set(port ? Number(port[1]) : "default", dir[1]);
    }
  } catch {
    /* process listing is best-effort; the HTTP checks still run */
  }
  return found;
}

function gitFacts(dir) {
  try {
    const at = (cmd) =>
      execSync(`git -C "${dir}" ${cmd}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    return { branch: at("branch --show-current"), head: at("log --oneline -1") };
  } catch {
    return null;
  }
}

async function probe(port, path) {
  const url = `http://localhost:${port}${path}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: "follow" });
    const body = await res.text();
    const ms = Date.now() - started;
    // A login page answering 200 is not the page we asked for. Say so.
    const authWalled = /sign in|<title>[^<]*login|name="password"/i.test(body);
    return {
      ok: res.ok,
      status: res.status,
      ms,
      authWalled,
      bytes: body.length,
      poweredBy: res.headers.get("x-powered-by") ?? "",
    };
  } catch (err) {
    return { down: true, reason: err.cause?.code ?? err.message };
  }
}

/**
 * Which service is listening on this port.
 *
 * Worth the extra request. An earlier version assumed every port was the
 * dashboard and reported the webhook service as "404 on everything" — which
 * read as a broken lane for two runs. It was a healthy webhook answering
 * correctly about paths it has never had. Checking dashboard routes against a
 * non-dashboard is a bug in the checker, not a finding, and a checker that
 * cries wolf is worse than no checker.
 */
async function classify(port) {
  const root = await probe(port, "/");
  if (root.down) return { kind: "down" };
  // Next.js does not send `x-powered-by: Express`; the webhook service does.
  if (/express/i.test(root.poweredBy)) return { kind: "webhook" };
  return { kind: "dashboard" };
}

const PATHS_BY_KIND = {
  dashboard: ["/", "/build-status", "/api/health"],
  webhook: ["/health"],
};

console.log("Localhost smoke check\n");

const worktrees = servingWorktrees();
let anyUp = false;

for (const port of PORTS) {
  const root = await probe(port, "/");
  if (root.down) continue;
  anyUp = true;

  const dir = worktrees.get(port) ?? worktrees.get("default");
  const git = dir ? gitFacts(dir) : null;
  const { kind } = await classify(port);

  console.log(`:${port}  [${kind}]`);
  if (git) {
    console.log(`  serving   ${dir}`);
    console.log(`  branch    ${git.branch || "(detached)"}`);
    console.log(`  head      ${git.head}`);
  } else {
    // Only the dashboard is started from a worktree we can identify; the
    // webhook and agents services are not, so say which it is rather than
    // implying something is wrong.
    console.log(
      kind === "dashboard"
        ? "  serving   unknown checkout — cannot say which branch this is"
        : "  serving   not a dashboard checkout (branch not applicable)"
    );
  }

  for (const path of PATHS_BY_KIND[kind] ?? PATHS_BY_KIND.dashboard) {
    const r = await probe(port, path);
    if (r.down) {
      console.log(`  ${path.padEnd(14)} unreachable (${r.reason})`);
    } else if (r.authWalled) {
      console.log(`  ${path.padEnd(14)} ${r.status} — auth wall (expected; page not verified)`);
    } else {
      console.log(`  ${path.padEnd(14)} ${r.status} ${r.ms}ms ${r.bytes}b`);
    }
  }
  console.log("");
}

if (!anyUp) {
  console.log("No dev server responded on " + PORTS.join(", ") + ".");
  console.log("Start one:  pnpm --filter @arete/dashboard dev");
  process.exit(1);
}

console.log(
  "Note: a page behind the auth wall is reported as such, not as a pass. To verify one,\n" +
    "sign in on that port in a browser — cookies on localhost are shared across ports, so a\n" +
    "session from another port usually carries over when AUTH_SECRET matches."
);
