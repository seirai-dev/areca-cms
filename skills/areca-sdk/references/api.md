# @areca-cms/site-sdk API reference

ESM only. Import paths and their exports:

## `@areca-cms/site-sdk`

| Export | Signature | Notes |
| --- | --- | --- |
| `defineSiteContent` | `<T extends SiteContentConfig>(config: T) => T` | Identity helper for `areca.config.ts` default export |
| `manifestFromConfig` | `(config: SiteContentConfig) => SiteManifest` | Validates identifiers and duplicates, returns `{ collections }` |
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

Types: `ArecaClient`, `ArecaClientOptions`, `SiteContentConfig`, `CollectionConfig` (`{ route; label?; fields: Field[] }`), `Field` (`{ key; label; type: FieldType; required?; options?; collection?; description?; after? }`), `FieldType`, `SiteManifest`, `Snapshot` (`{ publicationId, siteKey, createdAt, hash, collections: Record<string, SnapshotEntry[]>, assets?: SnapshotAsset[], siteUrl? }`), `SnapshotAsset` (`{ id, storageKey, url, filename, mimeType, size }`), `AssetsConfig` (`{ download?, dir?, publicPath? }`), `SnapshotEntry` (`{ id, slug, publishedAt: string | null, data: Record<string, unknown>, seo?: SeoMeta }`), `ImageValue`, `ReferenceValue`, `RichTextValue`, `SeoMeta`, `PreviewResult`, `PulledContentManifest`, `HeadMeta`, `HeadLink`, `HeadScript`, `SeoHeadOptions`, `SeoHeadResult`.

## `@areca-cms/site-sdk/pull` (Node only)

| Export | Signature | Notes |
| --- | --- | --- |
| `pullContent` | `({ outDir: string; client?: ArecaClient; publicationId?: string; assets?: { dir: string; publicPath: string } }) => Promise<PullContentResult>` | With `assets`, downloads media into `dir` (absolute) and rewrites URLs to `publicPath`. Writes `outDir/.publications/publication-<random>/<collection>.json`, then atomically swaps `manifest.json`, which records the `publicationId`. Keeps the current and two previous generations. Defaults `publicationId` to `ARECA_SNAPSHOT_ID`. A failed pull keeps the previous generation. Result (`PullContentResult`) adds `localAssets?` and `warnings`. The `assets` option type is `ResolvedAssets`. |
| `readContentManifest` | `(outDir: string) => PulledContentManifest` | `{ publicationId, hash, createdAt, collections counts, ... }` |
| `readContent` | `<T = SnapshotEntry>(outDir: string, collectionKey: string, manifest?: PulledContentManifest) => T[]` | Throws `No content file for collection "x" ... Run \`areca pull\` first.` |

Type: `PullContentOptions`.

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

`PulledContentManifest` = `{ publicationId, hash, createdAt, collections: Record<string, number>, generation? }`.
