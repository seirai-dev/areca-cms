# Build from the monorepo root:
#   docker build -f apps/cms/Dockerfile .
FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/site-sdk/package.json ./packages/site-sdk/package.json
COPY examples/demo-site/package.json ./examples/demo-site/package.json
COPY apps/cms ./apps/cms
RUN pnpm install --frozen-lockfile --filter @areca/cms...

FROM deps AS build
ENV SKIP_ENV_VALIDATION=true
RUN pnpm --filter @areca/cms build

FROM node:24-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
COPY --from=build /app /app
WORKDIR /app/apps/cms
EXPOSE 3000
CMD ["node", "scripts/docker-entrypoint.mjs"]
