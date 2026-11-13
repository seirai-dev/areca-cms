ARG NODE_VERSION=24.22.1
FROM node:${NODE_VERSION}-alpine AS deps
ARG PNPM_VERSION=12.8.1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN npm install --global pnpm@${PNPM_VERSION}
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY examples/demo-site/package.json ./examples/demo-site/
COPY packages/site-sdk/package.json ./packages/site-sdk/
RUN --mount=type=cache,id=demo-site-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @areca/demo-site... --store-dir=/pnpm/store

FROM deps AS build
COPY packages/site-sdk ./packages/site-sdk
RUN pnpm --filter @areca-cms/site-sdk build
COPY examples/demo-site ./examples/demo-site
ARG ARECA_CMS_URL
ENV ARECA_CMS_URL=$ARECA_CMS_URL
# Changing this ARG busts the content-pull layer. Same git + same CMS URL/token
# would otherwise reuse a cached `areca pull` from a previous publication.
ARG ARECA_SNAPSHOT_ID=
ENV ARECA_SNAPSHOT_ID=$ARECA_SNAPSHOT_ID
RUN --mount=type=secret,id=ARECA_SITE_TOKEN,required=true \
    ARECA_SITE_TOKEN="$(cat /run/secrets/ARECA_SITE_TOKEN)" \
    pnpm --filter @areca/demo-site build

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build --chown=node:node /app/examples/demo-site/.output ./.output
COPY --from=build --chown=node:node /app/examples/demo-site/src/generated ./src/generated
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
