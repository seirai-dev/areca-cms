# Site content (globals)

Status: implemented. This is the design note written before the feature was built; the code and the [docs site](https://docs.arecacms.com) are the source of truth where they differ.

## What it is

Single-instance content sections per site, for copy that is not a list of
entries: company info (email, phone, address, headcount), home-page hero copy,
about-page text, stats. The agency defines **sections** (each with its own
fields, same field types as collections). Site owners and editors only fill
them in.

- CMS UI name: **Site content** (one sidebar group, one item per section).
- Code/SDK/API name: **globals** (`content.globals.companyInfo.email`).
- A site can have zero or more sections. Nothing shows for editors unless the
  agency has created and enabled at least one.

## Decisions

| Topic | Decision |
|---|---|
| Cardinality | Several named sections per site (`companyInfo`, `homePage`, ...). |
| Publishing | Same flow as entries: draft autosave, owner marks ready, ships with next Go Live; appears in pending changes. |
| Schema source | Both CMS UI (agency) and `areca.config.ts` (`globals: {}`), synced by `areca manifest push` / `pull`. |
| SEO | Opt-in per section (`seo: true`). Gives the section the same `$seo` panel entries have; exposed as `$seo` on the SDK value. No automatic fallback for entries. |
| SDK shape | `content.globals.<camelKey>` returns the camelCased field values directly plus `$seo` (only when SEO is on). |
| Empty state | Required fields are typed non-null. Go Live is blocked while an enabled section that has required fields has never been made ready (or its ready data fails validation). Sections with no required fields ship `{}` until first ready. |
| Features | Revisions/history + restore, scheduling, live preview, discard draft. No unpublish/archive/delete of the single entry. |
| References | Section fields may reference collection entries. Collections may not reference sections. |
| Field types | All except `slug`. |
| Grouping | Optional `group` string on a section field: a visual heading in the editor only. SDK value stays flat. Not allowed on collection fields. |
| Lifecycle | Mirror collections: disable = hidden from editors, excluded from snapshot and SDK types, content kept. Delete = agency only, content archived in `deleted_content_archive`. Omitted from a manifest push = disabled. |
| Roles | Mirror entries. Editors: edit draft, discard draft, view history. Owners: + mark ready, schedule/cancel, restore revision, go live. Agency: + create/edit fields, enable/disable, SEO opt-in, preview path, delete. |
| MCP | Dedicated tools (see below). |
| Agency UX | Settings → Content tab lists Site content sections next to content types (same schema editor sheet). Agency also gets "Edit structure" / "Add section" in the sidebar group. |
| Preview | Real pages with draft overlay: the section has an optional `previewPath` (e.g. `/about`). CMS opens `<site><previewPath>?arecaPreview=<token>`; the site reads globals through `content.previewGlobals(token)`. |

## Storage (CMS)

Sections reuse the `collection` and `entry` tables so revisions, scheduling,
release diff, go live and audit all work unchanged.

Migration `0021_site_content_globals`:

- `collection.kind text not null default 'collection'` (`'collection' | 'global'`).
- `collection.seo_enabled boolean not null default false` (only read for globals; collections always have SEO).
- `collection.preview_path text null` (globals only; must start with `/`, no `?`/`#`, max 512 chars).
- Keys stay unique per site across both kinds (`collection_site_key_unique`).
- Globals store `route_pattern = ''`; it is never exposed.

Each global has **exactly one** entry row, created in the same transaction as
the global, with `slug = '$global'` (constant `GLOBAL_ENTRY_SLUG` in
`apps/cms/src/lib/globals.ts`). Entry status semantics are unchanged
(`draft` / `published` (= ready) / `scheduled`). `archived` is never used for
globals.

`Field` (CMS `lib/types.ts` and SDK `types.ts`) gains `group?: string`
(max 80 chars). Validation rejects `group` on collection fields and rejects
`slug` fields in globals.

Reserved keys: `globals` and `previewGlobals` join `resolve`, `href`, `preview` as reserved
**collection** key. Global keys follow the same identifier rules as
collection keys and may not be `globals`, `previewGlobals`, `resolve`, `href`, `preview`.

Reference fields (`type: 'reference'`) in either kind must target a
`kind = 'collection'` key.

## Wire contract

### Manifest (`GET`/`POST /api/sites/manifest`, SDK `SiteManifest`)

```ts
type GlobalConfig = {
  label?: string
  fields: readonly Field[]      // no slug fields; may use `group`
  seo?: boolean                 // default false
  previewPath?: string          // e.g. '/about'
}
type SiteManifest = {
  collections: Record<string, CollectionConfig>
  globals?: Record<string, GlobalConfig>   // omitted/empty when none
}
```

Like collections, a `POST` is a full sync: a push without `globals` disables
every global (content kept). `GET` only lists enabled globals and omits the key when
there are none.

### Snapshot (`GET /api/sites/snapshot/current`, SDK `Snapshot`)

```ts
type SnapshotGlobal = {
  id: string                    // entry id
  publishedAt: string | null
  data: Record<string, unknown> // raw CMS keys, same value encoding as entries
  seo?: SeoMeta                 // only when the global has seo enabled
}
type Snapshot = {
  // ...existing fields
  globals?: Record<string, SnapshotGlobal>        // enabled globals, raw keys
  globalSchema?: Record<string, GlobalConfig>     // schema for exactly those globals
}
```

- Every enabled global is present in `globals` (data `{}` if never ready and
  it has no required fields).
- `hash`: when `globals` is non-empty, hash `{ collections, globals }`;
  otherwise hash `collections` exactly as today, so sites without globals keep
  identical hashes.
- Release diff / pending changes include global entries (label = section
  label, e.g. "Company info"), with kinds `ready` / `scheduled`.
- `buildSnapshot` adds an error (blocking go live) per enabled global with
  required fields and no ready/due-scheduled data:
  `Site content "<label>" has required fields and has never been marked ready.`

### Preview (`GET /api/sites/preview?token=`)

Preview tokens gain an optional `global` key. For a global token the response is:

```ts
{ kind: 'global', global: string /* raw key */, entry: SnapshotGlobal }
```

Entry previews keep their current shape and gain `kind: 'entry'`. The CMS
builds global preview URLs as `<previewBase><previewPath>?arecaPreview=<token>`
(same base the entry preview uses). Without a `previewPath`, preview is
unavailable for that section (UI explains why; agency can set it).

## SDK (`@areca-cms/site-sdk`)

Config:

```ts
export default defineSiteContent({
  siteKey: 'demo',
  collections: { /* ... */ },
  globals: {
    companyInfo: {
      label: 'Company info',
      fields: [
        { key: 'email', label: 'Email', type: 'text', required: true, group: 'Contact' },
        { key: 'featured', label: 'Featured', type: 'reference', collection: 'coffees' },
      ],
    },
    homePage: { label: 'Home page', seo: true, previewPath: '/', fields: [/* ... */] },
  },
})
```

- `defineSiteContent` type-checks globals like collections: no `slug` type,
  reference `collection` must be a collection key, `after` must be a date key
  in the same global, `options` literal unions preserved.
- `manifestFromConfig` emits `globals` only when non-empty.

Pull:

- `validateSnapshot` validates each global against `globalSchema`
  (same `entryIssues`).
- `camelizeSnapshot` camelCases global keys and field keys.
- Globals are written to `<generation>/_globals.json` as
  `Record<camelKey, SnapshotGlobal>` (leading `_` cannot collide with a
  collection key). `PulledContentManifest` gains `globals?: string[]`
  (camel keys). Asset localisation applies to globals too.

Typegen (`areca.gen.ts`):

- `export const globalSchema = { companyInfo: { key, label, seo, fields: {...} } } as const`
  (emitted as `{}` when there are none).
- `Register` gains `globals: typeof globalSchema`.
- `export type CompanyInfoGlobal = Global<'companyInfo'>` per global.

Runtime (`createContent({ schema, globalSchema?, dir })`):

- `content.globals` is a getter returning an object keyed by camel global key;
  each value is the typed field data (`EntryData`-style mapping) plus
  `$seo: SeoMeta` when the global has `seo: true`. Reads follow the same
  per-generation caching as collections.
- `await content.previewGlobals(source: string | PreviewResult | null | undefined, options?)`
  returns `GlobalsPreview<G>` = `{ globals, previewing, complete, issues }`.
  `previewing` is the camel key of the section the token targets, or `null` for
  a falsy token, an entry token or any other result kind. A draft is validated
  with the same validator as `content.preview()`, against the section's schema
  (camel issue keys, `<field>: <problem>`). A valid draft replaces the section
  in `globals` (after camelCasing and asset URL handling). An invalid draft keeps
  the published section, sets `complete: false` and returns the issues. A falsy
  token or an entry token returns `{ globals: content.globals, previewing: null,
  complete: true, issues: [] }`.
- Types: `Global<K>`, `GlobalKey`, `Globals`, `GlobalsPreview` exported from the package root.
  Without a registered schema, `content.globals` is `Record<string, Record<string, unknown>>`.

## CMS UI

- Sidebar: "Site content" group listing enabled sections (agency also sees
  disabled ones, dimmed). Hidden entirely for non-agency when none are enabled.
  Agency sees "Add section" and "Edit structure".
- Route: `/sites/$siteId/globals/$globalKey`: single-form editor reusing the
  entry editor pieces (field controls, autosave, conflict handling, recovery,
  history panel, schedule form, SEO panel when enabled). Fields with a `group`
  render under a heading when the group changes. Top bar: Mark as ready,
  Schedule/Cancel schedule, Discard draft, Preview (if `previewPath`), History.
  No unpublish/archive/delete.
- Settings → Content: a "Site content" section listing sections with enable
  toggle; the schema editor sheet in "global" mode: label, key, SEO toggle,
  preview path, fields (no slug, no route pattern) with a "Group heading"
  input per field.
- Cmd+K: "Go to" lists enabled sections.
- Pending-changes / go-live panel shows section changes with their label.
- All strings in `apps/cms/messages/{en,nl,tr}.json`.

## Server functions (authz)

| Function | Access |
|---|---|
| `listGlobalsFn`, `getGlobalFn` | org-editor (disabled ones only for agency) |
| `updateGlobalDraftFn` (or `updateDraftFn` on the entry id) | org-editor |
| `discardGlobalDraftFn` | org-editor |
| mark ready / schedule / cancel schedule / restore revision | org-owner (existing entry fns, by entry id) |
| `upsertGlobalFn`, `deleteGlobalFn`, `setGlobalEnabledFn` | agency |

Existing `unpublishEntryFn`, `archiveEntryFn`, `deleteEntryFn`, `createEntryFn`
must refuse global entries/collections. `listCollectionsFn` and
`listEntriesFn` only return `kind = 'collection'`. Every new function is added
to `server/security/authz-matrix.ts` and `docs/AUTHZ_MATRIX.md`.

Discard draft: sets `draftData` back to the ready data (`publishedData`, or
`scheduledData` when scheduled), bumps `draftVersion`, writes a revision with
note `discard`. Not available when the global was never ready.

## MCP

- `get_site_info`: adds `globals[]` (`key, label, enabled, fieldCount, seo, previewPath`) and a line in `guide`.
- `get_global({ global })` (everyone): `id`, `key`, `label`, `status`, `live`, `pendingRelease`, `version`, `editedSinceReady`, `fields` (schema, same format as `get_collection_schema`), `example`, `values`, `seo` (if enabled), `previewAvailable`.
- `update_global({ global, fields?, seo?, expectedVersion? })` (everyone): partial update like `update_entry`.
- `discard_global_draft({ global })` (everyone).
- `mark_ready`, `schedule_entry`, `cancel_schedule`, `list_revisions`, `restore_revision`, `get_preview_url` accept the global's entry `id`.
- `unpublish_entry`, `archive_entry`, `delete_entry` refuse global ids with a clear message.
- `upsert_global({ key, label, fields, seo?, previewPath?, enabled? })`, `delete_global({ key })`: agency only.
- Server instructions mention site content / globals.

## Docs, skills, example

- `docs/`: CONTENT_SCHEMA, SDK, API, MCP, AUTHZ_MATRIX, ARCHITECTURE, DECISIONS, CMS_GUIDE, ADMIN_GUIDE.
- `apps/docs`: new `sdk/globals.mdx` and `cms/site-content.mdx`; update defining-content, typed-content, reading-content, schema-sync, field-types, mcp-tools, permissions-matrix, roles-and-permissions, example-site, preview.
- `skills/areca-sdk` (remove "There are no singletons") and `skills/areca-mcp` (new tools; `drift.test.ts` must pass).
- `examples/demo-site`: globals `companyInfo` (footer, SITE_NAME, contact), `homePage` (hero, featured coffee reference, SEO, previewPath `/`), `aboutPage` (heading, body richtext, image, stats, SEO, previewPath `/about`); preview overlay via `?arecaPreview`; fixture content; regenerated `areca.gen.ts`.
- SDK and skills versions: do NOT edit `version` or `CHANGELOG.md` by hand. The
  release workflow (`docs/DEVELOPMENT.md` → Releasing packages) bumps minor
  and writes the changelog from `feat:` commit subjects.
