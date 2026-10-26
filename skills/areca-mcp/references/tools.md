# Areca MCP tools

`*` means required. Access: **all** = every role, **owner** = owners and agency admins, **go-live** = also needs "Allow going live" on the connection or key, **agency** = agency admins only. Tools a caller cannot use are not listed by the server.

## Site and schema

| Tool | Access | Inputs | Returns |
| --- | --- | --- | --- |
| `get_site_info` | all | none | `site` (name, slug, productionUrl, publishingMode, deploymentConfigured), `you` (role, capabilities), `cannotDo[]`, `collections[]`, `globals[]` (site content: key, label, enabled, fieldCount, seo, previewPath), `guide`. On a site with languages also `languages` (`main`, `all`, `names`) and, per collection and section, `requiredLanguages`, `translatableFields` and `routes`. **Call first.** |
| `get_collection_schema` | all | `collection*` | Per-field key, type, required, format, options (and `translatable` on sites with languages); example `fields` and `seo` payloads; SEO guide; `translation` example on sites with languages |

## Entries

| Tool | Access | Inputs | Returns |
| --- | --- | --- | --- |
| `list_entries` | all | `collection*`, `status?` (draft, ready, scheduled, archived), `search?`, `limit?` (1-100, default 20), `offset?`, `missingLanguage?` (languages sites: only entries whose draft is not complete in that language) | `items[]` (id, slug, status, live, pendingRelease, title, version), `total`, `nextOffset` |
| `get_entry` | all | `id*`, `includePublished?`, `locale?` (languages sites) | `fields`, `seo`, `status`, `live`, `pendingRelease`, `editedSinceReady`, `version`. With `includePublished`, also `liveFields` and `approvedFields`. With `locale`, that language's values (slug and seo included) and `locale`. Without it on a languages site: the main language plus `translations` (`complete` and `missing` for each other language). |
| `create_entry` | all | `collection*`, `fields?`, `seo?`, `slug?`, `locale?` (languages sites) | New draft + `previewUrl`. `fields`, `seo` and `slug` apply to `locale` (default main). |
| `update_entry` | all | `id*`, `fields?`, `seo?`, `slug?` (at least one), `locale?` (languages sites), `expectedVersion?` | Updated draft + `previewUrl`. Keys you leave out keep their values. Languages sites: one language per call; `sharedFieldsUpdated` lists the non-translatable fields that changed in every language. |
| `list_revisions` | all | `id*` | Revision id, note, createdAt, createdBy |
| `get_preview_url` | all | `id*`, `locale?` (languages sites) | `{ url }`, signed, about 1 hour. Fails without a site production URL. |

## Site content (globals)

Single sections such as company info or the home page. Editors and owners see enabled sections only; agency admins see all of them. The `id` returned here is the entry id for the workflow tools below.

| Tool | Access | Inputs | Returns |
| --- | --- | --- | --- |
| `get_global` | all | `global*` (key from `get_site_info`), `locale?` (languages sites) | `id`, `key`, `label`, `status`, `live`, `pendingRelease`, `version`, `editedSinceReady`, `previewAvailable`, `values` (rich text as Markdown, images as `{assetId,url,alt}`, references as `{entryId}`), `seo` (only with SEO on), `fields` (format of each field), `example` |
| `update_global` | all | `global*`, `fields?`, `seo?` (at least one; refused without SEO on the section), `locale?` (languages sites), `expectedVersion?` | Updated draft + `previewUrl`. Keys you leave out keep their values. |
| `discard_global_draft` | all | `global*` | Draft reset to the ready values, kept in history. Refused when the section was never ready. |

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

`mark_ready`, `schedule_entry`, `cancel_schedule`, `list_revisions`, `restore_revision` and `get_preview_url` also take a site content section's `id`. `unpublish_entry`, `archive_entry` and `delete_entry` refuse it: change the section instead.

## Library (assets)

| Tool | Access | Inputs | Returns |
| --- | --- | --- | --- |
| `list_assets` | all | `search?`, `limit?` (1-100), `offset?` | assetId, filename, mimeType, width, height, alt, url |
| `get_asset` | all | `id*` | Asset + `usageCount` |
| `upload_asset_from_url` | all | `url*` (direct http(s) file link), `altText?`, `filename?` | Asset with `assetId` + `howToUse` |
| `update_asset_alt` | all | `id*`, `altText*` (`""` clears), `locale?` (languages sites: alt text for that language) | Asset |
| `delete_asset` | owner | `id*` | Refused while the asset is in use |

## Publishing

| Tool | Access | Inputs | Returns |
| --- | --- | --- | --- |
| `get_release_status` | all | none | `publishingMode`, `live`, `demo`, `activeJob`, `pendingCount`, `pendingChanges[]` |
| `set_publishing_mode` | agency | `mode*` (`demo` or `production`) | `publishingMode`, `deploymentConfigured`. `demo`: `go_live` builds a release that `areca pull` can fetch without a deployment; demo releases never reach visitors. `production`: `go_live` deploys to the live site and needs a deployment target (application ID and health check URL, set in Settings › Deployment). Refused with a conflict when switching to `demo` after the site has ever gone live, or to `production` without a deployment target. The same mode changes nothing and writes no audit entry. Each change is audited with the MCP caller. |
| `list_publications` | all | `limit?` (1-50, default 10) | Publications, newest first |
| `get_build_job` | all | `jobId*` | Status, attempts, timing, error |
| `go_live` | go-live | `note?` | Queues a build that publishes **all** ready changes and returns `publicationId` and `jobId`. Poll `get_build_job`. |
| `rollback` | go-live | `publicationId*` | Queues a rollback to an earlier publication |
| `cancel_build` | go-live | `jobId*` | Cancels a queued build |

## Content types (agency)

| Tool | Access | Inputs | Effect |
| --- | --- | --- | --- |
| `upsert_collection` | agency | `key*`, `label*`, `routePattern*`, `fields*` (up to 100: `key*`, `label*`, `type*`, `required?`, `options?`, `collection?`, `description?`, `after?`, `translatable?` on languages sites), `enabled?`, `requiredLanguages?`, `routes?` (languages sites) | Creates the collection or **replaces** its field list. Prefer `areca.config.ts` + `areca manifest push` when the site syncs its schema from code. |
| `delete_collection` | agency | `key*` | Deletes the collection and its entries. Destructive. |
| `upsert_global` | agency | `key*`, `label*`, `fields*` (as `upsert_collection`, plus `group?` heading; no `slug` type), `seo?`, `previewPath?` (e.g. `/about`, `""` removes it), `enabled?`, `requiredLanguages?` (languages sites) | Creates the site content section or **replaces** its fields, SEO setting, preview path and enabled flag. Keeps its content. |
| `delete_global` | agency | `key*` | Deletes the section. Its content is kept in the deleted-content archive. Destructive. |

## Languages (agency)

| Tool | Access | Inputs | Returns |
| --- | --- | --- | --- |
| `set_site_languages` | agency | `main*` (must be in `all`), `all*` (every language in display order, including `main`) | `languages` (main, all, names) and `gaps`: entries and sections not complete in the new main language. Removing a language hides it and keeps its text. Languages cannot be turned off once set. |

On a site without languages none of the `locale`, `translations`, `missingLanguage`, `translatable` or `requiredLanguages` parameters appear, and their results are unchanged. See [languages.md](languages.md) for the workflow.

## Prompt

`write_post({ collection*, topic* })` returns a step-by-step writing brief: schema, images, draft and SEO. It ends with "mark ready or go live only when asked".
