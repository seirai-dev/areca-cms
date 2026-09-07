# Areca

Areca is a **build-time CMS** for agency-managed sites. Editors author content in the CMS. Publishing writes an immutable snapshot, a build job deploys the customer's TanStack Start site via Dokploy, and the site pulls that pinned snapshot **at build time**. Visitors never call the CMS.

```text
CMS (author + validate)
      │
      ▼
immutable publication snapshot
      │
      ▼
build job (queue / worker)
      │
      ▼
Dokploy deploy
      │
      ▼
site build (`areca pull` fetches the pinned snapshot)
      │
      ▼
health check
      │
      ▼
publication marked live
```

## Layout

- `apps/cms` — TanStack Start CMS (UI, API, in-process worker/scheduler)
- `packages/site-sdk` — `@areca/site-sdk`: schema, `areca pull`, preview helpers
- `examples/demo-site` — sample TanStack Start customer site
- `docker-compose.yml` — Postgres, RustFS (S3), Mailpit

## Quick start

```powershell
docker compose up -d
pnpm install
cp apps/cms/.env.example apps/cms/.env.local
pnpm --filter @areca/cms s3:init
pnpm db:migrate
pnpm --filter @areca/cms db:seed
pnpm dev
```

CMS: http://localhost:3000. Demo site: `pnpm --filter @areca/demo-site dev` (port 3001).

Seeded logins (password `password123`):

- `admin@areca.local` — agency admin
- `owner@acme.local` — Acme owner
- `editor@acme.local` — Acme editor

## Integrate a site

Declare collections with `defineSiteContent`, sync the manifest, and pull the snapshot at build time. See [`packages/site-sdk/README.md`](packages/site-sdk/README.md).

## Deploy a customer site

Dokploy builds from git; the CMS pins the snapshot and health-checks the new container. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Testing

```powershell
pnpm test
pnpm test:e2e
pnpm -r typecheck
```

## Docs

- [`docs/DECISIONS.md`](docs/DECISIONS.md) — architecture decisions
- [`docs/MVP_STATUS.md`](docs/MVP_STATUS.md) — Suggested MVP audit
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Dokploy customer-site deploy
- [`PROJECT.md`](PROJECT.md) — original design notes
