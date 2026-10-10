# Concepts and architecture

Areca separates authoring from website delivery. The CMS stores drafts, approvals, media, and publishing history. The website uses the SDK to pull an immutable content snapshot during its build, then serves that built content to visitors.

For setup instructions, use [onboarding](ONBOARDING.md). For website code, use the [SDK guide](SDK.md).

## Organizations, sites, and access

A client is an **organization**. Each organization has one or more sites and memberships. An **owner** or **editor** membership applies to the organization's sites, rather than one site alone. Agency admins have access across organizations.

A site has its own collections, entries, production URL, SDK token, preview secret, and optional deployment target. Agency admins manage site settings and content types. Editors author drafts; owners also approve and publish. The [permission matrix](AUTHZ_MATRIX.md) records exact server-side rules.

The media library is scoped to the organization. Sites belonging to the same client can share assets; unrelated clients cannot manage or select each other's assets. Uploaded file URLs are public, including files attached to drafts; organization scoping protects CMS operations, not possession of a file URL.

## Content types belong to the website

A collection describes its fields and route, such as Articles at `/blog/$slug`. Developers declare collections in `areca.config.ts` and push that manifest to the CMS. Agency admins can also manage content types in the CMS. Owners and editors fill in those fields.

Pushing a manifest changes the CMS schema; it does not build page components. Your website still implements its routes and rendering. A schema change may make older content invalid, so review entries before the next release. See [content schemas](CONTENT_SCHEMA.md).

## Draft, approved, scheduled, and live content

An entry can hold different versions at the same time:

| Version   | Purpose                                                         |
| --------- | --------------------------------------------------------------- |
| Draft     | Current editable data and slug; draft preview uses these        |
| Approved  | Version copied by **Mark as ready**; the next release uses this |
| Scheduled | Frozen version and slug approved for a future time              |
| Live      | Version inside the currently live publication snapshot          |

Editing a ready or live entry changes its draft. Mark it ready again to approve those edits. A scheduled version remains separate from later draft edits. Entry revision history helps restore earlier authoring data; a release rollback restores an entire website content snapshot.

**Ready** is a user-facing publishing state; the stored entry status uses `published` for approved content. Whether an approved entry is actually live depends on the live snapshot, not that stored status alone.

Archiving or deleting content does not instantly remove it from an already deployed website. A successful new release must exclude it. References can block removal when another entry still needs the target.

## Publishing a site

1. An owner or agency admin requests **Go live**.
2. The CMS validates the enabled collections' approved content and due scheduled versions. It checks required fields, slugs, references, assets, rich text, SEO, and route collisions.
3. The CMS saves an immutable publication snapshot and its hash, then queues a build job. New requests can replace queued work for the same site.
4. A worker claims the job, resolves the client's deployment credentials, and asks Dokploy to deploy the site's application.
5. The website build runs `areca pull`. The SDK uses Dokploy’s `ARECA_SNAPSHOT_ID` build argument to request that exact frozen publication and invalidate the cached pull layer. Manual pulls without a publication ID read the latest successful release for the site’s current mode.
6. The worker waits for deployment and checks the website's health response against the expected publication ID.
7. On success, the publication becomes live. On failure, the previous live publication remains the CMS's live version.

Sites default to **Production** mode, which requires a deployment target and a publication-aware health URL. For local work, an admin can select **Demo** in Settings › Deployment. Demo publications are pullable for local builds, but use status `demo`, never count as production live, and cannot be rollback targets.

### Worker behavior

The worker and scheduler run inside the CMS server when `WORKER_ENABLED` is enabled. Work is stored in PostgreSQL. Database claims, leases, and heartbeats coordinate jobs across processes; only one active or uncertain deployment is allowed per site and per shared Dokploy application. Global concurrency is configurable.

A lost deployment response may leave the dispatch outcome uncertain. The worker reconciles it rather than blindly dispatching again. See [integration reliability](INTEGRATIONS.md) and [operations](OPERATIONS.md) before resolving such a job manually.

### Releases and rollback

