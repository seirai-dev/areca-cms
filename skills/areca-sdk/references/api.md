# @areca-cms/site-sdk API reference

ESM only. Import paths and their exports:

## `@areca-cms/site-sdk`

| Export | Signature | Notes |
| --- | --- | --- |
| `defineSiteContent` | `<const T extends {...}>(config: { siteKey; collections: T; assets? }) => same object` | Identity helper for `areca.config.ts`. Checks at compile time: `options` only on `select`, `collection` required on `reference` and must be a collection key, `after` must name a date key, `route` contains `$slug` |
| `manifestFromConfig` | `(config: SiteContentConfig) => SiteManifest` | Validates identifiers, duplicates and reserved collection keys (`resolve`, `href`, `preview`), returns `{ collections }` |
| `createArecaClient` | `(options?: { cmsUrl?; siteToken?; schemaToken? }) => ArecaClient` | Falls back to `ARECA_CMS_URL`, `ARECA_SITE_TOKEN`, `ARECA_SCHEMA_TOKEN`; URL and site token required at creation |
| `getPreviewEntry` | `({ token: string; client?: ArecaClient }) => Promise<PreviewResult>` | `PreviewResult` = `{ collection, slug, entry }`. Needs `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` (or pass `client`). |
| `previewHeaders` | `() => { 'X-Robots-Tag': 'noindex, nofollow'; 'Cache-Control': 'no-store' }` | Apply to preview responses |
| `seoHead` | `(seo: SeoMeta \| null \| undefined, options?: SeoHeadOptions) => { title, meta, links, scripts }` | TanStack Router `head()` shape |
| `seoHeadHtml` | `(seo, options?) => string` | Escaped `<head>` HTML |
| `seoJsonLd` | `(seo) => string[]` | Escaped JSON-LD strings |
| `richTextDocument` | `(value: RichTextValue \| null \| undefined) => MarkdownDocument` | Parses `markdown` for old snapshots; empty root for null |
| `richTextMarkdown` | `(value) => string` | `''` when empty |
| `richTextHtml` | `(value) => string` | Static HTML; trusted CMS output only |

`SeoHeadOptions` = `{ titleTemplate?: string /* contains %s */ | ((title: string) => string); siteName?: string }`.

`ArecaClient` methods (plain `fetch`, no retries or caching):

| Method | HTTP | Auth |
| --- | --- | --- |
| `fetchManifest(): Promise<SiteManifest>` | `GET /api/sites/manifest` | site token |
| `syncManifest(config): Promise<{ ok: true }>` | `POST /api/sites/manifest` | schema token |
| `fetchSnapshot(opts?: { publicationId?: string }): Promise<Snapshot>` | `GET /api/sites/snapshot/current[?publicationId=]` | site token |
| `fetchPreview(token: string): Promise<PreviewResult>` | `GET /api/sites/preview?token=` | signed preview token |

Types from the main entry: `ArecaClient`, `ArecaClientOptions`, `SiteContentConfig`, `AssetsConfig` (`{ download?, dir?, publicPath? }`), `CollectionConfig` (`{ route; label?; fields: Field[] }`), `Field` (a union discriminated on `type`: `reference` requires `collection`, `select` takes `options`, `date` and `datetime` take `after`), `FieldType`, `SiteManifest`, `Snapshot` (`{ publicationId, siteKey, createdAt, hash, collections, assets?, siteUrl?, schema? }`), `SnapshotAsset` (`{ id, storageKey, url, filename, mimeType, size }`), `SnapshotEntry` (the raw entry: `{ id, slug, publishedAt: string | null, data: Record<string, unknown>, seo? }`), `ImageValue`, `ReferenceValue<C = string>` (`{ collection: C; slug; id }`), `RichTextValue`, `SeoMeta`, `PreviewResult`, `PulledContentManifest`, `HeadMeta`, `HeadLink`, `HeadScript`, `SeoHeadOptions`, `SeoHeadResult`.

Typed content types (main entry, generated against `Register`):

