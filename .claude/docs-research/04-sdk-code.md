# @areca-cms/site-sdk: source-of-truth API reference (from code)

Scope: `packages/site-sdk/` (src, package.json, README.md) and `examples/demo-site/`.
Every statement below was read from source or tests in the working tree on 2026-10-09.
Where something could not be verified at runtime it is marked **(unverified)**.

Important: `packages/site-sdk/dist/` is stale (see section 12). Treat `src/` as truth.

---

## 1. Package metadata (`packages/site-sdk/package.json`)

| Field | Value |
| --- | --- |
| name | `@areca-cms/site-sdk` |
| version | `0.2.0` |
| license | MIT |
| type | `module` (ESM only, no CJS build) |
| sideEffects | `false` |
| main / types | `./dist/index.js` / `./dist/index.d.ts` |
| files | `["dist"]` |
| engines | `node >=22.6.0` |
| publishConfig | `access: public` |
| dependencies | `@clack/prompts ^1.8.1`, `@tanstack/markdown 0.0.15` (exact pin, no caret) |
| devDependencies | `@types/node ^24.13.4`, `typescript ^6.0.3`, `vitest ^5.0.1` |
| peerDependencies | none. No React dependency. |
| scripts | `build` = clean + `tsc` + chmod `dist/cli.js` 755; `prepack` = `pnpm test && pnpm run build`; `typecheck` = `tsc --noEmit`; `test` = `vitest run` |

Other build facts: `tsconfig.json` targets ES2022, `module`/`moduleResolution` NodeNext, `strict`, `declaration`, `verbatimModuleSyntax`, `rootDir: src`, `outDir: dist`, excludes `*.test.ts`.

### Exports map

| Specifier | types | import |
| --- | --- | --- |
| `.` | `./dist/index.d.ts` | `./dist/index.js` |
| `./pull` | `./dist/pull.d.ts` | `./dist/pull.js` |
| `./rich-text` | `./dist/rich-text.d.ts` | `./dist/rich-text.js` |
| `./seo` | `./dist/seo.d.ts` | `./dist/seo.js` |
| `./package.json` | | `./package.json` |

There is no `./cli`, `./env`, `./init`, `./manifest-pull` or `./config` export. Helper modules that are not re-exported from the entry points are not public API.

### Bin

`"bin": { "areca": "dist/cli.js" }`. The file is `#!/usr/bin/env node` and is executed directly when `isMainModule()` is true (it compares realpaths of `import.meta.url` and `process.argv[1]`).

### Node requirements

- `engines.node` is `>=22.6.0`.
- `README.md` says Node 22.6+ is required and Node 24 LTS is recommended "for direct import of the TypeScript config by `areca manifest push`".
- `loadConfig` uses a native `import()` of `areca.config.ts`. Native TypeScript stripping is not on by default in early Node 22 releases. **(unverified: I believe it became default in 22.18 and 23.6; the 22.6 engine floor may therefore be too low for the native .ts config path. Verify before publishing.)** The error path suggests running through `tsx`.

---

## 2. Entry point exports (`src/index.ts`)

`index.ts` is exactly:

```ts
export { createArecaClient } from './client.js'
export type { ArecaClient, ArecaClientOptions } from './client.js'
export { defineSiteContent, manifestFromConfig } from './config.js'
export { getPreviewEntry, previewHeaders } from './preview.js'
export { seoHead, seoHeadHtml, seoJsonLd } from './seo.js'
export type { HeadLink, HeadMeta, HeadScript, SeoHeadOptions, SeoHeadResult } from './seo.js'
export { richTextDocument, richTextHtml, richTextMarkdown } from './rich-text.js'
export type {
  CollectionConfig, Field, FieldType, ImageValue, PreviewResult, PulledContentManifest,
  ReferenceValue, RichTextValue, SeoMeta, SiteContentConfig, SiteManifest, Snapshot, SnapshotEntry,
} from './types.js'
```

### Values

| Export | Signature | Module |
| --- | --- | --- |
| `createArecaClient` | `(options?: ArecaClientOptions) => ArecaClient` | client.ts |
| `defineSiteContent` | `<T extends SiteContentConfig>(config: T) => T` | config.ts |
| `manifestFromConfig` | `(config: SiteContentConfig) => SiteManifest` | config.ts |
| `getPreviewEntry` | `(options: { token: string; client?: ArecaClient }) => Promise<PreviewResult>` | preview.ts |
| `previewHeaders` | `() => { 'X-Robots-Tag': 'noindex, nofollow'; 'Cache-Control': 'no-store' }` | preview.ts |
| `seoHead` | `(seo: SeoMeta \| null \| undefined, options?: SeoHeadOptions) => SeoHeadResult` | seo.ts |
| `seoHeadHtml` | `(seo: SeoMeta \| null \| undefined, options?: SeoHeadOptions) => string` | seo.ts |
| `seoJsonLd` | `(seo: SeoMeta \| null \| undefined) => string[]` | seo.ts |
| `richTextDocument` | `(value: RichTextValue \| null \| undefined) => MarkdownDocument` | rich-text.ts |
| `richTextMarkdown` | `(value: RichTextValue \| null \| undefined) => string` | rich-text.ts |
| `richTextHtml` | `(value: RichTextValue \| null \| undefined) => string` | rich-text.ts |

`MarkdownDocument` comes from `@tanstack/markdown`. It is a type-only import in `types.ts` and `rich-text.ts`.

### Types exported from index

`ArecaClient`, `ArecaClientOptions`, `HeadLink`, `HeadMeta`, `HeadScript`, `SeoHeadOptions`, `SeoHeadResult`, `CollectionConfig`, `Field`, `FieldType`, `ImageValue`, `PreviewResult`, `PulledContentManifest`, `ReferenceValue`, `RichTextValue`, `SeoMeta`, `SiteContentConfig`, `SiteManifest`, `Snapshot`, `SnapshotEntry`.

### Subpath exports

- `@areca-cms/site-sdk/pull` (`pull.ts`): `pullContent`, `readContent`, type `PullContentOptions`.
- `@areca-cms/site-sdk/seo` (`seo.ts`): `seoHead`, `seoHeadHtml`, `seoJsonLd`, types `HeadMeta`, `HeadLink`, `HeadScript`, `SeoHeadOptions`, `SeoHeadResult`.
- `@areca-cms/site-sdk/rich-text` (`rich-text.ts`): `richTextDocument`, `richTextMarkdown`, `richTextHtml`.

### Internal, not exported from the package

`run` (cli.ts), `parseArgs`, `usage`, `DEFAULT_*` constants (args.ts), `initSite`, `InitCancelledError`, `InitSiteOptions` (init.ts), `manifestPull`, `diffManifests`, `formatManifestDiff`, `ManifestPullCancelledError`, `ManifestDiff`, `ManifestPullOptions`, `ManifestPullResult` (manifest-pull.ts), `loadConfig` (load-config.ts), `loadLocalEnv`, `parseEnvAssignment` (env.ts), `generateConfigSource` (generate-config.ts), `isSafeIdentifier`, `assertSafeIdentifier` (identifiers.ts), `readContent` is exported only via `./pull` (see above).

---

## 3. Type definitions (`src/types.ts`, verbatim)

