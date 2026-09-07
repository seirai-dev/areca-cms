# Suggested MVP status

Audit of `PROJECT.md` § Suggested MVP against this repo (Phase 9). Status is
**done** / **partial** / **missing**. Verification is a unit or e2e test when
one exists, otherwise a code-path review.

## CMS

| item | status | where | notes |
| --- | --- | --- | --- |
| Organizations | done | `apps/cms/src/db/schema.ts`, `apps/cms/src/server/admin/organizations.ts`, `apps/cms/src/routes/_app/admin/organizations/`, `apps/cms/src/server/admin/admin.test.ts`, `apps/cms/e2e/admin.spec.ts` | Create/list/update/delete; cannot delete an org that still has sites. |
| Sites | done | `apps/cms/src/db/schema.ts`, `apps/cms/src/server/admin/sites.ts`, `apps/cms/src/routes/_app/sites/$siteId.tsx`, `apps/cms/src/routes/_app/sites/$siteId/settings.tsx` | Org-scoped sites, token rotate, Dokploy target JSON. |
| Users and invitations | done | `apps/cms/src/server/admin/members.ts`, `apps/cms/src/routes/invite/$token.tsx`, `apps/cms/src/components/admin/org-members.tsx`, `apps/cms/src/server/admin/admin.test.ts` | Invite email, accept, revoke, last-owner guards. Also rejects duplicate pending invites, already-members, and accept with a mismatched signed-in email. |
| Basic roles | done | `apps/cms/src/lib/session.server.ts`, `apps/cms/src/db/schema.ts` (`membership.role`, `user.isAgencyAdmin`) | Agency admin / org owner / org editor. |
| Agency-managed collections | done | `apps/cms/src/server/content/collections.ts`, `apps/cms/src/routes/api/sites/manifest.ts`, `apps/cms/src/components/admin/collection-form-dialog.tsx` | Synced from the site manifest or created by agency admin; customers cannot invent schemas. |
| Text fields | done | `apps/cms/src/components/editor/fields/text.tsx`, `apps/cms/src/server/content/validation.ts` | |
| Textarea fields | done | `apps/cms/src/components/editor/fields/textarea.tsx`, `apps/cms/src/server/content/validation.ts` | |
| Rich text | done | `apps/cms/src/components/editor/rich-text-editor.tsx`, `apps/cms/src/server/richtext/` | Tiptap JSON canonical; allowlisted nodes/marks; HTML + Markdown export. |
| Images | done | `apps/cms/src/components/editor/fields/image.tsx`, `apps/cms/src/server/assets/index.ts` | Asset id stored; snapshot resolves a stable `/api/assets/file/…` URL. |
| Dates | done | `apps/cms/src/components/editor/fields/date.tsx`, `datetime.tsx`, `apps/cms/src/server/content/validation.ts` | `date` + `datetime`. Optional `after` field key enforces end ≥ start. |
| Selects | done | `apps/cms/src/components/editor/fields/select.tsx`, `apps/cms/src/server/content/validation.ts` | Options validated on save. |
| References | done | `apps/cms/src/components/editor/fields/reference.tsx`, `apps/cms/src/server/content/validation.ts`, `apps/cms/src/server/content/snapshot.ts` | Must exist, be published, and appear in the snapshot. |
| Slugs | done | `apps/cms/src/components/editor/fields/slug.tsx`, `apps/cms/src/server/content/validation.ts` | `^[a-z0-9]+(?:-[a-z0-9]+)*$`; unique per collection. |
| Draft/published states | done | `apps/cms/src/db/schema.ts` (`entry.status`), `apps/cms/src/server/content/entries.ts`, `apps/cms/src/components/editor/entry-editor.tsx` | `draft \| published \| scheduled \| archived`. |
| Scheduled publishing | done | `apps/cms/src/server/content/entries.ts` (`scheduleEntry`), `apps/cms/src/server/publishing/scheduler.ts`, `apps/cms/e2e/schedule.spec.ts` | Timezone stored; due drafts are snapshotted; entry becomes `published` only after a successful deploy. |
| Revision history | done | `apps/cms/src/db/schema.ts` (`entry_revision`), `apps/cms/src/server/content/entries.ts`, `apps/cms/src/components/editor/entry-editor.tsx` | List + restore. Covered by `entries.test.ts`. |
| Basic media library | done | `apps/cms/src/routes/_app/sites/$siteId/media.tsx`, `apps/cms/src/server/assets/`, `apps/cms/src/routes/api/assets/` | Upload, alt text, type/size limits, dimensions via sharp, delete blocked when in use. |
| Audit log | done | `apps/cms/src/db/schema.ts` (`audit_log`), `apps/cms/src/server/audit.ts`, `apps/cms/src/routes/_app/admin/audit.tsx`, `apps/cms/src/routes/_app/orgs/$orgId/audit.tsx` | Written on admin/content/publish actions. Agency sees all events; org owners see their org at **Activity**. |

## Site integration

