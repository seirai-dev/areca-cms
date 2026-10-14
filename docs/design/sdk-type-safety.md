# SDK end-to-end type safety — spec

Status: agreed with the maintainer on 2026-10-14. This file is the contract for
the implementation. Names and signatures below are binding; anything not
specified is the implementer's call, as long as it matches the surrounding code.

Goal: "the TanStack experience". After `areca pull`, every collection key,
field key, field value, select option, reference target and route is typed and
autocompletes, with no hand-written types, no explicit generics and no `as`
casts in app code.

## Decisions (from the requirements rounds)

| Topic | Decision |
|---|---|
| Type source | `areca pull` generates `areca.gen.ts` (like TanStack Router's `routeTree.gen.ts`) with a `Register` module augmentation. |
| Schema source | The CMS embeds the collection schema in each publication snapshot. Older publications without it: fall back to `GET /api/sites/manifest` and print a warning. |
| Read API | Generated, ready-to-import typed `content` object with a small query layer. `readContent` stays as the typed low-level primitive. |
| Nullability | Mirror the raw data. Optional values keep every shape the CMS can send (`null`, `''`, missing). No normalisation. |
| References | `ReferenceValue<'authors'>`, typed `content.resolve(ref)`, opt-in expansion `all({ with: { author: true } })` (one level). |
| Queries | `where` (equality + type-aware operators), `orderBy`, `limit`, `offset`. In-memory. |
| Config authoring | Discriminated field union, reference `collection` autocompletes collection keys, `after` only accepts sibling date/datetime keys, `route` must contain `$slug`. |
| Runtime validation | At pull only. Mismatch fails the pull before the generation swap. |
| Routes | `href()` helpers returning template-literal types. No router dependency. |
| Gen file | `<out>/areca.gen.ts`, committed to git. `--types <path>` overrides. |
| Compat | 0.x, break freely. Ship as 0.4.0 with a CHANGELOG migration note. Demo migrates. |
| Runtime | Node `fs` only (server side). |
| Key naming | camelCase. Done **at pull**: the pulled JSON, the generated schema, every read API, `where`/`orderBy` use camelCase. `areca.config.ts` and the CMS keep raw keys. |
| Wiring | `areca.gen.ts` exports a ready `content` bound to the pull's `--out` dir, overridable with `ARECA_CONTENT_DIR`. The SDK also exports `createContent`. |
| Collateral | Demo site migration, docs site + README + docs/SDK.md + CHANGELOG, agent skills. |

## 1. CMS change (apps/cms)

- When a publication snapshot is built (`server/content/snapshot.ts`), add
  `schema: Record<rawCollectionKey, { route: string; label?: string; fields: Field[] }>`
  for exactly the collections in `snapshot.collections` (same shape as
  `GET /api/sites/manifest` collections, including the forced `slug` field).
- `Snapshot` in `apps/cms/src/lib/types.ts` gains `schema?: ...` (optional,
  because stored older publications do not have it).
- `snapshot.hash` semantics do not change (still over `collections` only).
- `GET /api/sites/snapshot/current` returns it untouched. Preview responses do
  not need it.

## 2. camelCase rule (SDK, at pull)

`toCamelKey(raw)`: split on `-` and `_`; keep the first segment unchanged;
upper-case the first character of every later segment; join. Empty segments
are dropped. Examples: `blog-posts → blogPosts`, `cover_image → coverImage`,
`title → title`, `heroImage → heroImage`, `a-b-c → aBC`.

Pull fails (before writing anything) when:
- two collection keys, or two field keys in one collection, map to the same
  camel key (message names both raw keys);
- two camel collection keys differ only by case (existing rule, now on camel keys);
- a camel collection key is one of the content object's reserved names:
  `resolve`, `href`, `preview`, `globals`, `previewGlobals`. These are reserved for **collection keys only**
  (field keys may use them): add an `isReservedCollectionKey` check in both
  `packages/site-sdk/src/identifiers.ts` (used by `manifestFromConfig` and the
  pull) and `apps/cms/src/lib/content-identifiers.ts` (used where collection
  definitions are validated), so they are rejected at push time. Do not add them
  to the shared `isSafeIdentifier` reserved list.

The pull rewrites, per entry: `data` keys → camel; `ReferenceValue.collection`
→ camel collection key (inside `data`, any depth that is a reference value of
a reference field); collection file names → `<camelKey>.json`;
`PulledContentManifest.collections` keys → camel. `seo`, `id`, `slug`,
`publishedAt` are unchanged. Each pulled entry also gets
`collection: <camelKey>` (added by the SDK; used for discriminated unions).

## 3. Validation at pull

Against the publication schema (raw keys, before camelCasing). For each entry:
- `data` must be an object; unknown keys are an error.
- Required field: present, not `null`, not `''`, and the type's shape.
- Optional field: missing, `null`, or the type's shape; plus `''` for
  text/textarea/url/select/slug/date/datetime/image/reference/richtext.
- Shapes: text/textarea/url/slug → string; select → string, and one of
  `options` when `options` is non-empty; date → `YYYY-MM-DD`; datetime →
  string with `Date.parse` not NaN; number → finite number; boolean → boolean;
  image → `{ url: string, width: number|null, height: number|null, alt: string, mimeType: string }`;
  reference → `{ collection: string, slug: string, id: string }` with
  `collection === field.collection`; richtext → object with string `markdown`,
  string `html`, object `document`, `json` present.
- Errors are collected (cap 20) and thrown as one `Error` listing
  `<collection>/<slug>.<field>: <problem>`. Nothing is written.

## 4. Generated file `areca.gen.ts`

Written by `areca pull` (atomically, after the generation swap succeeds) to
`--types <path>` or by default `<out>/areca.gen.ts`. Deterministic output
(sorted collection keys, schema field order kept), header comment
`// This file is generated by \`areca pull\`. Do not edit.` and
`/* eslint-disable */`. Shape:

```ts
// This file is generated by `areca pull`. Do not edit.
/* eslint-disable */
import { createContent } from '@areca-cms/site-sdk/content'
import type { Entry } from '@areca-cms/site-sdk'

export const schema = {
  /** Blog posts */
  blogPosts: {
    key: 'blog-posts',
    label: 'Blog posts',
    route: '/blog/$slug',
    fields: {
      /** Slug */
      slug: { key: 'slug', type: 'slug', required: true },
      /** Title — Shown as the page heading. */
      title: { key: 'title', type: 'text', required: true },
      /** Cover image */
      coverImage: { key: 'cover-image', type: 'image', required: false },
      /** Category */
      category: { key: 'category', type: 'select', required: false, options: ['news', 'guides'] },
      /** Author */
      author: { key: 'author', type: 'reference', required: false, collection: 'authors' },
    },
  },
  authors: { ... },
} as const

declare module '@areca-cms/site-sdk' {
  interface Register {
    schema: typeof schema
  }
}

export type BlogPostsEntry = Entry<'blogPosts'>
export type AuthorsEntry = Entry<'authors'>

export const content = createContent({
  schema,
  dir: process.env.ARECA_CONTENT_DIR ?? 'src/generated/content',
})
```

- JSDoc on each collection = label; on each field = `label` or
  `label — description`. Comment text must be escaped so `*/` cannot break out.
- `key` is the raw CMS key. `collection` on references is the **camel** target key.
- `required` is always emitted as a boolean. `options` only when non-empty.
- The `dir` literal is the `--out` value as passed (relative to cwd), quoted
  with the same escaping as `generate-config.ts`.
- With zero collections, emit `schema = {} as const` and still register it.

## 5. Public types (root export `@areca-cms/site-sdk`)

```ts
export interface Register {}              // augmented by areca.gen.ts

export type ContentSchemaField = {
  key: string; type: FieldType; required: boolean
  options?: readonly string[]; collection?: string; label?: string; description?: string
}
export type ContentSchemaCollection = {
  key: string; label?: string; route: string
  fields: { readonly [fieldKey: string]: ContentSchemaField }
}
export type ContentSchema = { readonly [collectionKey: string]: ContentSchemaCollection }

/** Registered schema, or the loose `ContentSchema` when nothing is registered. */
export type RegisteredSchema = Register extends { schema: infer S extends ContentSchema } ? S : ContentSchema
```

Every helper below takes the schema as its **last** generic, defaulting to
`RegisteredSchema`, so tests can pass a schema explicitly:

- `CollectionKey<S>` = `keyof S & string`
- `FieldKey<C, S>` = field keys of collection `C`
- `FieldValue<C, F, S>` = value type of one field (table below)
- `EntryData<C, S>` = `{ [K in keyof S[C]['fields']]: FieldValue<C, K, S> }` —
  **must be a homomorphic mapped type** over `S[C]['fields']` so hover and
  go-to-definition on `entry.data.title` reach the generated schema property and
  show its JSDoc.
- `Entry<C, S>` = `{ id: string; slug: string; publishedAt: string | null; collection: C; data: EntryData<C, S>; seo?: SeoMeta }`
- `AnyEntry<S>` = union of `Entry<C, S>` over all `C` (discriminated on `collection`)
- `ReferenceValue<C extends string = string>` = `{ collection: C; slug: string; id: string }`
- `Where<C, S>`, `OrderBy<C, S>`, `QueryOptions<C, S>`, `QueryResult<C, O, S>`
- `RoutePath<R extends string>`: replaces `$slug` in the route literal with
  `${string}` (`'/blog/$slug'` → `` `/blog/${string}` ``); a plain `string`
  route stays `string`.
- `Href<C, S>` = `RoutePath<S[C]['route']>`
- `Content<S>`: type of the content object (section 6).

Value table (`R` = required, `O` = optional):

| type | R | O |
|---|---|---|
| text, textarea, url, slug | `string` | `string \| null \| undefined` |
| select (options `'a'\|'b'`) | `'a' \| 'b'` | `'a' \| 'b' \| '' \| null \| undefined` |
| select (no options) | `string` | `string \| null \| undefined` |
| date, datetime | `string` | `string \| null \| undefined` |
| number | `number` | `number \| null \| undefined` |
| boolean | `boolean` | `boolean \| null \| undefined` |
| image | `ImageValue` | `ImageValue \| '' \| null \| undefined` |
| reference → `authors` | `ReferenceValue<'authors'>` | `ReferenceValue<'authors'> \| '' \| null \| undefined` |
| richtext | `RichTextValue` | `RichTextValue \| '' \| null \| undefined` |

With the loose (unregistered) schema everything degrades gracefully: collection
and field keys are `string`, values are `unknown`. Nothing may resolve to `never`
in the unregistered case.

### Config authoring (`defineSiteContent`)

```ts
export function defineSiteContent<
  const TCollections extends { [K in keyof TCollections]: CollectionInput<keyof TCollections & string, TCollections[K]> },
>(config: { siteKey: string; collections: TCollections; assets?: AssetsConfig }): { siteKey: string; collections: TCollections; assets?: AssetsConfig }
```

Required behaviour (each one has a type test):
- `type` autocompletes the 12 field types.
- `options` is only allowed on `select`; `collection` is **required** on
  `reference` and only allowed there; `after` only on `date`/`datetime`.
- `collection: '...'` autocompletes and is checked against the collection keys
  of the same config.
- `after: '...'` only accepts keys of `date`/`datetime` fields in the same
  collection (and autocompletes them).
- `route` must match `` `${string}$slug${string}` ``.
- The result is still assignable to `SiteContentConfig` (wire type), so
  `manifestFromConfig`, `loadConfig` and `generateConfigSource` keep working.
- `Field` (wire type) becomes the discriminated union; `generate-config.ts`
  output must still typecheck against `defineSiteContent`.

## 6. Content object (`@areca-cms/site-sdk/content`, new subpath, node only)

```ts
export function createContent<const S extends ContentSchema>(options: { schema: S; dir: string }): Content<S>
```

`Content<S>`:

```ts
{
  [C in CollectionKey<S>]: CollectionApi<C, S>
} & {
  resolve<C extends CollectionKey<S>>(ref: ReferenceValue<C>): Entry<C, S> | null
  resolve(ref: '' | null | undefined): null
  // (and the union of the two: ReferenceValue<C> | '' | null | undefined → Entry<C, S> | null)
  href<C extends CollectionKey<S>>(ref: ReferenceValue<C> | Entry<C, S>): Href<C, S>
  preview(token: string, options?: { client?: ArecaClient }): Promise<PreviewEntry<S>>
}
```

`CollectionApi<C, S>`:

```ts
{
  all<const O extends QueryOptions<C, S> = {}>(options?: O): QueryResult<C, O, S>[]
  first<const O extends QueryOptions<C, S> = {}>(options?: O): QueryResult<C, O, S> | undefined
  get(slug: string): Entry<C, S> | undefined         // by entry.slug
  byId(id: string): Entry<C, S> | undefined
  href(entryOrSlug: Entry<C, S> | string): Href<C, S>
}
```

`QueryOptions<C, S>`:
- `where?: Where<C, S>` — keys are field keys of `C`. Value is either a direct
  value (equality) or an operator object. Operators offered **only** where the
  type supports them:
  - `eq`, `ne`: text, textarea, url, slug, select, date, datetime, number, boolean
  - `in`, `notIn`: text, textarea, url, slug, select (select: typed options array)
  - `gt`, `gte`, `lt`, `lte`: number, date, datetime (datetime compared by `Date.parse`, date by string)
  - `contains`: text, textarea, url, slug (case-insensitive)
  - `isNull: boolean`: optional fields only; "null" means `null`, `''` or missing
  - image, richtext, reference: only `isNull` (when optional)
  - Multiple keys are AND-ed.
- `orderBy?: { [K in sortable field]?: 'asc' | 'desc' } | Array<...>` —
  sortable = text, textarea, url, slug, select, date, datetime, number,
  boolean. Array = tie-breakers in order. Null/empty values always sort last.
  Without `orderBy` the order is the pulled order (CMS: newest `publishedAt` first).
- `limit?: number`, `offset?: number`.
- `with?: { [K in reference field keys]?: true }` — expands those references.
  `QueryResult` replaces `data[K]` with `Entry<Target, S> | null` for required
  refs and `Entry<Target, S> | null | undefined` for optional (an unresolvable,
  empty or missing ref becomes `null`/kept `undefined`). One level only.

Runtime behaviour:
- Reads `<dir>/manifest.json` on every call (cheap); parsed collection files
  are cached by `generation + collection`. `dir` is resolved against
  `process.cwd()` at call time.
- A collection missing from the pulled publication returns `[]` (not a throw).
- `resolve` looks up by `id` in the target collection.
- `href` substitutes `$slug` with the entry/ref slug (URI-encoded).
- `preview` calls `getPreviewEntry`. Preview data is a **draft** (the CMS builds
  it non-strictly from `draftData`: required fields may be empty, unresolvable
  references/images arrive as `null`). So `preview` validates the raw draft
  against the schema with the same per-entry rules as the pull (§3), then
  applies the camelCase transform (using `schema[*].key` to map raw → camel),
  and returns a result discriminated on both `collection` and `complete`
  (decision of 2026-10-14, after PR #24 review):

  ```ts
  type DraftEntryData<C, S> = { [K in keyof S[C]['fields']]: /* optional-row value of K, regardless of `required` */ }
  type DraftEntry<C, S> = Omit<Entry<C, S>, 'data'> & { data: DraftEntryData<C, S> } // written as a plain object type
  type PreviewEntry<S> = {
    [C in CollectionKey<S>]:
      | { collection: C; slug: string; complete: true; entry: Entry<C, S>; issues: [] }
      | { collection: C; slug: string; complete: false; entry: DraftEntry<C, S>; issues: string[] }
  }[CollectionKey<S>]
  ```

  `DraftEntryData` must be homomorphic (hover JSDoc). `issues` use camel field
  keys: `"<camelField>: <problem>"`. A complete draft can be rendered with the
  same components as a published entry. Unknown raw collection → throw.

`readContent` (in `./pull`) becomes typed:
`readContent<C extends CollectionKey>(outDir: string, collectionKey: C, manifest?: PulledContentManifest): Entry<C>[]`
(no caller-supplied `T`). Its runtime behaviour stays as today.

## 7. CLI

- `areca pull` gains `--types <path>`. After a successful pull it prints
  `Types: <path>`.
- `areca init` must make sure the gitignore keeps the pulled JSON ignored but
  **not** `areca.gen.ts` (e.g. ignore `<out>/*` plus `!<out>/areca.gen.ts`, or
  ignore `.publications/` and `manifest.json` only). Check what init writes today.
- When the schema came from the live-manifest fallback, print the warning:
  `Publication <id> has no embedded schema; types use the current CMS schema. Go live again to embed it.`

## 8. Tests (written before the implementation)

- Vitest typecheck mode for `src/**/*.test-d.ts` (`expectTypeOf`, `// @ts-expect-error`).
  Add a `test:types` script and make `pnpm test` run both.
- Language-service tests (`src/*.ls.test.ts`, run as normal vitest tests): use
  the `typescript` API (`ts.createLanguageService`) over an in-memory project to
  assert real **completions** (e.g. `content.` lists collections, `where: { `
  lists field keys, `collection: '` lists collection keys in `defineSiteContent`,
  `category: '` lists select options) and **quick info** (hover on
  `entry.data.title` shows the field's JSDoc label).
- End-to-end fixture: generate `areca.gen.ts` from a fixture snapshot, write it
  into a temp project that maps `@areca-cms/site-sdk` to the package `src`, and
  run the TypeScript compiler on app code with `expectTypeOf` and
  `@ts-expect-error` lines. It must compile with zero errors.
- Golden test for the generated file text.
- Runtime tests: camelCase transform, collision and reserved-name errors,
  validation errors, fallback to manifest + warning, query semantics (every
  operator, null handling, sort with nulls last, tie-breakers, limit/offset,
  `with`), `resolve`, `href`, `preview` narrowing and transform, caching by
  generation.
- CMS: snapshot includes `schema` for exactly the published collections; hash unchanged.
