# Areca

Areca is a **build-time CMS**: editors author content in the CMS, publishing creates an immutable content snapshot, a build job triggers a deployment of the customer's TanStack Start site, the site fetches the pinned snapshot **at build time** and prerenders it. Visitors never call the CMS.

## Layout

- `apps/cms` — CMS UI, API, and worker
- `packages/site-sdk` — `defineSiteContent` and site integration helpers
- `examples/demo-site` — sample TanStack Start site using the SDK
- `docker-compose.yml` — Postgres, RustFS (S3), Mailpit

## Setup

```bash
docker compose up -d
pnpm install
pnpm --filter @areca/cms s3:init
pnpm dev
```

The CMS runs at http://localhost:3000. Demo site: `pnpm --filter @areca/demo-site dev` (port 3001).
