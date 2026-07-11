# syntax=docker/dockerfile:1
#
# Areté dashboard (Next.js 16, packages/dashboard).
#
# This package depends on the shared @arete/db workspace package, so the
# build context MUST be the monorepo root, not packages/dashboard/ in
# isolation:
#
#   docker build -f packages/dashboard/Dockerfile \
#     --network <network-with-a-reachable-migrated-postgres> \
#     --build-arg DATABASE_URL=postgresql://user:pass@host:5432/db \
#     -t arete-dashboard .
#
# `next build` prerenders the dashboard's overview page against the database
# (see packages/db/README.md) so, like the "test-dashboard" CI job, the build
# stage needs a reachable Postgres with migrations already applied — pass its
# connection string via the DATABASE_URL build arg and make sure the build
# has network access to it (e.g. `--network` pointing at the Postgres
# container's docker network). See docker-compose.prod.yml at the repo root
# for a worked example that runs migrations before building this image.
#
# next.config.ts sets `output: "standalone"` so the final image only needs
# .next/standalone + .next/static + public — not the full node_modules tree.

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# --- build: install workspace deps, generate Prisma client, build Next ---
FROM base AS build
WORKDIR /app

COPY . .

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

RUN pnpm --filter @arete/db build

ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}
RUN pnpm --filter @arete/dashboard build

# --- final: minimal runtime image, plain node, non-root user ---
FROM node:22-slim AS final

RUN groupadd --system arete && useradd --system --gid arete --create-home arete

WORKDIR /app

COPY --from=build /app/packages/dashboard/public ./public
COPY --from=build /app/packages/dashboard/.next/standalone ./
COPY --from=build /app/packages/dashboard/.next/static ./packages/dashboard/.next/static

ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0
USER arete

EXPOSE 3001

CMD ["node", "packages/dashboard/server.js"]
