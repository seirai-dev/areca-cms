FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY examples/demo-site/package.json ./examples/demo-site/
COPY packages/site-sdk/package.json ./packages/site-sdk/
RUN pnpm install --frozen-lockfile --filter @areca/demo-site...

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

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/examples/demo-site/.output ./.output
COPY --from=build /app/examples/demo-site/src/generated ./src/generated
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
