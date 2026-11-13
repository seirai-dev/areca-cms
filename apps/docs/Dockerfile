# syntax=docker/dockerfile:1
# Standalone, read-only docs site. Build from the repository root:
#   docker build -f apps/docs/Dockerfile -t areca-docs .
# The SDK manifest is also needed to validate documented install versions.
ARG NODE_VERSION=24.22.1

FROM node:${NODE_VERSION}-alpine AS build
ARG PNPM_VERSION=12.8.1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/docs/package.json ./apps/docs/package.json
RUN --mount=type=cache,id=docs-pnpm,target=/pnpm/store \
    pnpm install --filter @areca/docs --no-include-workspace-root --frozen-lockfile --store-dir=/pnpm/store
COPY apps/docs ./apps/docs
COPY packages/site-sdk/package.json ./packages/site-sdk/package.json
RUN pnpm --filter @areca/docs build \
    && find apps/docs/dist/client -type f -size +1k \
        \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.json' \
           -o -name '*.txt' -o -name '*.md' -o -name '*.xml' -o -name '*.svg' -o -path '*/api/search' \) \
        -exec gzip -9 -k {} +

FROM nginx:1.31-alpine@sha256:713fc2ebfd92e8217db451477182ee91944b123d2b1ee9fd5a8c6e91ca6c3a11 AS runner
LABEL org.opencontainers.image.source="https://github.com/seirai-dev/areca-cms"
COPY apps/docs/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/docs/dist/client /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