```ts
import type { MarkdownDocument } from '@tanstack/markdown'

export type FieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'image'
  | 'date'
  | 'datetime'
  | 'select'
  | 'reference'
  | 'slug'
  | 'boolean'
  | 'number'
  | 'url'

export type Field = {
  key: string
  label: string
  type: FieldType
  required?: boolean
  options?: string[]
  collection?: string
  description?: string
  /** Other date/datetime field key that this value must be on or after. */
  after?: string
}

export type CollectionConfig = {
  route: string
  label?: string
  fields: Field[]
}

export type SiteContentConfig = {
  siteKey: string
  collections: Record<string, CollectionConfig>
}

/** POST /api/sites/manifest body */
export type SiteManifest = {
  collections: Record<string, CollectionConfig>
}

/**
 * Published rich text. `markdown` is the canonical serialization, `document`
 * is the TanStack Markdown AST parsed from it (render with
 * `@tanstack/markdown/react` or `renderHtml`), and `html` is a static
 * fallback rendered from the same AST.
 */
export type RichTextValue = {
  json: unknown
  markdown: string
  document: MarkdownDocument
  html: string
}

export type ImageValue = {
  url: string
  width: number | null
  height: number | null
  alt: string
  mimeType: string
}

export type ReferenceValue = {
  collection: string
  slug: string
  id: string
}

export type SnapshotEntry = {
  id: string
  slug: string
  publishedAt: string | null
  data: Record<string, unknown>
  /**
   * Resolved SEO/GEO head data. CMS versions with SEO support always send it;
   * snapshots from older CMS versions do not have it.
   */
  seo?: SeoMeta
}

/** Wire contract: matches the CMS `SeoMeta`. */
export type SeoMeta = {
  /** Page title without any site suffix. */
  title: string
  description: string | null
  canonicalUrl: string | null
  robots: { index: boolean; follow: boolean; content: string }
  focusKeyphrase: string | null
  openGraph: {
    type: 'article' | 'website'
    title: string
    description: string | null
    url: string | null
    siteName: string
    image: ImageValue | null
    publishedTime: string | null
    modifiedTime: string | null
  }
  twitter: {
    card: 'summary' | 'summary_large_image'
    title: string
    description: string | null
    image: ImageValue | null
  }
  author: { name: string; url: string | null; bio: string | null } | null
  /** TL;DR for answer engines; render it visibly on the page. */
  summary: string | null
  keyTakeaways: string[]
  faq: { question: string; answer: string }[]
  about: { name: string; sameAs: string | null }[]
  /** Ready-to-embed JSON-LD objects (main type, FAQPage, extras). */
  jsonLd: Record<string, unknown>[]
}

export type Snapshot = {
  publicationId: string
  siteKey: string
  createdAt: string
  hash: string
  collections: Record<string, SnapshotEntry[]>
}

export type PreviewResult = {
  collection: string
  slug: string
  entry: SnapshotEntry
}

export type PulledContentManifest = {
  publicationId: string
  hash: string
  createdAt: string
  collections: Record<string, number>
}
```

Notes from the types:
- `SnapshotEntry.data` is `Record<string, unknown>`. Callers must supply their own data type (the SDK does not generate types from the schema).
- `RichTextValue.json` is `unknown`.
- `SiteContentConfig` in a config file has `siteKey`. `SiteManifest` (the wire body) does not.

Types in `seo.ts` (not in types.ts):

```ts
export type HeadMeta =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string }

export type HeadLink = { rel: string; href: string }

export type HeadScript = { type: string; children: string }

export type SeoHeadOptions = {
  /** `'%s · Acme'` (the first `%s` is replaced) or a function. */
  titleTemplate?: string | ((title: string) => string)
  /** Overrides `og:site_name`. */
  siteName?: string
}

export type SeoHeadResult = {
  title: string | undefined
  meta: HeadMeta[]
  links: HeadLink[]
  scripts: HeadScript[]
}
```

Types in `pull.ts`:

```ts
export type PullContentOptions = {
  outDir: string
  client?: ArecaClient
}
```

Types in `client.ts`:

```ts
export type ArecaClientOptions = {
  cmsUrl?: string
  siteToken?: string
  schemaToken?: string
}

export type ArecaClient = {
  syncManifest: (config: SiteContentConfig) => Promise<{ ok: true }>
  fetchManifest: () => Promise<SiteManifest>
  fetchSnapshot: () => Promise<Snapshot>
  fetchPreview: (token: string) => Promise<PreviewResult>
}
```

---

## 4. Function behaviour

### 4.1 `createArecaClient(options = {})` (client.ts)

Signature: `createArecaClient(options?: ArecaClientOptions): ArecaClient`

- Resolves `cmsUrl` as `options.cmsUrl ?? process.env.ARECA_CMS_URL`, then trims and throws if empty. Trailing slashes are stripped. No protocol validation is done here.
- Resolves `siteToken` as `options.siteToken ?? process.env.ARECA_SITE_TOKEN`, trimmed and required. Both are checked eagerly at construction time.
- `schemaToken` is **not** checked at construction. It is read lazily inside `syncManifest` as `options.schemaToken ?? process.env.ARECA_SCHEMA_TOKEN`. The site token is never used as a fallback for schema writes (test "never falls back to build token for schema writes").
- Every request sends `Authorization: Bearer <token>` and `Accept: application/json`. There are no timeouts and no retries.
- Network failures are rethrown as `Failed to reach CMS at <cmsUrl>. <detail>. If the CMS is up, publish content before running areca pull.`
- The client has no reference to `fetch` other than the global `fetch`. Tests replace `globalThis.fetch`.

Methods:

| Method | HTTP | Auth | Returns | Notes |
| --- | --- | --- | --- | --- |
| `syncManifest(config)` | `POST {cmsUrl}/api/sites/manifest`, JSON body `manifestFromConfig(config)` | schema token | `{ ok: true }` | Throws `Failed to sync manifest (<status>)[: <error>]` on non-2xx. The body does not include `siteKey`. |
| `fetchManifest()` | `GET {cmsUrl}/api/sites/manifest` | site token | `SiteManifest` | Throws `Failed to fetch manifest (<status>)...` |
| `fetchSnapshot()` | `GET {cmsUrl}/api/sites/snapshot/current` | site token | `Snapshot` | 404 throws `No publication exists for this site. Publish content in the CMS before running areca pull.[ <error>]`. Other errors: `Failed to fetch snapshot (<status>)...` |
| `fetchPreview(token)` | `GET {cmsUrl}/api/sites/preview?token=<urlencoded>` | site token | `PreviewResult` | The preview token travels in the query string. Errors: `Failed to fetch preview (<status>)...` |

Error detail: `readError` takes `body.error` if it is a non-empty string from a JSON body. Non-JSON bodies yield no detail. Error format is `<prefix> (<status>): <detail>` or `<prefix> (<status>)`.

Response bodies are cast with `as` and not validated.

Missing-config error text (exact, from `requiredValue`): `Missing ARECA_CMS_URL. Set the ARECA_CMS_URL environment variable or pass cmsUrl to createArecaClient().` The same pattern applies to `ARECA_SITE_TOKEN` / `siteToken` and `ARECA_SCHEMA_TOKEN` / `schemaToken`.

Test examples (index.test.ts):

```ts
const client = createArecaClient({
  cmsUrl: 'https://cms.example.com/',
  siteToken: 'site-token',
  schemaToken: 'schema-token',
})
await client.syncManifest(sampleConfig)
// POST https://cms.example.com/api/sites/manifest, Authorization: Bearer schema-token
// body === JSON.stringify(manifestFromConfig(sampleConfig))
```

```ts
globalThis.fetch = async () => jsonResponse({ error: 'Invalid site token' }, 401)
await expect(client.fetchManifest()).rejects.toThrow(
  /Failed to fetch manifest \(401\): Invalid site token/,
)
```

```ts
globalThis.fetch = async () => jsonResponse({ error: 'No live publication' }, 404)
await expect(client.fetchSnapshot()).rejects.toThrow(/No publication exists/)
```

```ts
globalThis.fetch = async () => { throw new TypeError('fetch failed') }
await expect(client.fetchSnapshot()).rejects.toThrow(
  /Failed to reach CMS at https:\/\/cms.example.com.*areca pull/,
)
```

### 4.2 `defineSiteContent(config)` (config.ts)

`defineSiteContent<T extends SiteContentConfig>(config: T): T` is an identity function. It adds type inference and nothing else. It does not validate identifiers, so invalid keys only fail later, in `manifestFromConfig`, `manifest push`, or `manifest pull`.

Test: `expect(defineSiteContent(sampleConfig)).toBe(sampleConfig)`.

### 4.3 `manifestFromConfig(config)` (config.ts)