| Export | Meaning |
| --- | --- |
| `Register` | Interface that `areca.gen.ts` augments with `schema: typeof schema` |
| `ContentSchema`, `ContentSchemaCollection`, `ContentSchemaField` | Shape of the generated schema (`key`, `label?`, `route`, `fields`; field `key`, `type`, `required`, `options?`, `collection?`) |
| `RegisteredSchema` | The registered schema, or `ContentSchema` when nothing is registered |
| `CollectionKey<S>` | camelCase collection keys |
| `FieldKey<C, S>` | field keys of collection `C` |
| `FieldValue<C, F, S>` | value type of one field, with null, missing and `''` where the CMS sends them |
| `EntryData<C, S>` | `data` of collection `C` |
| `Entry<C, S>` | `{ id, slug, publishedAt, collection: C, data, seo? }` |
| `AnyEntry<S>` | union of the entries of every collection, discriminated on `collection` |
| `Where<C, S>` | `where` option: field keys with equality or operator objects |
| `OrderBy<C, S>` | `orderBy` option: sortable field keys with `'asc' \| 'desc'`, or an array |
| `QueryOptions<C, S>` | `where`, `orderBy`, `limit`, `offset`, `with` |
| `QueryResult<C, O, S>` | the entry type returned for query options `O`, with expanded references |
| `RoutePath<R>` | a route with `$slug` replaced by `${string}` |
| `Href<C, S>` | the route type of collection `C`, such as `` `/blog/${string}` `` |
| `Content<S>` | the content object: one property per collection, plus `resolve`, `href` and `preview` |
| `CollectionApi<C, S>` | `all`, `first`, `get`, `byId` and `href` of one collection |
| `PreviewEntry<S>` | the union returned by `content.preview`, narrowed by `collection` and `complete`: `{ collection, slug, complete: true, entry: Entry, issues: [] }` or `{ collection, slug, complete: false, entry: DraftEntry, issues: string[] }` |
| `DraftEntry<C, S>`, `DraftEntryData<C, S>` | the entry of an incomplete preview draft; every field has its optional type, whether or not it is required |

## `@areca-cms/site-sdk/content` (Node only)

| Export | Signature | Notes |
| --- | --- | --- |
| `createContent` | `<const S extends ContentSchema>(options: { schema: S; dir: string }) => Content<S>` | Builds the typed content object. `areca.gen.ts` calls it; use it only for another folder or schema. `dir` is resolved against `process.cwd()` on each call. Throws for a collection named `resolve`, `href` or `preview` |

`content` (exported by `areca.gen.ts`) has one property per collection: `all(options?)`, `first(options?)`, `get(slug)`, `byId(id)`, `href(entryOrSlug)`. It also has `resolve(ref)` (returns `Entry | null`), `href(ref)` and `preview(token, { client? })` (returns `PreviewEntry<S>`; check `complete` before using `entry` as published content). Queries run in memory. `get` and `byId` return `undefined` for unknown values. A collection missing from the publication returns `[]`.

## `@areca-cms/site-sdk/pull` (Node only)

| Export | Signature | Notes |
| --- | --- | --- |
| `pullContent` | `(options: PullContentOptions) => Promise<PullContentResult>` | Validates the publication against its schema, writes `outDir/.publications/publication-<random>/<camelCollection>.json`, switches `manifest.json`, then writes the types file. Keeps the current and two previous generations. Defaults `publicationId` to `ARECA_SNAPSHOT_ID`. A failed pull before the switch keeps the previous generation |
| `readContentManifest` | `(outDir: string) => PulledContentManifest` | `{ publicationId, hash, createdAt, collections counts, generation?, assets? }` |
| `readContent` | `<C extends CollectionKey>(outDir: string, collectionKey: C, manifest?: PulledContentManifest) => Entry<C>[]` | Typed by the collection key, no type parameter. Throws `No content file for collection "x" ... Run \`areca pull\` first.` |

`PullContentOptions` = `{ outDir: string; client?: ArecaClient; publicationId?: string; assets?: ResolvedAssets; types?: string /* default <outDir>/areca.gen.ts */; contentDir?: string /* written into the module, default outDir */ }`.

`ResolvedAssets` = `{ dir: string /* absolute */; publicPath: string }`.

`PullContentResult` = the snapshot as the CMS sent it, plus `schema`, `localAssets?` (`{ dir, total, downloaded }`), `warnings: string[]` and `typesPath`.

## Other subpaths

- `@areca-cms/site-sdk/seo`: `seoHead`, `seoHeadHtml`, `seoJsonLd` and their types.
- `@areca-cms/site-sdk/rich-text`: `richTextDocument`, `richTextMarkdown`, `richTextHtml`.
- `@areca-cms/site-sdk/rich-text-react`: `richTextComponents(components?: MarkdownComponents) => MarkdownComponents`. Wraps `img` so editor sizes are kept. Needs `react` (optional peer) and `@tanstack/markdown@1.0.0`.

## SeoMeta (snapshot `entry.seo`, already resolved with fallbacks)

```ts
{
  title: string; description: string | null; canonicalUrl: string | null;
  robots: { index: boolean; follow: boolean; content: string };
  focusKeyphrase: string | null;
  openGraph: { type: 'article' | 'website'; title; description; url; siteName; image: ImageValue | null; publishedTime; modifiedTime };
  twitter: { card: 'summary' | 'summary_large_image'; title; description; image: ImageValue | null };
  author: { name; url; bio } | null;
  summary: string | null; keyTakeaways: string[];
  faq: { question; answer }[]; about: { name; sameAs }[];
  jsonLd: Record<string, unknown>[]; // ready-to-embed objects
}
```

`seo` is missing on snapshots from older CMS versions. `seoHead` and `seoHeadHtml` then return empty head data.
