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
- Content languages: a site can publish the same entries in several languages. The contract is `docs/design/content-languages.md` (this replaces the former "single language content" decision). Paraglide provides the CMS's own UI strings (en/nl/tr), which is a separate matter.
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
- SDK `areca pull` / `pullContent()` calls `GET /api/sites/snapshot/current` with the read token. A worker build passes its exact publication ID using `ARECA_SNAPSHOT_ID`; the SDK sends `?publicationId=<id>` and checks the response identity. Ordinary manual pulls without a pin return the latest successful `live` or `demo` release for the current mode. An explicit missing or foreign publication fails without fallback. Generated JSON is written to `src/generated/content/*.json` and read by the site.
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

## AI apps (Connect AI, MCP)

- Each site has its own MCP connector URL, `/api/mcp/<site-slug>`, served by the CMS. A personal-key endpoint, `/api/mcp`, remains for scripts. Both are documented in the CMS docs, not the site SDK docs, because they authenticate users, not site projects.
- **Sign-in is OAuth 2.1 in the browser** (decided Oct 2026, supersedes the earlier "OAuth deferred for v1" decision). The CMS is an authorization server built on `@better-auth/oauth-provider` (Better Auth 1.7.7), so AI apps sign in with the same accounts, sign-in page and two-factor codes as the CMS. The user approves each app for each site on a consent screen. Nothing secret is pasted into the app.
- **Opaque access tokens** (`areca_at_`, one hour) and **rotating refresh tokens** (`areca_rt_`, 90 days from last use, 30 second reuse window), stored as SHA-256 hashes. The JWT plugin is off. Every request reads the token from the database, so disconnecting an app or removing a member takes effect at once without key rotation or a JWKS to manage.
- **Reuse of a rotated refresh token after the window is replay.** The plugin then deletes that app's access and refresh tokens for the user on every site (not only the one refreshed). The app must sign in again. The `mcp_connection` rows are not deleted, so Connected apps still lists them until the app reconnects. This is a known wide effect; it is accepted for now.
- **Dynamic Client Registration without Client ID Metadata Documents.** Anonymous registration creates public clients (no secret, PKCE `S256` only) with exact redirect-URI matching. Loopback `http` redirects are accepted for native clients (Claude Code, Cursor, VS Code), and `https` elsewhere. CIMD is not available in the installed plugin, so it is not offered. Registration is rate limited (20 an hour per address, 300 an hour for the deployment), and the token endpoint is rate limited per app and address. Add CIMD when the plugin supports it.
- **Per-site resource URLs.** Each site is a protected resource at its connector URL (RFC 8707 `resource`), with its own protected resource metadata (RFC 9728) at `/.well-known/oauth-protected-resource/api/mcp/<slug>`. A token works only for the resource it was issued for, and consent is recorded per (user, app, site). An approval for one site never covers another.
- **Discovery at the origin root.** Discovery documents are served by a server dispatch in `server.ts`, not by file routes, because file routing does not serve `.well-known` folders reliably. Path-inserted metadata URLs are used (`/.well-known/oauth-authorization-server/api/auth`), which match the issuer `${BETTER_AUTH_URL}/api/auth`. RFC 9207 `iss` is advertised and sent.
- **Publishing is opt-in on the consent screen.** "Allow going live" is off by default and shown only to owners and agency admins. Editors cannot allow it. An agency admin's approval needs a fresh two-factor code, the same as creating a key.
- **Connections are checked on every request.** A connection is usable while it is not revoked and was used (or created) within 90 days. The user's live role is read on each request, so role changes apply at once. Disconnecting revokes the app's tokens for that site and removes its consent.
- Personal keys stay as the **Advanced** option for scripts, CI and clients that cannot sign in through a browser. Keys are 32 random bytes, stored as SHA-256 hashes and shown once. Expiry is 30, 90, 365 days or never (default 90). A user may hold 20 active keys per site. Owners and agency admins can see and revoke every key on the site, and editors only their own.
- A key or connection acts as its user with the user's live role, read on every request. The tool list is filtered by role, and each call re-checks access. Revoked, expired, disconnected or removed-member credentials fail at once, even in an open session.
- Going live is opt-in per key or connection. Only owners and agency admins can allow it, and it works only while the user remains an owner or agency admin. Rollback and build cancellation use the same flag.
- Agency admins creating a key or approving a connection need a fresh authenticator code, because the credential keeps admin power for its lifetime. Their credentials can also change content types.
- Files come in only from public URLs, through the SSRF-safe downloader used for other remote fetches. The type is judged from the bytes, the size is capped at 20 MB, and no base64 upload exists.
- Rich text is written as Markdown and converted to the stored format, so agents never send HTML. Image references use asset ids (`![alt](asset:<id>)`), which must exist in the organization library.
- There is no tool that generates SEO. The model writes the SEO fields itself, which keeps SEO content under the same draft and review flow as other fields. The OpenRouter-based AI settings are unchanged and stay separate.
- Rate limits: `/api/mcp` and `/api/mcp/<site>` allow 120 requests a minute per access token or key, plus 600 a minute per client IP when the IP is known (behind a trusted proxy). They are exempt from the general writes limit, because one AI session makes many small requests.
- The server is stateless with JSON responses, so no session state is stored between requests.
- **Consequences for hosting.** `APP_URL` and `BETTER_AUTH_URL` must be the same public HTTPS origin, because the connector URL, the issuer and the discovery documents are built from them. A reverse proxy must forward `/.well-known/*`, `/api/auth/*` and `/api/mcp/*`. ChatGPT and Claude connect from the internet, so a LAN-only CMS cannot serve them, and Claude Code, Cursor and VS Code need HTTPS for any address other than `localhost`.

