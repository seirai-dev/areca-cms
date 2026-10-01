# Areca

Areca is a **build-time CMS** for agency-managed sites. Editors write drafts in the CMS; owners mark them **ready** and press **Go live**. Going live writes an immutable snapshot, a build job deploys the customer's TanStack Start site via Dokploy, and the site pulls that pinned snapshot **at build time**. Visitors never call the CMS.

![The site Overview](docs/screenshots/overview-light.png)

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

## The CMS at a glance

- **Workspaces.** Everyone works inside a site workspace ("Acme Website"): Overview, the site's content types, Library, People (owners) and Settings (agency admins). Agency admins also get the **Agency** workspace: clients, all sites, people, activity and branding. The workspace card at the top of the sidebar switches between them; ⌘K opens the command palette.
- **Draft → Ready → Live.** Drafts save themselves as you type. **Mark as ready** queues an entry for the next release; the **Go-live tray** at the bottom of the sidebar shows what is waiting and runs **Go live**. Releases, build logs and rollback live in the Go-live panel.
- **Roles.** Editors write and edit drafts; owners also mark as ready, schedule, archive, delete, go live and manage people; agency admins can do everything, including site settings and content types.
- Light and dark themes, English/Dutch/Turkish UI, whitelabel branding (name, logo, accent, font). The design system is documented in [`docs/DESIGN.md`](docs/DESIGN.md).

## Layout

- `apps/cms` — TanStack Start CMS (UI, API, in-process worker/scheduler)
- `packages/site-sdk` — `@areca-cms/site-sdk`: schema, `areca pull`, preview helpers
- `examples/demo-site` — sample TanStack Start customer site
- `docker-compose.yml` — Postgres, Redis, RustFS (S3), Mailpit

## Run with Docker

For a complete stack using the published CMS image, see [`docker/README.md`](docker/README.md).

## Quick start

Empty CMS (recommended first time): see [`docs/ONBOARDING.md`](docs/ONBOARDING.md).

Seeded demo data:

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

Redis provides shared rate limits for CMS mutations, uploads, and site-token
API calls. Requests fail open with a server error log if Redis is unavailable.
Set `REDIS_URL` in production. Set `RATE_LIMIT_TRUST_PROXY=true` only when the
fronting proxy replaces client-supplied forwarding headers.

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

`pnpm test:e2e` runs against `PLAYWRIGHT_BASE_URL` (default `http://localhost:3000`) and its setup spec **wipes the database and the upload bucket**. To keep your dev data, run the suite on an isolated stack instead: `pnpm --filter @areca/cms test:e2e:isolated` (and `test:e2e:qa:isolated` for the screenshot walkthrough). It uses the `areca_e2e` database, the `areca-e2e` bucket and Redis DB 1 on port 3100, creating and migrating them as needed (see `apps/cms/scripts/e2e-isolated.mjs`). `PW_CHROMIUM_PATH` points Playwright at a local Chromium; `QA_SCREENSHOT_DIR` sets where the walkthrough saves screenshots.

## Docs

- [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — empty CMS → first admin → demo site
- [`docs/DESIGN.md`](docs/DESIGN.md) — design system: tokens, type, primitives, patterns, checklist
- [`docs/design/brief.md`](docs/design/brief.md) — the UI/UX redo specification and its deviations
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — architecture decisions
- [`docs/MVP_STATUS.md`](docs/MVP_STATUS.md) — Suggested MVP audit
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Dokploy customer-site deploy
- [`PROJECT.md`](PROJECT.md) — original design notes
