# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f apps/cms/Dockerfile .
ARG NODE_VERSION=24.22.1
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app

FROM base AS deps
ARG PNPM_VERSION=12.8.1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@${PNPM_VERSION}
# Source changes do not invalidate this dependency layer. No other apps are copied.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cms/package.json ./apps/cms/package.json
RUN --mount=type=cache,id=cms-pnpm,target=/pnpm/store \
    pnpm install --filter @areca/cms --no-include-workspace-root --frozen-lockfile --store-dir=/pnpm/store

FROM deps AS build
COPY apps/cms ./apps/cms
ENV SKIP_ENV_VALIDATION=true
RUN pnpm --filter @areca/cms build \
    && pnpm --filter @areca/cms exec node scripts/build-docker-entrypoint.mjs

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app/apps/cms
LABEL org.opencontainers.image.source="https://github.com/ekozf/areca-cms"
# Nitro traces runtime dependencies into .output. The startup bundle includes
# its own dependencies; neither workspace node_modules nor pnpm is needed.
COPY --from=build --chown=node:node /app/apps/cms/.output ./.output
COPY --from=build --chown=node:node /app/apps/cms/.docker/docker-entrypoint.mjs ./scripts/docker-entrypoint.mjs
COPY --from=build --chown=node:node /app/apps/cms/drizzle ./drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "scripts/docker-entrypoint.mjs"]