Signature: `(config: SiteContentConfig) => SiteManifest`. Returns `{ collections }` only; `siteKey` is dropped.

For each collection:
- `assertSafeIdentifier(key)` on the collection key.
- For each field: `assertSafeIdentifier(field.key)`. Duplicate field keys throw `Duplicate field identifier: <key>`. If set, `field.collection` and `field.after` are also checked with `assertSafeIdentifier`.
- Output per collection is `{ route, fields, label? }`. `label` is included only when defined. `fields` is passed through as-is (no field-level normalization).

Test: `manifestFromConfig(sampleConfig)` equals `{ collections: { articles: { route: '/blog/$slug', label: 'Articles', fields: [...] }, pages: { route: '/$slug', fields: [...] } } }`.

### 4.4 Identifier rules (identifiers.ts, used by config.ts and pull.ts)

`isSafeIdentifier(value)` is true when:
- value matches `/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/` (ASCII letter first, then letters, digits, `_`, `-`; total length 1 to 64), and
- `value.toLowerCase()` is not in the reserved set.

Reserved set (compared lowercased): `__proto__`, `prototype`, `constructor`, `manifest`, `con`, `prn`, `aux`, `nul`, `com1` to `com9`, `lpt1` to `lpt9`.

`assertSafeIdentifier` throws `Unsafe collection or field identifier: <value>`.

Note: reserved matching is case-insensitive, so `MANIFEST` and `Con` are rejected too.

### 4.5 `getPreviewEntry({ token, client? })` (preview.ts)

`(options: { token: string; client?: ArecaClient }) => Promise<PreviewResult>`. Uses `options.client ?? createArecaClient()` (reads env each call) and returns `client.fetchPreview(token)`. Throws the same errors as `fetchPreview`.

Test: `getPreviewEntry({ token: 'opaque', client: { ..., fetchPreview } })` calls `fetchPreview('opaque')` and resolves to the preview.

### 4.6 `previewHeaders()` (preview.ts)

Returns a fresh object each call:

```ts
{ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' }
```

### 4.7 `pullContent({ outDir, client? })` (pull.ts, subpath `./pull`)

Signature: `(options: PullContentOptions) => Promise<Snapshot>`.

Steps, in order:
1. Calls `client.fetchSnapshot()` (default client from env if not given).
2. Runs `assertSafeIdentifier` on every collection key in the snapshot. A failure throws before any file is written (test covers `../escape`, `..\\escape`, `/absolute`, `manifest`, `__proto__`, `constructor`, `CON`, `x.json`, `hello world`).
3. `mkdirSync(outDir, { recursive: true })`.
4. Writes `manifest.json` first (`PulledContentManifest`: `publicationId`, `hash`, `createdAt`, `collections` as counts per key).
5. Writes `<key>.json` for each collection: the raw entries array, pretty-printed with 2 spaces and a trailing newline.
6. Returns the snapshot.

Writes use `openSync` with `O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW`. `containedPath` also uses `realpathSync(outDir)`, joins `<key>.json`, verifies the result stays inside the base, and `lstat`s the target. A symlink at the target throws `Content output must not be a symbolic link`. An escape throws `Output path escapes content directory`.

Observed quirk: `manifest.json` is overwritten before the collection files are checked for symlinks. If a symlink is found, the run fails with the manifest already updated and collection files partly updated. The output directory is not staged atomically. Stale collection files from earlier pulls are not removed.

Test (symlink refusal): the outside file keeps its content (`preserved`) and the error matches `/symbolic link/`.

### 4.8 `readContent<T = SnapshotEntry>(outDir, collectionKey)` (pull.ts, subpath `./pull`)

Signature: `readContent<T = SnapshotEntry>(outDir: string, collectionKey: string): T[]`. Synchronous.

- `assertSafeIdentifier(collectionKey)` first.
- Resolves the path with the same `containedPath` checks, so a symlink target throws.
- Missing output directory, or missing file, throws `No content file for collection "<key>" in <outDir>. Run \`areca pull\` first.` or `... at <file>. Run \`areca pull\` first.`
- Returns `JSON.parse` of the file as `T[]`. The result is not validated against any schema.

Test examples:

```ts
readContent(outDir, 'articles')   // [sampleEntry]
readContent(outDir, 'pages')      // []
readContent('/tmp/areca-site-sdk-does-not-exist', 'articles') // throws /areca pull/
```

### 4.9 `seoJsonLd(seo)` (seo.ts)

Signature: `(seo: SeoMeta | null | undefined) => string[]`.

Returns `[]` when `seo` is null or `jsonLd` is not an array. Otherwise maps each object through `JSON.stringify`, then replaces `<`, `>`, `&`, U+2028 and U+2029 with `<`, `>`, `&`, ` `, ` `. The output is safe inside an inline `<script type="application/ld+json">`.

Test:

```ts
const [json] = seoJsonLd(makeSeo({ jsonLd: [{ headline: '</script><script>alert(1)</script>', x: 'a b' }] }))
// json contains no '<' and no U+2028; JSON.parse(json) round-trips to the original object
```

### 4.10 `seoHead(seo, options = {})` (seo.ts)

Signature: `(seo: SeoMeta | null | undefined, options?: SeoHeadOptions) => SeoHeadResult`.

Returns `{ title: undefined, meta: [], links: [], scripts: [] }` for null or undefined `seo`.

Otherwise, in order:
1. `title`: if `seo.title` is non-blank, `result.title = applyTemplate(seo.title, options.titleTemplate)`, and `meta` gets `{ title }`. `applyTemplate` returns the title unchanged when no template is given. A string template replaces the **first** `%s` (`template.replace('%s', () => title)`, so `$` patterns in titles are safe). A function template is called with the title.
2. `{ name: 'description' }` when `seo.description` is non-blank.
3. `{ name: 'robots', content }` from `seo.robots.content`.
4. `links`: `{ rel: 'canonical', href }` when `canonicalUrl` is non-blank.
5. Open Graph from `seo.openGraph`: `og:type`, `og:title`, `og:description`, `og:url`, `og:site_name` (`options.siteName` overrides `openGraph.siteName`), `og:image`, `og:image:width`, `og:image:height`, `og:image:alt`, `og:image:type`, `article:published_time`, `article:modified_time`. Numeric width and height are stringified. `null` and undefined are skipped. Strings are skipped when blank.
6. `article:author` when `seo.author` is set: the author `url` if present, otherwise the author `name`.
7. Twitter from `seo.twitter`: `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`, `twitter:image:alt`.
8. `scripts`: one `{ type: 'application/ld+json', children }` per `seoJsonLd(seo)` string.

Result shape: `title` is also duplicated as a top-level key, alongside `{ title }` in `meta`. TanStack Router's head API reads `meta`, `links`, and `scripts`. Whether it uses a top-level `title` is **(unverified)**.

Test example (abridged). With `makeSeo()` the `meta` array is:

```ts
[
  { title: 'Hello world' },
  { name: 'description', content: 'A description' },
  { name: 'robots', content: 'index, follow' },
  { property: 'og:type', content: 'article' },
  { property: 'og:title', content: 'OG hello' },
  { property: 'og:description', content: 'OG description' },
  { property: 'og:url', content: 'https://example.com/blog/hello' },
  { property: 'og:site_name', content: 'Example' },
  { property: 'og:image', content: 'https://cdn.example.com/cover.jpg' },
  { property: 'og:image:width', content: '1200' },
  { property: 'og:image:height', content: '630' },
  { property: 'og:image:alt', content: 'Cover' },
  { property: 'og:image:type', content: 'image/jpeg' },
  { property: 'article:published_time', content: '2026-01-01T00:00:00.000Z' },
  { property: 'article:modified_time', content: '2026-01-02T00:00:00.000Z' },
  { property: 'article:author', content: 'https://example.com/ada' },
  { name: 'twitter:card', content: 'summary_large_image' },
  { name: 'twitter:title', content: 'TW hello' },
  { name: 'twitter:image', content: 'https://cdn.example.com/cover.jpg' },
  { name: 'twitter:image:alt', content: 'Cover' },
]
// links: [{ rel: 'canonical', href: 'https://example.com/blog/hello' }]
// scripts: [{ type: 'application/ld+json', children: '{"@context":...,"@type":"Article",...}' }]
```

