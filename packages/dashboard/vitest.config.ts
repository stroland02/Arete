import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*": ["./src/*"] — Next's build resolves it
    // via that tsconfig mapping, but vitest needs it declared separately.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    passWithNoTests: true,
    exclude: ['**/node_modules/**', '**/.next/**'],
    server: {
      // next-auth's ESM build does extension-less `from "next/server"`
      // imports; Next itself has no `exports` map, so Vite/vite-node's
      // strict ESM resolver can't find it when treated as an external
      // Node module. Inlining forces both through Vite's own resolver,
      // which (like webpack/Next's bundler) tolerates the missing
      // extension.
      deps: { inline: ['next-auth', 'next', '@auth/core'] },
    },
  },
});
