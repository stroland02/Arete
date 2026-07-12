import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for a minimal production Docker image (packages/dashboard/Dockerfile):
  // emits a self-contained .next/standalone/ with only the files needed to
  // run `node server.js`, instead of requiring the full node_modules tree.
  output: "standalone",
  turbopack: {
    // Pin the workspace root to THIS pnpm workspace (packages/dashboard -> repo
    // root). Without it, Turbopack infers the root by walking up to the first
    // lockfile it finds — which, when this repo is checked out as a git
    // worktree nested inside another checkout (e.g. .worktrees/<branch>/),
    // selects the OUTER checkout and then fails to resolve this workspace's
    // pnpm-symlinked node_modules.
    root: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