## Site content (globals), 2026-10-14

Agreed decisions for single-instance content sections. The full contract, including storage, wire formats and roles, is in [design/site-content-globals.md](design/site-content-globals.md).

- **Shape.** A site can have several named sections (`companyInfo`, `homePage`). Each has its own fields, using the same field types as collections except `slug`. The CMS UI calls them **Site content**; code, SDK and API call them **globals**.
- **Schema source.** Agencies can define sections in the CMS or in `areca.config.ts` (`globals: {}`). A manifest push is a full sync: an omitted section is disabled and its content kept. `GET /api/sites/manifest` lists only enabled sections and omits `globals` when there are none.
- **Storage.** Sections reuse the `collection` and `entry` tables with `kind = 'global'`. Each has exactly one entry, with the constant slug `$global`. Revisions, scheduling, release diff, Go live and activity work unchanged. `archived` is never used for globals.
- **Publishing.** Same flow as entries: draft autosave, owner marks ready, ships with the next Go live, and appears in pending changes. Go live is blocked while an enabled section with required fields has never been made ready. Sections without required fields ship `{}` until first ready.
- **Features.** Revisions and restore, scheduling, discard draft, and live preview. No unpublish, archive or delete of the single entry; a section is removed through its enable flag (hidden, content kept) or by agency delete (content archived).
- **Groups.** An optional `group` on a section field is a visual heading in the editor only. It is not allowed on collection fields, and the SDK value stays flat.
- **SEO.** Opt-in per section with `seo: true`. The SDK exposes it as `$seo` on the section value. Entries get no automatic fallback from it.
- **SDK shape.** `content.globals.<camelKey>` returns the camelCased field values, plus `$seo` when SEO is on. Typegen emits `globalSchema`, `Register.globals` and a `<Name>Global` type per section.
- **Preview.** A section has an optional `previewPath` such as `/about`. The CMS opens `<site><previewPath>?arecaPreview=<token>`, and the site overlays the draft with `content.previewGlobals(...)`. Without a `previewPath`, preview is unavailable for that section.
- **References.** Section fields may reference collection entries. Collections may not reference sections.
- **Roles.** Editors edit and discard drafts and view history. Owners also mark ready, schedule, restore and go live. Agency admins also create and edit fields, enable or disable, set SEO and preview path, and delete. Server functions and MCP tools follow the same split.
- **MCP.** Dedicated tools `get_global`, `update_global`, `discard_global_draft`, `upsert_global` and `delete_global`. Existing workflow tools accept a section's entry `id`. `unpublish_entry`, `archive_entry` and `delete_entry` refuse section ids.
- **Snapshot.** Enabled sections are published in `globals`, with their schema in `globalSchema`. A site without sections keeps the same hash as before.
