# Areca MCP tools

`*` means required. Access: **all** = every role, **owner** = owners and agency admins, **go-live** = also needs "Allow going live" on the connection or key, **agency** = agency admins only. Tools a caller cannot use are not listed by the server.

## Site and schema

| Tool | Access | Inputs | Returns |
| --- | --- | --- | --- |
| `get_site_info` | all | none | `site` (name, slug, productionUrl, publishingMode), `you` (role, capabilities), `cannotDo[]`, `collections[]`, `guide`. **Call first.** |
| `get_collection_schema` | all | `collection*` | Per-field key, type, required, format, options; example `fields` and `seo` payloads; SEO guide |

## Entries

| Tool | Access | Inputs | Returns |
| --- | --- | --- | --- |
| `list_entries` | all | `collection*`, `status?` (draft, ready, scheduled, archived), `search?`, `limit?` (1-100, default 20), `offset?` | `items[]` (id, slug, status, live, pendingRelease, title, version), `total`, `nextOffset` |
| `get_entry` | all | `id*`, `includePublished?` | `fields`, `seo`, `status`, `live`, `pendingRelease`, `editedSinceReady`, `version`. With `includePublished`, also `liveFields` and `approvedFields`. |
| `create_entry` | all | `collection*`, `fields?`, `seo?` | New draft + `previewUrl` |
| `update_entry` | all | `id*`, `fields?`, `seo?` (at least one), `expectedVersion?` | Updated draft + `previewUrl`. Keys you leave out keep their values. |
| `list_revisions` | all | `id*` | Revision id, note, createdAt, createdBy |
| `get_preview_url` | all | `id*` | `{ url }`, signed, about 1 hour. Fails without a site production URL. |

## Workflow

| Tool | Access | Inputs | Effect |
| --- | --- | --- | --- |
| `mark_ready` | owner | `id*` | Approves the current draft for the next release. Not live yet. |
| `unpublish_entry` | owner | `id*` | Takes it out of the release and back to draft. Removed from the live site at the next go live. |
| `archive_entry` | owner | `id*` | Archives it. Removed from the live site at the next go live. |
| `cancel_schedule` | owner | `id*` | Clears the scheduled time |
| `delete_entry` | owner | `id*` | Deletes permanently. Destructive. |
| `restore_revision` | owner | `id*`, `revisionId*`, `expectedVersion?` | Copies a revision into the draft and returns `skippedFields`. Doesn't mark it ready. |
| `schedule_entry` | go-live | `id*`, `publishAt*` (future ISO 8601 with offset), `timezone*` (IANA, e.g. `Europe/Amsterdam`) | Goes live at that time, together with the site's other ready changes |

## Library (assets)

| Tool | Access | Inputs | Returns |
| --- | --- | --- | --- |
| `list_assets` | all | `search?`, `limit?` (1-100), `offset?` | assetId, filename, mimeType, width, height, alt, url |
| `get_asset` | all | `id*` | Asset + `usageCount` |
| `upload_asset_from_url` | all | `url*` (direct http(s) file link), `altText?`, `filename?` | Asset with `assetId` + `howToUse` |
| `update_asset_alt` | all | `id*`, `altText*` (`""` clears) | Asset |
| `delete_asset` | owner | `id*` | Refused while the asset is in use |

## Publishing

| Tool | Access | Inputs | Returns |
| --- | --- | --- | --- |
| `get_release_status` | all | none | `publishingMode`, `live`, `demo`, `activeJob`, `pendingCount`, `pendingChanges[]` |
| `list_publications` | all | `limit?` (1-50, default 10) | Publications, newest first |
| `get_build_job` | all | `jobId*` | Status, attempts, timing, error |
| `go_live` | go-live | `note?` | Queues a build that publishes **all** ready changes and returns `publicationId` and `jobId`. Poll `get_build_job`. |
| `rollback` | go-live | `publicationId*` | Queues a rollback to an earlier publication |
| `cancel_build` | go-live | `jobId*` | Cancels a queued build |

## Content types (agency)

| Tool | Access | Inputs | Effect |
| --- | --- | --- | --- |
| `upsert_collection` | agency | `key*`, `label*`, `routePattern*`, `fields*` (up to 100: `key*`, `label*`, `type*`, `required?`, `options?`, `collection?`, `description?`, `after?`), `enabled?` | Creates the collection or **replaces** its field list. Prefer `areca.config.ts` + `areca manifest push` when the site syncs its schema from code. |
| `delete_collection` | agency | `key*` | Deletes the collection and its entries. Destructive. |

## Prompt

`write_post({ collection*, topic* })` returns a step-by-step writing brief: schema, images, draft and SEO. It ends with "mark ready or go live only when asked".
