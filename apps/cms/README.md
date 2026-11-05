# Areca CMS app

The CMS itself: the editor, the agency dashboard, the site API the SDK talks to, the MCP connectors, and the background worker that builds and deploys releases.

It's a [TanStack Start](https://tanstack.com/start) app (React 19, TanStack Router and Query) on PostgreSQL with [Drizzle](https://orm.drizzle.team), Redis and S3-compatible storage. Sign-in uses [Better Auth](https://www.better-auth.com), the interface is translated with [Paraglide](https://inlang.com/m/gerre34r/library-inlang-paraglideJs), and UI components follow [shadcn/ui](https://ui.shadcn.com) patterns.

**Running Areca CMS rather than working on it?** Use the published Docker image: see [`docker/`](../../docker/README.md) and the [self-hosting docs](https://docs.arecacms.com/docs/self-hosting).

## Run it locally

From the repository root:

```sh
pnpm install
docker compose up -d                          # PostgreSQL, Redis, RustFS (S3) and Mailpit
cp apps/cms/.env.example apps/cms/.env.local  # then set BETTER_AUTH_SECRET and the encryption keys
pnpm db:migrate
pnpm db:demo                                  # demo clients, sites, content and images
pnpm dev                                      # http://localhost:3000
```

`pnpm db:demo` erases the local database and bucket first, and refuses to run against anything that isn't local. It creates five fictional clients (Harbor & Pine, Northwind Cycling, Lumen Dental, Fieldnote Architects and Kestrel Outdoor). Sign in with:

| Account                      | Password      | Role                                                                                                                                   |
| ---------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `admin@areca.local`          | `password123` | Agency admin. Needs a two-factor code; the demo authenticator secret is in [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md#demo-data). |
| `ruth@harborandpine.example` | `password123` | Owner of Harbor & Pine                                                                                                                 |
| `tom@harborandpine.example`  | `password123` | Editor at Harbor & Pine                                                                                                                |

Sent emails land in Mailpit at <http://localhost:8025>.

## How the code is organised

| Path               | What's there                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `src/routes/`      | File-based routes: the screens, and the HTTP API under `routes/api/` (site API, MCP, auth, uploads)            |
| `src/features/`    | The screens and their components, one folder per area (`editor`, `golive`, `library`, `agency`, `visual`...)   |
| `src/components/`  | Shared UI building blocks                                                                                      |
| `src/server/`      | Server-only code: content and publishing, auth and permissions (`security/`), MCP tools, mail, AI, deployments |
| `src/server/fn/`   | Server functions the screens call. They check permissions and call into the rest of `src/server/`              |
| `src/adapters/`    | Deployment (Dokploy, Cloudflare) and storage (S3) adapters                                                     |
| `src/db/schema.ts` | The database schema. Migrations are in `drizzle/`                                                              |
| `messages/`        | Interface text in English, Dutch and Turkish                                                                   |
| `scripts/`         | Seeding, demo data, resets, recovery and maintenance scripts                                                   |
| `e2e/`             | Playwright browser tests, including the docs screenshot capture                                                |
| `benchmarks/`      | The load-test suite and its results                                                                            |

[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) explains how the pieces fit together, and [docs/DESIGN.md](../../docs/DESIGN.md) covers the design system.

## Tests

```sh
pnpm --filter @areca/cms typecheck
SKIP_INTEGRATION_TESTS=true pnpm --filter @areca/cms test   # unit tests only, no services needed
pnpm --filter @areca/cms test                               # also the database and storage tests
pnpm --filter @areca/cms test:e2e:isolated                  # browser tests on a separate database
```

The integration tests need a throwaway database whose name marks it as a test database; they refuse to run otherwise. **`pnpm test:e2e` wipes the configured database and bucket**, so use `test:e2e:isolated` if you want to keep your local data. [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md) has the details.

## Database changes

Change `src/db/schema.ts`, run `pnpm db:generate` to create a migration in `drizzle/`, review the SQL, and apply it with `pnpm db:migrate`. Commit the migration together with the schema change.

## Docs screenshots

The screenshots on the docs site come from `e2e/docs/docs-screenshots.spec.ts`. Run `pnpm db:demo`, start the CMS, then run `pnpm docs:screenshots`. The images are written to `apps/docs/public/screenshots/`.
