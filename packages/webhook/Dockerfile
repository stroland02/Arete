# syntax=docker/dockerfile:1
#
# Areté webhook service (TypeScript/Express, packages/webhook).
#
# This package depends on the shared @arete/db workspace package, so the
# build context MUST be the monorepo root, not packages/webhook/ in
# isolation:
#
#   docker build -f packages/webhook/Dockerfile -t arete-webhook .
#
# Build pipeline: pnpm install (runs @arete/db's `prepare` script, which
# generates the Prisma client) -> tsc build of @arete/webhook (now real ESM,
# see tsconfig.json: module/moduleResolution "nodenext") -> `pnpm deploy` to
# produce a pruned, production-only install containing @arete/webhook plus
# its resolved @arete/db dependency (compiled dist + generated Prisma
# client), with devDependencies (tsx, vitest, typescript, prisma CLI, etc.)
# excluded. The final image runs the compiled dist/index.js with plain
# `node` — no tsx, no ts-node.

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# --- build: install workspace deps, generate Prisma client, compile TS ---
FROM base AS build
WORKDIR /app

COPY . .

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

RUN pnpm --filter @arete/db build
RUN pnpm --filter @arete/webhook build

# Prune to a production-only, self-contained install for just this package
# and its dependency graph (this is what makes the shared workspace package
# work correctly in the final image without hoisting/symlink issues).
RUN pnpm --filter @arete/webhook deploy --prod /prod/webhook

# --- final: minimal runtime image, plain node, non-root user ---
FROM node:22-slim AS final

RUN groupadd --system arete && useradd --system --gid arete --create-home arete

WORKDIR /app
COPY --from=build /prod/webhook /app

ENV NODE_ENV=production
USER arete

EXPOSE 3000

CMD ["node", "dist/index.js"]
