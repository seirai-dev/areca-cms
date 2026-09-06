FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/site-sdk ./packages/site-sdk
COPY examples/demo-site ./examples/demo-site
RUN pnpm install --frozen-lockfile --filter @areca/demo-site...

FROM deps AS build
ARG ARECA_CMS_URL
ARG ARECA_SITE_TOKEN
ENV ARECA_CMS_URL=$ARECA_CMS_URL
ENV ARECA_SITE_TOKEN=$ARECA_SITE_TOKEN
RUN pnpm --filter @areca/site-sdk build
RUN pnpm --filter @areca/demo-site build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/examples/demo-site/.output ./.output
COPY --from=build /app/examples/demo-site/src/generated ./src/generated
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
