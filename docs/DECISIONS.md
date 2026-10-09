# Areca CMS — Architecture decisions (read before working)

Areca is a **build-time CMS**: editors author content in the CMS, publishing creates an immutable
content snapshot, and a build job either deploys the customer's site in Production mode or records
a clearly labeled Demo publication without production deployment. Production site builds fetch the
pinned snapshot **at build time** and prerender it. Visitors normally do not call the CMS for content.
Full background: `PROJECT.md`. This file lists the concrete decisions taken for the implementation.

## Principles

- KISS / YAGNI. No plugin system, no GraphQL, no visual builder, no multi-framework support.
- Adapters are plain internal TypeScript interfaces (`DeploymentAdapter`, `AssetStorageAdapter`).
  Core domain code must not import Dokploy or S3 clients directly.
- Single language content. Paraglide provides UI strings (en/nl/tr); authored content is not translated by the CMS.
- Always `pnpm`. Windows dev machine (PowerShell): never chain with `&&` in scripts that run on Windows; use separate commands or `;`.

## Repository layout (pnpm workspace)

```
apps/cms              TanStack Start app: CMS UI + API + in-process worker/scheduler
packages/site-sdk     @areca-cms/site-sdk: schema, manifest, snapshot pull/read, preview and SEO helpers
examples/demo-site    TanStack Start customer site using the SDK (articles), prerendered, deployed to Dokploy
docker/compose.yml    PostgreSQL, Redis, RustFS (S3-compatible), Mailpit
```

## Stack

- TanStack Start (React 19, Vite 8, TypeScript 6), TanStack Router file routes, TanStack Query.
- Drizzle ORM + PostgreSQL (`pg`). Migrations with drizzle-kit in `apps/cms/drizzle`.
- better-auth for email/password, OAuth/SSO, sessions, and two-factor authentication; tenant and role rules use Areca's own tables.
- React UI with Radix primitives and Tailwind v4; shared Areca controls live in `apps/cms/src/components/ui`.
- Tiptap for rich text; canonical value = Tiptap/ProseMirror JSON with an allowlist of nodes/marks.
- Zod v4 for validation. Vitest for unit/integration, Playwright for e2e.
- Assets: S3 API (`@aws-sdk/client-s3`) against RustFS locally; `sharp` for dimensions and AI image preparation.
- Paraglide for CMS UI locales; OpenRouter through TanStack AI for optional SEO suggestions.
- Email: nodemailer -> Mailpit locally (SMTP env vars).

## Domain model

- Authentication: `user`, `session`, `account`, `verification`, `two_factor`, `sso_provider` (better-auth integration; SSO providers are configured from environment).
- `organization` (agency clients).
- `dokploy_credential` (organizationId, URL, encrypted API key; server-only and cascade-deleted with the organization).
- `membership` (userId, organizationId, role: `owner|editor`). Agency staff have `user.isAgencyAdmin = true` and require two-factor authentication for admin operations.
- `invitation` (email, organizationId, role, token, expiry, acceptance and delivery status).
- `site` (organizationId, name, slug/siteKey, hashed read token, separate hashed schema-write token, productionUrl, previewSecret,
  publishingMode: `production|demo`, deployment target JSON: `{ provider: 'dokploy', applicationId, healthCheckUrl }`, lastManifest JSON, optional site AI prompt).
- `collection` (siteId, key, label, routePattern e.g. `/blog/$slug`, fields JSON: `Field[]`, enabled bool). Synced from the site manifest
  (`POST /api/sites/manifest` with the separate schema token) — agency-owned; customers cannot edit schemas.
- `entry` (siteId, collectionId, draft slug and `draftData`, approved `publishedSlug` and `publishedData`, status, version counters,
  optional frozen `scheduledSlug`/`scheduledData`/`scheduledVersion`, scheduledAt/time zone/actor, publishedAt, creator/updater and timestamps).
- `entry_revision` (entryId, data JSON, createdBy, createdAt, note).
- `deleted_content_archive` preserves deleted entries, collections, and sites at the organization scope.
- Entry SEO is stored in the reserved `$seo` key in entry data and resolved to
  top-level `entry.seo` metadata in publication snapshots. It is not a customer
  content-model field.
- `asset` (organizationId, storageKey, originalFilename, mimeType, size, width, height, altText, createdBy).
- `publication` (siteId, immutable snapshot JSON/hash, entry versions consumed by a due schedule, requestedBy, publishingMode, status including `demo`, `live`, `failed` and superseded states, wasLive, createdAt, deployedAt). Demo records never set `wasLive`; production live records do.
- `build_job` (siteId, publicationId, priority int (higher first; "urgent" = 100), status `queued|building|validating|deploying|succeeded|failed|cancelled`, attempts, dispatch intent/target/upstream id/uncertainty, lease and timestamps, logs, error).
- `publication_request` stores durable idempotency keys and the publication/job returned by a publish or rollback request.
- `audit_log` (organizationId, siteId?, actorId, action, targetType, targetId, meta JSON, createdAt).
- `branding` and `ai_settings` hold instance-wide CMS branding and encrypted OpenRouter settings. `storage_object_deletion` tracks durable S3 cleanup; `scheduler_backoff` tracks per-site retry cooldowns.

Field types: `text | textarea | richtext | image | date | datetime | select | reference | slug | boolean | number | url`.
Field def: `{ key, label, type, required?, options? (select), collection? (reference), description?, after? (date/datetime must be on or after this field key) }`.

## Publishing flow