Other test examples:

```ts
seoHead(makeSeo(), { titleTemplate: '%s · Acme' }).title          // 'Hello world · Acme'
seoHead(makeSeo(), { titleTemplate: (t) => `Acme | ${t}` }).title // 'Acme | Hello world'
seoHead(makeSeo(), { siteName: 'Acme' })                          // og:site_name content 'Acme'
seoHead(null)                                                     // { title: undefined, meta: [], links: [], scripts: [] }
```

With `description: null`, `canonicalUrl: ''`, `author.url: null`, `openGraph.image: null`, the description, canonical link, og:image, and published_time are omitted. `article:author` falls back to `'Ada'`.

### 4.11 `seoHeadHtml(seo, options = {})` (seo.ts)

Signature: `(seo: SeoMeta | null | undefined, options?: SeoHeadOptions) => string`. Calls `seoHead`, then serializes in this order: each `meta` entry, each `link`, each `script`. Lines are joined with `\n`.

- Title: `<title>${escapeHtml(title)}</title>`
- Name meta: `<meta name="..." content="...">`
- Property meta: `<meta property="..." content="...">`
- Link: `<link rel="..." href="...">`
- Script: `<script type="application/ld+json">${children}</script>`. `children` is already JSON-LD-escaped, so it is not escaped again.

`escapeHtml` escapes `& < > " '` (`'` becomes `&#39;`). Null gives `''`.

Test examples:

```ts
const html = seoHeadHtml(makeSeo({ title: 'A & B <i>', description: `Say "hi" it's` }))
// contains: <title>A &amp; B &lt;i&gt;</title>
// contains: <meta name="description" content="Say &quot;hi&quot; it&#39;s">
// contains: <link rel="canonical" href="https://example.com/blog/hello">
// contains: <script type="application/ld+json">{
```

```ts
seoHeadHtml(makeSeo({ jsonLd: [{ a: '</script><b>' }] })).match(/<\/script>/g) // length 1
```

### 4.12 `richTextDocument(value)`, `richTextMarkdown(value)`, `richTextHtml(value)` (rich-text.ts)

- `richTextDocument(value)`: returns `{ type: 'root', children: [] }` for null or undefined. Returns `value.document` when set. Otherwise, if `value.markdown` is a non-empty string, returns `parseMarkdown(value.markdown, { frontmatter: false })` from `@tanstack/markdown/parser`. This covers snapshots that predate the `document` field. Otherwise returns the empty root.
- `richTextMarkdown(value)`: `value?.markdown ?? ''`.
- `richTextHtml(value)`: `value?.html ?? ''`.

The helpers do not sanitize HTML. `richTextHtml` output is CMS-rendered and should be treated as trusted-only.

Test examples:

```ts
const body = sampleEntry.data.body as RichTextValue // { json, markdown: 'Hi', document, html: '<p>Hi</p>' }
richTextDocument(body)  // === body.document
richTextMarkdown(body)  // 'Hi'
richTextHtml(body)      // '<p>Hi</p>'

// legacy snapshot with only markdown
richTextDocument({ json: null, markdown: '## Old\n\nBody', html: '' } as unknown as RichTextValue)
  .children.map((n) => n.type) // ['heading', 'paragraph']

richTextDocument(null)      // { type: 'root', children: [] }
richTextMarkdown(null)      // ''
richTextHtml(undefined)     // ''
```

Rendering pattern from the README and demo (`examples/demo-site/src/components/article-body.tsx`):

```tsx
import { Markdown } from '@tanstack/markdown/react'
import type { MarkdownComponents } from '@tanstack/markdown/react'
import { richTextDocument } from '@areca-cms/site-sdk'
// ...
<Markdown components={articleComponents}>{richTextDocument(body)}</Markdown>
```

`articleComponents` is a `satisfies MarkdownComponents` object of React components for `h2`, `h3`, `h4`, `p`, `a`, `strong`, `em`, `ul`, `ol`, `li`, `blockquote`, `pre`, `code`, `img`, `hr`, `br`. The `a` component adds `rel="noopener noreferrer"` and `target="_blank"` for absolute `http(s)` links. The `img` component wraps the image in `<figure>` with a `<figcaption>` from alt text.

### 4.13 `loadConfig(configPath, cwd)` (load-config.ts, internal)

`(configPath: string, cwd = process.cwd()) => Promise<SiteContentConfig>`. Resolves against `cwd`, then `import()`s the file as a `file://` URL and returns `mod.default`.

- Import failure on `.ts`, `.mts`, or `.tsx` throws `Failed to load TypeScript config <configPath> via native import (<detail>). Retry with tsx, e.g. pnpm exec tsx ./node_modules/@areca-cms/site-sdk/dist/cli.js manifest push <configPath>`.
- Import failure on other extensions rethrows the original error.
- Missing default export: `Config module <configPath> has no default export.`

Note that loading the config **executes** the config module.

### 4.14 `generateConfigSource(config)` (generate-config.ts, internal)

Emits the source of an `areca.config.ts`. Format: 2-space indent, single quotes, trailing commas, no semicolons, ends with `\n`. Collections are sorted by key. Field keys keep the fixed order `key, label, type, required, options, collection, description, after`. Undefined keys are skipped.

- A field object is on one line when it fits in 80 columns. Otherwise it is expanded one property per line.
- Property keys that are not `/^[A-Za-z_$][A-Za-z0-9_$]*$/` are quoted.
- Strings escape `\`, `'`, `\n`, `\r`, `\t`.
- Booleans print as `true` or `false`. Arrays print as `['a', 'b']`.
- Header: `import { defineSiteContent } from '@areca-cms/site-sdk'`, then `export default defineSiteContent({`, then `  siteKey: '<key>',`.
- Empty collections print `  collections: {},`. Empty fields print `fields: [],`.

Example output (from `generate-config.test.ts`, "matches the demo-site config byte for byte"):

```ts
import { defineSiteContent } from '@areca-cms/site-sdk'

export default defineSiteContent({
  siteKey: 'acme-site',
  collections: {
    articles: {
      route: '/blog/$slug',
      label: 'Articles',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
        { key: 'body', label: 'Body', type: 'richtext', required: true },
        { key: 'heroImage', label: 'Hero image', type: 'image' },
        { key: 'publishedAt', label: 'Published at', type: 'datetime' },
        {
          key: 'category',
          label: 'Category',
          type: 'select',
          options: ['news', 'updates'],
        },
      ],
    },
  },
})
```

This matches `examples/demo-site/areca.config.ts`.

### 4.15 `diffManifests`, `formatManifestDiff`, `manifestPull` (manifest-pull.ts, internal)

- `diffManifests(local: SiteContentConfig | undefined, remote: SiteManifest): ManifestDiff` returns `{ added, changed, removed }`, each sorted by key. `added` is in remote only. `removed` is in local only. `changed` is in both but not deep-equal after normalization. Deep-equal ignores key order. With `local` undefined, every remote collection is `added`.
- `formatManifestDiff(diff)` renders lines `  + key` (added), `  ~ key` (changed), `  - key` (removed), joined with `\n`. Empty output is `  (no changes)`.
- `manifestPull({ cwd?, configPath, yes?, client?, interactive? })`:
  1. Fetches `client.fetchManifest()`.
  2. Loads the existing config if the file exists (`loadConfig`).
  3. `siteKey` is `existing.siteKey` if non-blank, otherwise `ARECA_SITE_KEY`. Neither gives `No siteKey found. <configPath> does not exist and ARECA_SITE_KEY is not set. Run \`areca init\` first.`
  4. If the existing config has more than zero collections and `yes` is not true:
     - non-interactive throws `<configPath> already defines N collection(s). Re-run with --yes to overwrite it.`
     - interactive prints `Changes to <configPath>:`, the diff, then `confirm({ message: 'Overwrite <configPath>?' })`. Declining or cancelling throws `ManifestPullCancelledError` (message `Aborted`).
  5. Writes `generateConfigSource({ siteKey, collections: manifest.collections })` with `writeFileSync` (no symlink or containment checks). It does not preserve comments or helpers.
  6. Returns `{ configPath, collections, diff, source }`.