A release records the whole site's snapshot, build steps, logs, and status. Restore a release that previously went live to redeploy its content. The CMS creates a new publication ID containing the old snapshot's content and hash, then queues a high-priority build. This uses the configured website repository and deployment target; it is not a rollback of website source code, database migrations, or provider settings.

## Snapshot format

A snapshot contains collection arrays of entries with stable IDs, approved slugs, dates, and resolved data. Image fields become URL/dimension/alt-text objects; references become collection/slug/ID objects; rich text includes JSON, Markdown, a Markdown document, and HTML. Resolved SEO is a separate optional `entry.seo` object for compatibility with older snapshots.

`areca pull` writes one JSON file per collection and `manifest.json` with publication ID, hash, creation time, and counts. Read these files at build time or import them through your framework. Keep the SDK token on the build/server side.

Snapshot metadata is immutable. Assets are still external resources: retained publications protect referenced media from cleanup, and public asset delivery depends on the CMS/storage deployment. See [asset retention](ASSET_RETENTION.md).

## Preview

The CMS creates an expiring signed token scoped to a site, collection, and draft slug. The website's preview route passes it to the SDK, fetches the draft, and renders the result. Preview is a server-side live CMS request and must return no-index and no-cache headers. It does not mark anything ready or live.

Anyone holding a valid preview link can view that draft until it expires. Avoid recording real preview tokens in documentation or screenshots.

## SEO and AI

SEO/GEO settings are saved with each entry's draft and follow the same approval and release workflow. The CMS resolves defaults, sharing metadata, and structured data into `entry.seo`; the website emits them using SDK helpers. Summaries, FAQs, and key takeaways also need visible website rendering where appropriate.

AI SEO generation is optional. Agency admins configure an encrypted OpenRouter key and models; a site's additional prompt guides suggestions. Generation proposes edits for review and does not publish them. See [SEO and AI](SEO.md).

## AI apps (MCP)

Each site has a connector URL at `/api/mcp/<site-slug>`. An AI app connects to it by signing the user in through OAuth 2.1 (the CMS is the authorization server, built on `@better-auth/oauth-provider`), and the user approves the app for that site on a consent screen. Each request re-checks the access token, the app's connection to the site, and the user's live role on that site, then runs the same kind of checks as the CMS screens. Personal keys for scripts use the same checks through `/api/mcp`. Discovery documents are served from the origin root. Tools are registered only for the roles that may use them. Writes go through the same services as the UI, so drafts, publishing and activity behave identically. Tool results report errors in plain language for the model. See [MCP.md](MCP.md).

## Repository map

| Path                                  | Responsibility                                            |
| ------------------------------------- | --------------------------------------------------------- |
| `apps/cms/src/routes`                 | CMS pages and HTTP API routes                             |
| `apps/cms/src/features`               | CMS screen components and client interactions             |
| `apps/cms/src/server/content`         | Entries, schemas, validation, snapshots, preview          |
| `apps/cms/src/server/publishing`      | Releases, queue, scheduler, worker                        |
| `apps/cms/src/server/admin`           | Clients, sites, members, branding, credentials            |
| `apps/cms/src/server/security`        | Authorization, two-factor step-up, encryption             |
| `apps/cms/src/server/ai`              | AI configuration and SEO generation                       |
| `apps/cms/src/server/mcp`             | Connect AI: personal keys, the MCP endpoint and its tools |
| `apps/cms/src/features/connect-ai`    | Connect AI page                                           |
| `apps/cms/src/adapters`               | Deployment, storage, and email integrations               |
| `apps/cms/src/db`, `apps/cms/drizzle` | Database schema and migrations                            |
| `packages/site-sdk/src`               | Schema helpers, CLI, content pull, preview, SEO rendering |
| `examples/demo-site`                  | TanStack Start integration and build/health examples      |
| `docker`                              | Production Compose installation and recovery tools        |
| `docker-compose.yml`                  | Local development infrastructure                          |

[Architecture decisions](DECISIONS.md) explains lower-level contracts. [Development](DEVELOPMENT.md) explains how to work on the repository.