| item | status | where | notes |
| --- | --- | --- | --- |
| TanStack Start adapter | done | `packages/site-sdk/`, `examples/demo-site/` | First official site adapter; core CMS does not import Start. |
| Build-time content loader | done | `packages/site-sdk/src/pull.ts`, `packages/site-sdk/src/cli.ts`, `examples/demo-site/scripts/prebuild.mjs` | `areca pull` writes JSON under `src/generated/content`. |
| Generated content manifest | done | `packages/site-sdk/src/pull.ts` | `manifest.json` with publicationId, hash, createdAt, counts. |
| Static route generation | done | `examples/demo-site/src/routes/blog/$slug.tsx`, `examples/demo-site/src/lib/queries.ts`, `examples/demo-site/scripts/verify-prerender.ts` | Prerender `/`, `/blog`, `/blog/<slug>`. |
| Collection-to-route mapping | done | `packages/site-sdk/src/config.ts`, `examples/demo-site/areca.config.ts`, `apps/cms` collection `routePattern` | e.g. articles → `/blog/$slug`. |
| Site-specific schema registration | done | `packages/site-sdk` `sync-manifest`, `apps/cms/src/routes/api/sites/manifest.ts` | Site token auth; CMS stores `lastManifest` and upserts collections. |

## Publishing

| item | status | where | notes |
| --- | --- | --- | --- |
| Content snapshot creation | done | `apps/cms/src/server/content/snapshot.ts`, `apps/cms/src/server/publishing/publications.ts` | Immutable JSON + sha256; rich text exported as `{ json, html, markdown }`. |
| Build queue | done | `apps/cms/src/db/schema.ts` (`build_job`), `apps/cms/src/server/publishing/worker.ts` | In-process worker (`WORKER_ENABLED`); one job per site; coalesces queued jobs. |
| Priority levels | done | `apps/cms/src/server/publishing/publications.ts`, `apps/cms/src/components/editor/release-status-bar.tsx` | Default 0; **Urgent** / rollback = 100. Worker `ORDER BY priority DESC`. |
| Build logs | done | `apps/cms/src/server/publishing/worker.ts` (`appendLog`), `apps/cms/src/routes/_app/sites/$siteId/releases.tsx` | Timestamped lines; viewable on the Releases page. |
| Validation | done | `apps/cms/src/server/content/validation.ts`, `apps/cms/src/server/content/snapshot.ts`, `apps/cms/src/server/richtext/validate.ts` | Required fields, slugs, references, missing assets, rich-text allowlist, route collisions, date `after`, `url` fields, link hrefs. |
| Build failure reporting | done | `apps/cms/src/server/publishing/worker.ts`, `apps/cms/src/routes/_app/sites/$siteId/releases.tsx` | Job/publication `failed`; previous live publication stays live. |
| Dokploy deployment adapter | done | `apps/cms/src/adapters/deployment/dokploy.ts`, `apps/cms/src/adapters/deployment/types.ts` | Internal `DeploymentAdapter`; CMS UI never talks to Dokploy. |
| Health checks | done | `apps/cms/src/server/publishing/worker.ts`, `examples/demo-site/src/routes/api/health.ts` | GET `healthCheckUrl` until `{ ok, publicationId }` matches. |
| Rollback to previous release | done | `apps/cms/src/server/publishing/publications.ts` (`requestRollback`), `apps/cms/e2e/rollback.spec.ts` | Eligible when `wasLive`; retries a failed rollback. |

## Preview

| item | status | where | notes |
| --- | --- | --- | --- |
| Signed draft preview | done | `apps/cms/src/server/content/preview-token.ts`, `apps/cms/src/routes/api/sites/preview.ts`, `apps/cms/e2e/preview.spec.ts` | HMAC token scoped to site + collection + slug. |
| Preview route in the website | done | `examples/demo-site/src/routes/[__preview]/$collection/$slug.tsx`, `packages/site-sdk/src/preview.ts` | `X-Robots-Tag: noindex`. |
| Preview token expiration | done | `apps/cms/src/server/content/preview-token.ts` | Default 1h; unit-tested. |
| Optional preview deployment later | missing | — | Intentionally out of scope (PROJECT.md: “later”). See Deferred. |

## Do not initially build

Confirmed **not** built as product features:

| item | status |
| --- | --- |
| Visual page builder | not built |
| Arbitrary customer-defined components | not built (allowlisted Tiptap nodes only) |
| GraphQL | not built (no CMS GraphQL API; TanStack plugin names in Vite/devtools only) |
| Real-time collaborative editing | not built |
| Multi-framework support | not built (TanStack Start only) |
| Public plugins | not built (internal `DeploymentAdapter` / `AssetStorageAdapter` only) |
| AI features | not built |
| Complex branching workflows | not built |
| Marketplace functionality | not built |

## Deferred

Large or explicitly later work, not started:

- Preview deployments (temp snapshot → preview target). Live draft preview covers the MVP.
- Multi-language content / missing-translation checks. UI i18n (Paraglide) is unrelated.
- Broken internal-link crawl across the snapshot (rich-text hrefs are protocol-checked only).
- SEO-specific validators (title length, canonical, etc.).
- Media extras from PROJECT.md that are beyond “basic”: thumbnails, focal point, CDN, usage graph UI.
- Separate build workers / incremental builds / per-site locking beyond the in-process queue.

## Summary

| status | count |
| --- | --- |
| done | 37 |
| partial | 0 |
| missing | 1 (preview deployments — deferred) |
| do-not-build (correctly absent) | 9 |