`interactive` defaults to `Boolean(process.stdin.isTTY)`.

Note that a config with zero collections (even one with comments and helper code) is overwritten without a prompt.

### 4.16 `initSite(options)` (init.ts, internal)

Options: `cwd`, `cmsUrl`, `token`, `siteKey`, `outDir` (default `src/generated/content`), `configPath` (default `areca.config.ts`), `yes`, `force`. Interactive mode is `yes !== true && process.stdin.isTTY`.

- Interactive: `intro('Areca CMS')`, a note, then prompts only for values not supplied as flags. Prompts are `CMS URL` (default `http://localhost:3000`), `Site token` (masked password), and `Site key (CMS slug)`. Cancel prints `Operation cancelled.` and throws `InitCancelledError`.
- Non-interactive: all of `--cms-url`, `--token`, `--site-key` are required. Missing ones throw `Missing --cms-url, --token, --site-key. Pass --cms-url, --token, and --site-key, or run areca init in a terminal to enter them interactively.`
- Validation: CMS URL must be `http:` or `https:` (`Invalid CMS URL: ...`). It is normalized with `new URL(...).toString()` and trailing slashes are removed. Site key must match `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` (`Invalid site key: ...`).
- Before writing anything, `package.json` must exist and parse as a JSON object. Otherwise: `No package.json found. Run areca init from the site root.`, `Invalid JSON in package.json.`, or `Invalid package.json. Expected a JSON object.`

Files written (in this order, under `cwd`):

| File | Behaviour |
| --- | --- |
| `<configPath>` (default `areca.config.ts`) | Written only if missing or `--force`. Content: `import { defineSiteContent } from '@areca-cms/site-sdk'`, `export default defineSiteContent({ siteKey: '<key>', collections: {} })`. |
| `.env.example` | Written only if missing or `--force`. Content: `ARECA_CMS_URL=<url>`, `ARECA_SITE_TOKEN=`, `ARECA_SCHEMA_TOKEN=`. |
| `.env.local` | Always upserted. Sets `ARECA_CMS_URL` and `ARECA_SITE_TOKEN`, replacing matching lines in place and appending missing keys. Other lines are kept. |
| `.gitignore` | Appends `.env.local` and `<outDir>/` when not already present (trailing slash variants count as present). Creates the file if it is empty. |
| `<outDir>/manifest.json` | Created with `publicationId: ""`, `hash: ""`, `createdAt: ""`, `collections: {}`. No collection files are created. |
| `package.json` | Rewritten with 2-space JSON. Adds `scripts["sync-manifest"] = "areca manifest push"` and `scripts["content:pull"] = "areca pull --out <outDir>"` only when missing or blank. If `scripts.dev` is a non-blank string that does not contain `--env-file` or `areca run`, it becomes `areca run -- <dev>`. |

Success output: interactive uses clack `outro`. Non-interactive prints `Areca CMS setup complete. Set ARECA_SCHEMA_TOKEN from Settings > Developer (keep it out of builds) → add collections to areca.config.ts → pnpm sync-manifest → publish in CMS → pnpm content:pull → pnpm dev`. The token is never printed (test "does not log the token").

---

## 5. CLI (`areca`, `src/cli.ts` and `src/args.ts`)

### 5.1 Global behaviour

- `run(argv, { cwd })` first calls `loadLocalEnv(cwd)` for every command, including `help`. Then `parseArgs(argv)`.
- Empty-string arguments are dropped before parsing.
- `process.exit(code)` is called only when `code !== 0`.
- The bin entry is `dist/cli.js`. `run` is not exported.

### 5.2 Commands

| Command | Parsed as | Behaviour |
| --- | --- | --- |
| `areca` (no args), `areca --help`, `areca -h` | help | Prints usage to stdout. Exit 0. |
| `areca init [flags]` | init | Calls `initSite`. |
| `areca pull [--out <dir>]` | pull | Calls `pullContent({ outDir })`. Prints `Pulled publication <id> (<hash>)[: key=count, ...]`. |
| `areca manifest push [config]` | sync-manifest | `loadConfig` then `createArecaClient().syncManifest(config)`. Prints `Synced manifest from <config>`. |
| `areca manifest pull [--config <path>] [--yes\|-y]` | manifest-pull | Calls `manifestPull`. Prints `Wrote <config> with N collection(s) (+a ~c -r)`. |
| `areca sync-manifest [config]` | sync-manifest | Deprecated alias of `manifest push`. |
| `areca run -- <command...>` | run | Spawns the command with `shell: true`, `stdio: inherit`, `cwd`. Exit code is the child's code, or 1 on spawn error or signal (`code ?? 1`). |

`manifest push` and `sync-manifest` default the config path to `./areca.config.ts`. `pull` defaults `--out` to `src/generated/content`. `init` defaults `--out` to `src/generated/content` and `--config` to `areca.config.ts`. `manifest pull` defaults `--config` to `./areca.config.ts`.

### 5.3 Flags (exact parse rules)

- `pull`: `--out <dir>` only. Any other argument is `Unknown argument: <arg>`.
- `init`: `--cms-url <url>`, `--token <token>`, `--site-key <key>`, `--out <dir>`, `--config <path>`, `--yes` or `-y`, `--force`. Anything else is `Unknown argument`.
- `manifest pull`: `--config <path>`, `--yes` or `-y`.
- `manifest push` and `sync-manifest`: one optional positional `[config]`. If the first argument starts with `-` it is `Unknown argument`. **Extra positional arguments are silently ignored.**
- `run`: must be `run -- <command...>`. Missing `--` or empty command is an error.
- A flag value is taken from the next argument. It is an error if that argument is missing or starts with `-`: `Missing value for <flag>`. So `--token -abc` is rejected.

Parse errors (`command: 'error'`) print the message and the full usage to **stderr**, then exit 1.

Parse error messages (exact):
- `Unknown command: <cmd>`
- `Unknown argument: <arg>`
- `Missing value for <flag>`
- `Missing manifest subcommand. Expected push or pull.`
- `Unknown manifest subcommand: <sub>`
- `Missing command. Usage: areca run -- <command>`

`--help` and `-h` are recognised **only as the first argument**. `areca pull --help` gives `Unknown argument: --help` and exit 1.

### 5.4 Usage text (verbatim from `args.ts`)

```
Usage:
  areca init [--cms-url <url>] [--token <token>] [--site-key <key>] [--out src/generated/content] [--config areca.config.ts] [--yes|-y] [--force]
  areca pull [--out src/generated/content]
  areca manifest push [./areca.config.ts]
  areca manifest pull [--config ./areca.config.ts] [--yes|-y]
  areca sync-manifest [./areca.config.ts]   (deprecated alias for manifest push)
  areca run -- <command>

Environment:
  ARECA_CMS_URL      CMS base URL
  ARECA_SITE_TOKEN   Site token sent as Authorization: Bearer <token>

Env files (loaded automatically from the current directory; existing process.env keys win):
  .env.local
  .env
```

The usage text does not mention `ARECA_SCHEMA_TOKEN` or `ARECA_SITE_KEY`.

### 5.5 Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. Also help output, and an init cancellation (silent). A manifest-pull cancellation prints `Aborted` and also exits 0. |
| 1 | Any thrown error (printed to stderr as its message). Parse errors. Failed child command (its own code is used). |
| child code | `areca run` returns the child's exit code. Signal or null code gives 1. |

### 5.6 Environment variables read

