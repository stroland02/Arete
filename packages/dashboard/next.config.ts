import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for a minimal production Docker image (packages/dashboard/Dockerfile):
  // emits a self-contained .next/standalone/ with only the files needed to
  // run `node server.js`, instead of requiring the full node_modules tree.
  output: "standalone",
};

export default nextConfig;
