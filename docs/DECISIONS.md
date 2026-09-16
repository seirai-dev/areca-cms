# Areca CMS — Architecture decisions (read before working)

Areca is a **build-time CMS**: editors author content in the CMS, publishing creates an immutable
content snapshot, a build job triggers a deployment of the customer's TanStack Start site, the site
fetches the pinned snapshot **at build time** and prerenders it. Visitors never call the CMS.
Full background: `PROJECT.md`. This file lists the concrete decisions taken for the implementation.

## Principles
- KISS / YAGNI. No plugin system, no GraphQL, no visual builder, no multi-framework support.
- Adapters are plain internal TypeScript interfaces (`DeploymentAdapter`, `AssetStorageAdapter`).
  Core domain code must not import Dokploy or S3 clients directly.
- Single language content. Paraglide stays for UI strings (en/nl/tr) but is not required for new UI; English literals are fine.
- Always `pnpm`. Windows dev machine (PowerShell): never chain with `&&` in scripts that run on Windows; use separate commands or `;`.

## Repository layout (pnpm workspace)
```
apps/cms              TanStack Start app: CMS UI + API + in-process worker/scheduler
packages/site-sdk     @areca/site-sdk: defineSiteContent, fetch snapshot at build time, preview helpers
examples/demo-site    TanStack Start customer site using the SDK (articles), prerendered, deployed to Dokploy
docker-compose.yml    postgres:17, rustfs (S3-compatible), mailpit
```

## Stack
- TanStack Start (React 19, Vite 8, TS 6), TanStack Router file routes, TanStack Query, TanStack Form, react-table v9.
- Drizzle ORM + PostgreSQL (`pg`). Migrations with drizzle-kit in `apps/cms/drizzle`.
- better-auth (email/password) + its `admin`/`organization` style handled by our own tables (see roles).
- shadcn/ui components (`pnpm dlx shadcn@latest add <component>` from `apps/cms`), Tailwind v4.
- Tiptap for rich text; canonical value = Tiptap/ProseMirror JSON with an allowlist of nodes/marks.
- Zod v4 for validation. Vitest for unit/integration, Playwright for e2e.
- Assets: S3 API (`@aws-sdk/client-s3`) against rustfs locally; `sharp` for dimensions/thumbnails.
- Email: nodemailer -> Mailpit locally (SMTP env vars).

## Domain model (tables, all ids are text ulids/uuids)
- `organization`  (agency customers). `user`, `session`, `account`, `verification` (better-auth).
- `membership` (userId, organizationId, role: `owner|editor`). Agency staff = `user.isAgencyAdmin = true`; they see everything.
- `invitation` (email, organizationId, role, token, expiresAt, acceptedAt).
- `site` (organizationId, name, slug, siteKey/hashed site token for SDK calls, productionUrl, previewSecret,
  deployment target JSON: `{ provider: 'dokploy', applicationId, healthCheckUrl }`, lastManifest JSON).
- `collection` (siteId, key, label, routePattern e.g. `/blog/$slug`, fields JSON: `Field[]`, enabled bool). Synced from the site manifest
  (`POST /api/sites/manifest` with site token) — agency-owned; customers cannot edit schemas.
- `entry` (siteId, collectionId, slug, status: `draft|published|scheduled|archived`, draftData JSON, publishedData JSON,
  scheduledAt timestamptz, scheduleTimezone, publishedAt, createdBy, updatedBy, timestamps).
- `entry_revision` (entryId, data JSON, createdBy, createdAt, note).
- `asset` (organizationId, storageKey, originalFilename, mimeType, size, width, height, altText, createdBy).
- `publication` (siteId, snapshot JSON, snapshotHash sha256, requestedBy, status: `pending|building|live|failed|superseded|rolled_back`, wasLive bool, createdAt, deployedAt). `wasLive` stays true after the first successful deploy so a later failed rollback can be retried.
- `build_job` (siteId, publicationId, priority int (higher first; "urgent" = 100), status:
  `queued|building|validating|deploying|succeeded|failed|cancelled`, attempts, startedAt, finishedAt, logs text, error text).
- `audit_log` (organizationId, siteId?, actorId, action, targetType, targetId, meta JSON, createdAt).

Field types: `text | textarea | richtext | image | date | datetime | select | reference | slug | boolean | number | url`.
Field def: `{ key, label, type, required?, options? (select), collection? (reference), description?, after? (date/datetime must be on or after this field key) }`.

## Publishing flow
1. Editor clicks Publish (or scheduler fires): entry `publishedData = draftData`, revision recorded.
2. `createPublication(siteId)`: snapshot = `{ siteId, createdAt, collections: { [key]: Entry[] } }` with every published entry
   (rich text exported as `{ json, markdown, document, html }` (`document` = TanStack Markdown AST), image fields resolved to stable asset URLs `/assets/<storageKey>` served by the CMS). Validate snapshot against collection fields; reject on errors.
3. Enqueue `build_job`. Queued (not started) jobs for the same site are cancelled (coalescing) and their publications marked `superseded`.
4. Worker (in-process `setInterval` loop in the CMS server, one job per site at a time, global concurrency 2):
   `building` → call `DeploymentAdapter.deploy(site)` → poll status until done (timeout) → `healthCheck(url)` → publication `live`,
   previous live publication → `superseded`; entries with status `scheduled` whose time passed → `published`. On failure: job `failed`, publication `failed`, previous stays live.
5. Rollback: pick a publication with `wasLive` → new build job with that publication id (becomes `live` again after success). Eligibility is `wasLive`, not current status, so a failed rollback can be retried.

## Site integration (how the site gets content)
- Dokploy builds the site from its git repo. Build env has `ARECA_CMS_URL`, `ARECA_SITE_TOKEN`.
- SDK `loadContent()` at build time calls `GET /api/sites/snapshot/current` (site token) which returns the publication marked
  as the one being deployed (`publication.status in (building)` for the running job, else the latest `live`). Result written to
  `src/generated/content/*.json` by a prebuild script `areca pull` and imported statically by the site. Since Dokploy cannot pass a
  per-deploy env var, the CMS pins the snapshot: the endpoint returns the publication of the *active build job* for that site
  (falls back to the latest `live` publication). The build fails loudly if no publication exists.
- Preview: CMS signs a JWT-like token (HMAC, `previewSecret`, 1h expiry, scoped to site+collection+slug). Site route `/__preview/$collection/$slug?token=`
  calls `GET /api/sites/preview?token=` and renders draft data with the same components; responds with `X-Robots-Tag: noindex`.

## Dokploy adapter
- Base URL `DOKPLOY_URL`, header `x-api-key: DOKPLOY_API_KEY` (env only in CMS server).
- `POST /api/application.deploy { applicationId }`, then poll `GET /api/application.one?applicationId=` → `applicationStatus`
  (`running|done|error|idle`). Then GET the site's `healthCheckUrl` expecting 200.
- Test server: `http://192.168.0.141:3000` (see `.env.example`).

## Roles
- Agency admin: everything (orgs, sites, collections, users, releases of all sites).
- Org `owner`: manage members/invitations of their org, edit + publish content.
- Org `editor`: edit + publish content, no member management.