| Variable | Read by | Used for |
| --- | --- | --- |
| `ARECA_CMS_URL` | client.ts | Base URL. Required at client construction. |
| `ARECA_SITE_TOKEN` | client.ts | Bearer token for manifest/snapshot/preview reads. Required at construction. |
| `ARECA_SCHEMA_TOKEN` | client.ts (`syncManifest` only) | Bearer token for `POST /api/sites/manifest`. Never falls back to the site token. |
| `ARECA_SITE_KEY` | manifest-pull.ts | Used by `manifest pull` only when the config file is missing or has no `siteKey`. |
| `ARECA_SNAPSHOT_ID` | **not read by the SDK** | Only consumed by the demo Dockerfile as a cache-busting build ARG. |

Env files: `loadLocalEnv(cwd)` reads `<cwd>/.env.local` then `<cwd>/.env`. Parsing (env.ts):
- Lines are split on `\r?\n`. Blank lines and lines starting with `#` are skipped. Split at the first `=`. Keys are trimmed. Key must be non-empty and the `=` must not be at index 0.
- Values are trimmed on the key side only. The value is not trimmed, so `KEY= value` keeps a leading space. Matching surrounding `"` or `'` pairs are removed. No escape handling. No `export ` prefix handling. No inline-comment stripping.
- Duplicate keys in one file: last wins.
- Precedence: a key already set in `process.env` (including as an empty string) is never overwritten. `.env.local` is applied before `.env`, so it wins over `.env`. Because empty strings count as set, an empty value in `.env.local` blocks a non-empty value in `.env`.
- Missing files are ignored.

### 5.7 Config file format (`areca.config.ts`)

- Default path `./areca.config.ts`, resolved against cwd. Also accepts `.js`, `.mjs`, `.mts`, `.tsx` through `import()`.
- Must have a `default` export. Conventionally `defineSiteContent({...})`, which returns the object unchanged.
- Shape: `SiteContentConfig` (see section 3).
- Config import executes the module. Native `.ts` import depends on the Node runtime (see section 1).

### 5.8 Files written by the CLI

| Command | Files |
| --- | --- |
| `pull` | `<out>/manifest.json` (written first) and `<out>/<collectionKey>.json` for each collection. Output directory is created recursively. |
| `init` | See the table in section 4.16. |
| `manifest pull` | `<config>` only (`writeFileSync`, no O_NOFOLLOW, no containment check; `--config ../x.mjs` can write outside cwd). |
| `manifest push` | No files. Sends a network request only. |
| `run` | No files. |

`manifest.json` content from `pull`:

```json
{
  "publicationId": "pub_1",
  "hash": "abc123",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "collections": { "articles": 1, "pages": 0 }
}
```

Each collection file is the raw `entries` array from the snapshot (`SnapshotEntry[]`).

### 5.9 Output-safety rules (as implemented)

- The token is never printed by `init` (test). Errors are formatted from `Error.message`. The CMS error text from JSON bodies is echoed, and so is the CMS URL on network failure. The preview token only goes in the query string.
- `pull` refuses unsafe collection keys before writing anything and refuses symlink targets (`O_NOFOLLOW` plus `lstat`).
- `readContent` applies the same containment and symlink checks.
- `manifest pull` refuses to overwrite a populated config without `--yes` when stdin is not a TTY.
- `syncManifest` requires the schema token and never falls back to the site token (test).
- Preview responses are meant to carry `noindex` and `no-store` headers (`previewHeaders()`). The SDK only supplies the values. Setting them is the caller's job.

Gaps to note (code facts, not doc claims):
- `.env.local` is written with `writeFileSync(..., 'utf8')` and no `mode`. It gets the default mode (0666 & ~umask, often 0644), so the site token may be world-readable on a multi-user machine. Nothing chmods it to 0600.
- `init --token <value>` takes the secret on the command line. It can appear in shell history and in `ps` output. The docs' `--token "$ARECA_SITE_TOKEN"` pattern has the same exposure.
- `areca run -- <command>` joins argv with spaces and passes the string to `shell: true`. Quoting and arguments containing spaces are not preserved.
- `init` and `manifest pull` write via `writeFileSync` without `O_NOFOLLOW`, so a symlinked config or `.env.local` is followed.
- `manifest pull` and `loadConfig` execute the config module. The `--config` path is not restricted to cwd.

---

## 6. Rich text (`src/rich-text.ts`)

Summary of `RichTextValue` as delivered in a snapshot (`json`, `markdown`, `document`, `html`):
- `markdown` is canonical.
- `document` is the TanStack Markdown AST (`MarkdownDocument`). Render with `<Markdown>` from `@tanstack/markdown/react`, or `renderHtml` from `@tanstack/markdown/html`.
- `html` is a static fallback rendered from the same AST by the CMS.
- `json` is the editor JSON, typed `unknown`.

Helpers are summarized in section 4.12. The demo's fixture generator rebuilds this shape locally with `parseMarkdown(markdown, { frontmatter: false })` and `renderHtml(document)` (`examples/demo-site/scripts/fixture-content.ts`).

`@tanstack/markdown` is pinned at `0.0.15` in the SDK. The AST is pre-1.0, so the renderer version must match.

---

## 7. Preview (`src/preview.ts`)

- `previewHeaders()` returns `{ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' }`.
- `getPreviewEntry({ token, client? })` returns `PreviewResult`: `{ collection, slug, entry }`.
- The CMS preview URL carries an opaque `token` query parameter. The SDK sends it to `GET /api/sites/preview?token=...` with the site token as bearer auth.

Test example:

```ts
const fetchPreview = vi.fn().mockResolvedValue({ collection: 'articles', slug: 'hello', entry: sampleEntry })
await getPreviewEntry({ token: 'opaque', client: { syncManifest: vi.fn(), fetchManifest: vi.fn(), fetchSnapshot: vi.fn(), fetchPreview } })
expect(fetchPreview).toHaveBeenCalledWith('opaque')
```

Demo usage (`examples/demo-site/src/routes/[__preview]/$collection/$slug.tsx`): a `createServerFn` handler sets `X-Robots-Tag` and `Cache-Control` via `setResponseHeader` from `previewHeaders()`, then calls `getPreviewEntry({ token })` inside try/catch and returns `{ ok, preview }` or `{ ok: false, error }`. It also adds a `robots` meta tag in `head`.

---

## 8. SEO (`src/seo.ts`)

Behaviour is covered in sections 4.9 to 4.11. Key points:
- Input is `SeoMeta | null | undefined`, which is `entry.seo` on a `SnapshotEntry`. Older snapshots omit it.
- Blank strings and `null` values are skipped everywhere.
- `titleTemplate` replaces only the first `%s`, or is a function. `siteName` overrides `og:site_name`.
- JSON-LD is always escaped for inline script use.
- The SDK does not render `summary`, `keyTakeaways`, or `faq`. The docs ask the site to render them visibly.

Astro-style usage from the README: `<head set:html={seoHeadHtml(entry.seo, { titleTemplate: '%s · Acme' })} />` (imported from `@areca-cms/site-sdk/seo`).

---

## 9. Demo site (`examples/demo-site`)

### Stack and files

- Package name `@areca/demo-site`, private, ESM. Depends on `@areca-cms/site-sdk: workspace:*`, `@tanstack/markdown 0.0.15`, `@tanstack/react-router 1.170.36`, `@tanstack/react-start 1.168.54`, `nitro 3.0.260903-beta`, React 19, Tailwind 4, `zod ^4.6.5`. Dev: Vite 8, `@vitejs/plugin-react`, `tsx`, Vitest, `@tanstack/router-cli`.
- Vite config (`vite.config.ts`): `tanstackStart` with `prerender` enabled, `crawlLinks`, `failOnError`, a filter that excludes `/__preview` and `/api`, and `pages: listPrerenderPages()`. Dev port is 3001.

Scripts (`package.json`):