1. An owner or agency admin clicks **Mark as ready** (`publishEntryFn`), copying the current draft data and slug into the approved fields and recording a revision. **Schedule** instead freezes the current data and slug in `scheduledData` and `scheduledSlug`; later edits stay in the draft. When due, the snapshot includes that frozen version.
2. **Go live** (`requestPublicationFn`) builds an immutable snapshot. Its shape is `{ publicationId, siteKey, createdAt, hash, collections: { [key]: SnapshotEntry[] } }`; each entry carries id, slug, publishedAt, converted data, and optional resolved SEO metadata.
   (rich text exported as `{ json, markdown, document, html }` (`document` = TanStack Markdown AST), image fields resolved to stable CMS asset URLs). SEO metadata is resolved with title, description, canonical, robots, social-image, and JSON-LD fallbacks. Validate snapshot against collection fields; reject on errors.
3. Enqueue `build_job`. Queued (not started) jobs for the same site are cancelled (coalescing) and their publications marked `superseded`.
4. Worker (in-process worker, one job per site at a time, with total concurrency configured by `WORKER_CONCURRENCY` (default 2, maximum 16)): Production persists dispatch intent, calls the `DeploymentAdapter`, polls the matching deployment, and verifies a health URL reports the expected publication id; then the publication becomes `live` and the former live publication is superseded. Failure leaves the previous live release in place. In Demo mode the worker skips production deployment and health verification; it marks the publication `demo`, never `live`.
5. When a successful publication consumes a due scheduled version, the worker copies that frozen data/slug into the approved fields and clears the schedule. A failed publication does not consume the scheduled version.
6. Rollback selects a publication that previously went production-live (`wasLive`), creates a new publication record containing that saved snapshot with a new publication id, and queues a priority-100 build job. The old snapshot hash is retained; a failed rollback can be retried.

## Site integration (how the site gets content)

- Dokploy builds the site from its git repo. Build env has `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` for read access. `ARECA_SCHEMA_TOKEN` separately authorizes `POST /api/sites/manifest` to write the site's schema; the token pair is also surfaced in Settings › Developer.
- SDK `areca pull` / `pullContent()` calls `GET /api/sites/snapshot/current` (read token) which returns the publication marked
  as the one being built/deployed for an active or uncertain dispatch, else the current mode's latest successful `live` or `demo` publication. Result written to
  `src/generated/content/*.json` by the CLI and read by the site. The adapter sets
  `ARECA_SNAPSHOT_ID` to the publication ID before deployment. The CMS also pins the snapshot: the endpoint returns the publication
  of the _active build job_ or unresolved dispatch for that site (falls back to the latest publication matching the site's current mode).
  The build fails loudly if no publication exists.
- Preview: CMS signs a JWT-like token (HMAC, `previewSecret`, 1h expiry, scoped to site+collection+slug). Site route `/__preview/$collection/$slug?token=`
  calls `GET /api/sites/preview?token=` and renders draft data with the same components; responds with `X-Robots-Tag: noindex`.
- The site integration is responsible for rendering snapshot SEO fields in the
  page head. CMS preview responses carry noindex protection; public SEO behavior
  depends on the site template consuming the SDK metadata helpers.
- The SDK exposes `createArecaClient().fetchSnapshot()`, `pullContent()`, and
  `readContent()`; there is no `loadContent()` API. `seoHead()` maps optional
  snapshot metadata to TanStack Router head entries.

## SEO assistance

- SEO metadata is optional per entry; fallback title, description, canonical,
  social image, and structured data are resolved into the snapshot. Character
  targets shown in the editor are advice; server-side schema bounds protect
  stored values without promising search ranking or indexing.
- Optional AI SEO suggestions use an agency-configured OpenRouter provider and
  model. The API key is encrypted server-side. Agency prompt defaults can be
  extended with site-specific instructions. The editor reviews and selects
  suggestions before applying them; AI never marks content ready or publishes.
- Entry content and selected images may be sent to the configured model for a
  suggestion request. Agency configuration and provider terms govern whether
  this feature is enabled for a deployment.

## Dokploy adapter

- Each CMS organization has one Dokploy URL and encrypted API key. The key is encrypted with
  `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY`, never returned to the browser, and can only be replaced.
- The worker resolves credentials when a site job starts. Global `DOKPLOY_URL` / `DOKPLOY_API_KEY` values are used only
  as an explicit non-production fallback with `DOKPLOY_DEV_FALLBACK_ENABLED=true`.
- `POST /api/application.deploy` carries `applicationId`, a stable job title and publication/hash description. Poll
  `GET /api/application.one?applicationId=` for that tagged deployment's ID and status, then GET the site's
  `healthCheckUrl` expecting 200 and the publication ID. A lost deploy response is reconciled, never blindly redispatched.
- Publish/rollback requests retain a UUID idempotency key across lost responses. Safe adapter reads and identical environment
  writes have bounded retries; uncertain dispatches block subsequent site work until reconciled or explicitly resolved.
  See [integration reliability](INTEGRATIONS.md) for the recovery contract.
- The local Dokploy connection defaults are examples in `apps/cms/.env.example`; replace them with the address reachable from your CMS host.

## Roles

Enforced server-side (`requireOrgMember` / `requireEntryAccess(…, 'owner')`); the UI mirrors it by showing
publish-type controls disabled with the reason ("Only owners can publish…").

- Agency admin: everything (clients, sites, content types, people, site settings, releases of all sites); two-factor authentication is required, and sensitive actions may request a fresh code.
- Org `owner`: everything in their client's sites: create and edit drafts, **Mark as ready**, move back to draft,
  schedule / cancel schedule, archive, delete, restore revisions, **Go live**, roll back, cancel builds, delete Library
  files; manage members and invitations; read the client's activity.
- Org `editor`: create entries, edit and save drafts, preview, upload and describe Library files. Editors **cannot**
  mark as ready (publish), schedule, archive, delete, restore or go live, and have no People, Settings or Activity.
