# @backlog/server — Hono local server, packaged for self-hosted use.
# The container reads workspace state from /workspace/.backlog/ — mount your
# Backlog workspace into /workspace via -v "$PWD":/workspace at run time.
# No DB. No auth. The server writes nothing outside the mounted workspace.

FROM node:22-slim AS build

# Build the workspace bundle. We treat the monorepo root as the build context
# so pnpm can resolve `workspace:*` deps and tsup can bundle them.
WORKDIR /build
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/cli/package.json       ./packages/cli/
COPY packages/claims/package.json    ./packages/claims/
COPY packages/connectors/package.json ./packages/connectors/
COPY packages/config/package.json    ./packages/config/
COPY packages/core/package.json      ./packages/core/
COPY packages/git/package.json       ./packages/git/
COPY packages/hooks/package.json     ./packages/hooks/
COPY packages/schemas/package.json   ./packages/schemas/
COPY packages/server/package.json    ./packages/server/
RUN pnpm install --frozen-lockfile --ignore-scripts

# Bring source in for the deps the server actually compiles against.
COPY tsconfig.json ./
COPY packages/schemas ./packages/schemas
COPY packages/git     ./packages/git
COPY packages/config  ./packages/config
COPY packages/claims  ./packages/claims
COPY packages/core    ./packages/core
COPY packages/server  ./packages/server
RUN pnpm --filter "@backlog/server..." run build

# Self-contained, symlink-free node_modules tree for the runtime image.
RUN pnpm deploy --legacy --filter @backlog/server --prod /deploy

# ── runtime image ──────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /deploy/dist          ./dist
COPY --from=build /deploy/package.json  ./package.json
COPY --from=build /deploy/node_modules  ./node_modules

ENV NODE_ENV=production
# 0.0.0.0 because the container's loopback isn't reachable from the host;
# rely on Docker's `-p` mapping (and your host firewall) for access control.
ENV HOST=0.0.0.0
ENV PORT=7878
# Workspace mount point — must contain a .backlog/ directory.
ENV BACKLOG_WORKSPACE=/workspace

VOLUME ["/workspace"]
EXPOSE 7878

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/dev-server.js"]