| Script | Command |
| --- | --- |
| `prebuild` | `node --env-file-if-exists=.env.local ./scripts/prebuild.mjs` |
| `content:pull` | `node --env-file-if-exists=.env.local ./node_modules/@areca-cms/site-sdk/dist/cli.js pull --out src/generated/content` |
| `content:fixture` | `tsx ./scripts/fixture-content.ts` |
| `sync-manifest` | `node --env-file-if-exists=.env.local --import tsx ./node_modules/@areca-cms/site-sdk/dist/cli.js manifest push ./areca.config.ts` |
| `dev` | `node --env-file-if-exists=.env.local ./node_modules/vite/bin/vite.js dev --port 3001` |
| `build` | `vite build` |
| `start` | `node .output/server/index.mjs` |
| `verify:prerender` | `tsx ./scripts/verify-prerender.ts` |

### SDK integration points

1. **Schema** (`areca.config.ts`): `defineSiteContent({ siteKey: 'acme-site', collections: { articles: { route: '/blog/$slug', label: 'Articles', fields: [...] } } })`, with `title`, `slug`, `excerpt` (textarea), `body` (richtext), `heroImage` (image), `publishedAt` (datetime), `category` (select with options `news`, `updates`).

2. **Build-time pull** (`scripts/prebuild.mjs`): spawns `node <site-sdk>/dist/cli.js pull --out src/generated/content` when `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` are set. Otherwise it reuses existing `manifest.json` and `articles.json`, or exits 1 with a hint to run `content:fixture`.

   ```js
   const hasCmsEnv = Boolean(process.env.ARECA_CMS_URL?.trim() && process.env.ARECA_SITE_TOKEN?.trim())
   if (hasCmsEnv) {
     const result = spawnSync(process.execPath, [cli, 'pull', '--out', outDir], { stdio: 'inherit', cwd: pkgRoot, env: process.env })
     process.exit(result.status ?? 1)
   }
   ```

3. **Server reads** (`src/lib/content.ts`): `readContent<Article>(CONTENT_DIR, 'articles')` from `@areca-cms/site-sdk/pull`. Adds sorting by `data.publishedAt ?? publishedAt`, newest first. Also `getArticle(slug)`, `getManifest()` (reads `manifest.json` directly with `readFileSync`, not via the SDK), and `listPrerenderPages()` (`/`, `/blog`, `/blog/<slug>` for each article).

   ```ts
   export type Article = SnapshotEntry & { data: ArticleData }
   export function getArticles(): Article[] {
     const articles = readContent<Article>(CONTENT_DIR, 'articles')
     return [...articles].sort(compareArticlesNewestFirst)
   }
   ```

4. **Server functions** (`src/lib/queries.ts`): `loadArticles`, `loadArticle` (zod-validated slug), `loadManifest`, all via `createServerFn` so only handlers touch the filesystem.

5. **Routes**:
   - `/` (`routes/index.tsx`): `loadArticles()`, head `{ title: 'Acme' }`.
   - `/blog` and `/blog/$slug` (`routes/blog/$slug.tsx`): loader calls `loadArticle`, `notFound()` when missing. Head is built manually (`title` and `description`), **not** with `seoHead`.
   - `/__preview/$collection/$slug`: draft preview via `getPreviewEntry` and `previewHeaders` (section 7).
   - `/api/health` (`routes/api/health.ts`): `getManifest()` returns `{ ok: true, publicationId }` or 503 `{ ok: false, error }`.

6. **Rich text**: `ArticleBody` in `components/article-body.tsx` uses `richTextDocument(body)` with a custom `Markdown` components map.

7. **Fixtures** (`scripts/fixture-content.ts`): writes `manifest.json` (`publicationId: 'pub_fixture_acme'`) and `articles.json` with three articles. Builds `RichTextValue` locally with `parseMarkdown` and `renderHtml`. Used by `content.test.ts`.

8. **Docker** (`Dockerfile`): build stage gets `ARECA_CMS_URL` as ARG and the token as a BuildKit secret `ARECA_SITE_TOKEN`. `ARG ARECA_SNAPSHOT_ID` busts the cache of the pull layer. The runtime image copies `.output` and `src/generated`, on port 3000.

### Not demonstrated by the demo

- `seoHead`, `seoHeadHtml`, `seoJsonLd`: not used anywhere in the demo (grep confirmed).
- `createArecaClient`, `pullContent` from `./pull`, `manifestFromConfig`: not used directly. The demo calls the CLI.
- `manifest pull`, `init`, `run --`: not used.
- `ReferenceValue`, `image` handling beyond `heroImage`, `reference` fields: not used.

### Demo tests

- `src/lib/content.test.ts`: reads fixture articles sorted newest first, `getArticle`, `getManifest`, and `/areca pull/` error when content is removed.
- `scripts/verify-prerender.ts`: checks `.output/public/blog/<slug>/index.html` exists for each article.

---

## 10. Tests in the SDK (index of behaviour the tests pin)

| File | What it pins |
| --- | --- |
| `index.test.ts` | Client URLs, auth headers, 401/404 messages, unreachable CMS message, env fallback, pull/read round trip, readContent errors, preview helpers, rich-text accessors, parseArgs, `run(['pull'])` exit 1 on 404. |
| `seo.test.ts` | Full head mapping, null handling, author fallback, title templates, siteName override, noindex robots, JSON-LD escaping, `seoHeadHtml` escaping, single `</script>`. |
| `output-safety.test.ts` | Unsafe keys rejected before writing, symlink refusal, reserved and duplicate fields rejected before manifest POST, no schema-token fallback. |
| `manifest-pull.test.ts` | `diffManifests` add/change/remove and key-order independence, `formatManifestDiff`, manifestPull siteKey sources, refusal without `--yes` when non-TTY, `--yes` overwrite, prompt confirm and decline (mocks `@clack/prompts`). |
| `generate-config.test.ts` | Byte-for-byte demo config, optional fields, quoting, escaping, sort order, 80-column rule. |
| `init.test.ts` | Parsing of init/run/sync-manifest flags, init file outputs, `--force`, env upsert, gitignore dedupe, script patching, invalid site key and CMS URL, token not logged, `loadLocalEnv` precedence and comments, `run -- exits with child status`. |

Test examples not already shown:

```ts
// manifest-pull: refuses to overwrite a populated config without --yes when not a TTY
await expect(manifestPull({ cwd: dir, configPath: name, client: makeClient(), interactive: false }))
  .rejects.toThrow(/--yes/)

// init: exact generated config
// import { defineSiteContent } from '@areca-cms/site-sdk'\n\nexport default defineSiteContent({\n  siteKey: 'acme-site',\n  collections: {},\n})\n
// .env.example: 'ARECA_CMS_URL=http://localhost:3000\nARECA_SITE_TOKEN=\nARECA_SCHEMA_TOKEN=\n'
// .env.local:   'ARECA_CMS_URL=http://localhost:3000\nARECA_SITE_TOKEN=site-token\n'
// .gitignore:   '.env.local\nsrc/generated/content/\n'

// init: wraps dev
// { "dev": "vite --port 3001" } -> { "dev": "areca run -- vite --port 3001" }

// index: CLI exit code
await expect(run(['pull', '--out', outDir])).resolves.toBe(1) // prints "No publication exists..."
```

---

## 11. Discrepancies, undocumented features, and quirks

### 11.1 Docs vs code discrepancies

Documentation files checked: `packages/site-sdk/README.md` and `docs/SDK.md`.

1. **`dist/` is stale (build artifact, not docs).** `packages/site-sdk/dist/` has no `seo.js` or `seo.d.ts`. Its `index.js` therefore lacks the SEO exports, and the `./seo` export points at a missing file. Anything using the workspace package (the demo imports `@areca-cms/site-sdk`) fails until `pnpm --filter @areca-cms/site-sdk build`. `prepack` rebuilds, so a published tarball is unaffected.

2. **`--help` claim.** `docs/SDK.md` line 500 says "Use `--help` to display command usage". Only `areca --help` or `-h` as the first argument works. `areca pull --help` exits 1 with `Unknown argument: --help`.

3. **Help text omits variables.** `ARECA_SITE_KEY` (used by `manifest pull`) and `ARECA_SCHEMA_TOKEN` (used by `manifest push`) are documented in the markdown docs, but not in `areca --help` (`usage()` lists only `ARECA_CMS_URL` and `ARECA_SITE_TOKEN`).

4. **CLI synopsis in `docs/SDK.md` is incomplete.** Lines 491 to 494 omit `--out` and `--config` on `init` (added in prose on line 498) and `-y` on `init` and `manifest pull`. `README.md` line 82 says `manifest push` "Requires `ARECA_SCHEMA_TOKEN`". The code also requires `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` eagerly (`createArecaClient()` is called first). `README.md` lines 132 to 134 state this correctly.

5. **429 handling.** `docs/SDK.md` line 474 says to "Wait for the `Retry-After` seconds in the response". The SDK never reads `Retry-After`. It only formats `Failed to ... (429): <error>`. The CMS does send `Retry-After` (`apps/cms/src/server/http/rate-limit.ts`, 300 requests per 60 s per token for the site API, confirmed). The wait logic is the caller's job, and the docs read as if the SDK handles it.

6. **SEO example vs demo.** `docs/SDK.md` lines 277 to 351 say the `head`/`seoHead` example is what the demo does, and the snippet loads `findArticle` from `src/lib/content.ts`. The demo has `getArticle`. The demo itself does not call `seoHead` at all (its `/blog/$slug` head is hand-written with title and description only). `docs/SDK.md` line 248 correctly says the demo shows the `readContent` pattern.

7. **Reserved identifiers.** Docs say "Reserved names include `manifest`, `constructor`, `prototype`, `__proto__`, and Windows device names". Code additionally rejects: matching is case-insensitive (`MANIFEST`, `Con`), the rule applies to `field.collection` and `field.after` too, and the length limit is 64 total characters. The regex is `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`. This matches the docs' "at most 64" statement.

8. **Snapshot re-pull claim.** Docs (SDK.md lines 181 to 184) say pulls do not delete removed collection files. Code agrees. Note that the partial-write risk in section 4.7 is not documented.

9. **Rate-limit and manifest limits.** README and SDK.md say `413` above 256 KiB and 100 collections or 100 fields per collection. These are CMS-side limits. They were not verified in SDK code. (`apps/cms/src/server/content/manifest-limits.test.ts` exists.)

10. **Node version.** `engines` says `>=22.6.0` and the docs repeat it. The native `.ts` config import of `areca manifest push` and `manifest pull` depends on Node TypeScript stripping, which **(unverified)** is not available on 22.6 without a flag. The docs recommend Node 24 and mention `tsx`. The engine floor may be too low.

11. **`manifestFromConfig` and the reserved identifier rules** are exported from index but not documented in `docs/SDK.md` or the README.

12. **`manifest pull` overwrite behaviour.** Docs say it prompts before overwriting "a config that already defines collections". Code also overwrites silently when the existing config has zero collections, including comments and helper code. Docs (SDK.md line 150) say the file is replaced "including comments and helper functions", so the policy is consistent, but the zero-collection case is not stated.

13. **`areca sync-manifest` and `manifest push` extra arguments** are silently ignored. Not documented.

14. **Preview headers.** Docs say to "also set a robots meta tag". The SDK does not do that, and `previewHeaders()` only returns the two headers. This is consistent with the demo, but the docs mention it only in passing.

15. **`getPreviewEntry` `client` option.** Documented nowhere. It exists in code and is used by tests.

### 11.2 Undocumented features and quirks

- `getPreviewEntry` accepts an optional `client`.
- `readContent` refuses symlinked collection files at runtime (not only in `pull`), and it is synchronous.
- `readContent` does no runtime validation of the JSON it returns.
- `seoHead` returns a top-level `title` key in addition to `{ title }` inside `meta`.
- `seoHead` replaces only the first `%s` in `titleTemplate`.
- `seoHead` emits `article:author` as the author URL, falling back to the author name. The name is not an URL.
- `createArecaClient` does not validate the CMS URL protocol. `init` does.
- No HTTP timeouts. No retries. Response bodies are cast, not validated.
- `init` default CMS URL in the interactive prompt is `http://localhost:3000`.
- `init` wraps `dev` with `areca run --` unless the script contains `--env-file` or `areca run`.
- `init` does not add `.env` to `.gitignore`, only `.env.local` and the output directory.
- `.env` parsing: no `export` prefix, no inline comments, no escapes. An empty value in `.env.local` blocks `.env`.
- `areca run --` joins argv with spaces before `shell: true`.
- Flag values starting with `-` are rejected, so `--token -abc` fails.
- `init --token` puts the secret on the command line.
- `.env.local` is created with the default file mode.
- `pullContent` writes `manifest.json` before validating collection files for symlinks, so a failed pull can leave a mixed state.
- `parseArgs` treats `manifest push` and `sync-manifest` the same way.
- `index.ts` does not export `pullContent`, `readContent`, or the CLI helpers. They are reachable only through `./pull`.
- `diffManifests` and `formatManifestDiff` are internal and not exported, though they are the only way to produce a `changed` list programmatically.
- Exit code 0 on `init` cancellation and on `manifest pull` cancellation (the latter prints `Aborted`).
- `manifest pull` `--config` may point outside cwd, and loading the config executes it.

---

## 12. Quick reference: what an integrator needs

```ts
// config (areca.config.ts)
import { defineSiteContent } from '@areca-cms/site-sdk'
export default defineSiteContent({ siteKey: 'acme-site', collections: { articles: { route: '/blog/$slug', fields: [...] } } })

// server loader (never import into browser code)
import { readContent } from '@areca-cms/site-sdk/pull'
readContent<MyEntry>('src/generated/content', 'articles')

// rich text
import { richTextDocument } from '@areca-cms/site-sdk/rich-text'   // or from '@areca-cms/site-sdk'
// <Markdown>{richTextDocument(value)}</Markdown>   (from @tanstack/markdown/react, version 0.0.15)

// SEO
import { seoHead, seoHeadHtml, seoJsonLd } from '@areca-cms/site-sdk/seo'
seoHead(entry.seo, { titleTemplate: '%s · Acme', siteName: 'Acme' })

// preview (server only)
import { getPreviewEntry, previewHeaders } from '@areca-cms/site-sdk'

// programmatic
import { createArecaClient } from '@areca-cms/site-sdk'
import { pullContent } from '@areca-cms/site-sdk/pull'
```

Environment:
- `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` (required for any client).
- `ARECA_SCHEMA_TOKEN` (required only for `manifest push`).
- `ARECA_SITE_KEY` (only for `manifest pull` when the config is absent).

Summary of the `pull` output directory:

```text
src/generated/content/
  manifest.json      { publicationId, hash, createdAt, collections: { <key>: <count> } }
  <collection>.json  SnapshotEntry[]
```

---

## Appendix: file index

- `/Users/ek/development/projects/areca-cms/packages/site-sdk/package.json`
- `/Users/ek/development/projects/areca-cms/packages/site-sdk/src/index.ts`, `types.ts`, `client.ts`, `config.ts`, `preview.ts`, `seo.ts`, `rich-text.ts`, `pull.ts`, `identifiers.ts`
- `/Users/ek/development/projects/areca-cms/packages/site-sdk/src/cli.ts`, `args.ts`, `env.ts`, `load-config.ts`, `init.ts`, `manifest-pull.ts`, `generate-config.ts`
- Tests: `/Users/ek/development/projects/areca-cms/packages/site-sdk/src/*.test.ts`
- Demo: `/Users/ek/development/projects/areca-cms/examples/demo-site/` (`areca.config.ts`, `package.json`, `vite.config.ts`, `scripts/prebuild.mjs`, `scripts/fixture-content.ts`, `scripts/verify-prerender.ts`, `src/lib/content.ts`, `src/lib/queries.ts`, `src/routes/**`, `src/components/article-body.tsx`, `article-view.tsx`, `Dockerfile`)
- Docs compared: `/Users/ek/development/projects/areca-cms/docs/SDK.md`, `/Users/ek/development/projects/areca-cms/packages/site-sdk/README.md`
