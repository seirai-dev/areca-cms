# Research notes: SDK, API, configuration, development, troubleshooting

Scope: read-only extraction for the public docs site. No repo files were edited.
Repo: /Users/ek/development/projects/areca-cms (branch feat/refinements-and-missing).
Verification: source checks were done against `packages/site-sdk/src/*.ts`,
`apps/cms/src/env.ts`, `apps/cms/src/routes/api/sites/*`,
`apps/cms/src/server/http/rate-limit.ts`, `apps/cms/src/adapters/deployment/dokploy.ts`,
`examples/demo-site/*`. Where a doc claim was confirmed or contradicted by code, it is noted.

Note on working tree: `git status` at session start shows `packages/site-sdk/src/*`,
`docs/*`, `README.md`, `apps/cms/.env.example`, and `docker/*` as modified (uncommitted).
Docs describe the working tree, not the last commit. Treat any doc/code mismatch as possibly
mid-change.

---

## 1. docs/SDK.md

- **Path:** `/Users/ek/development/projects/areca-cms/docs/SDK.md` (500 lines)
- **Purpose:** End-to-end guide to integrating a Node.js website with an existing Areca site: schema, pull, read, render rich text, SEO, preview, production health checks, direct client use.
- **Audience:** developer (website builder); operator for the health-check and Dockerfile parts.

### 1.1 Prerequisites (verbatim list)

- A running Areca CMS instance and a site created in that CMS.
- The site's key and **site token**. The CMS shows the site token when it is created or rotated; save it in a secret store.
- The separate **schema token** to send schema changes. Find or rotate it in the site's Settings under Developer.
- Node.js 22.6 or newer. Node.js 24 LTS is recommended, especially for the CLI's native import of `areca.config.ts`.

Credential policy (verbatim): "The site token reads manifests and published snapshots. A signed, expiring preview token authorizes each draft preview. The schema token writes manifests. Never place these credentials in a public browser bundle or commit them to Git."

Screenshot referenced: `screenshots/current-developer-settings.png` (relative to docs/; file exists at `docs/screenshots/current-developer-settings.png`).

### 1.2 Install

```bash
pnpm add @areca-cms/site-sdk
```

- Inside this repo, `examples/demo-site` depends on `workspace:*`; install with `pnpm install` from root. Do not copy `workspace:*` into an unrelated project.
- ESM-only; does not import React.
- Markdown renderer pin (verbatim): "This SDK currently uses `@tanstack/markdown` 0.0.15, so install that compatible version rather than the latest major:"
  ```bash
  pnpm add @tanstack/markdown@0.0.15
  ```
  Confirmed: `packages/site-sdk/package.json` pins `"@tanstack/markdown": "0.0.15"` exactly.

### 1.3 Initialize (`areca init`)

```bash
pnpm exec areca init
```
Prompts for CMS base URL, site token, site key. Writes: starter `areca.config.ts`, `.env.example`, updates gitignored `.env.local`, adds generated content to `.gitignore`, creates empty generated manifest, and adds `sync-manifest` and `content:pull` package scripts if not defined. If a `dev` script does not load env files, init wraps it with `areca run --`.

Non-interactive (verbatim):
```bash
pnpm exec areca init \
  --cms-url https://cms.example.com \
  --token "$ARECA_SITE_TOKEN" \
  --site-key acme-site \
  --yes
```
"Review any existing `areca.config.ts` and `.env.example` before using `--force`, which allows init to overwrite them." Init writes CMS URL and site token to `.env.local`; the doc then tells you to add the schema token:
```dotenv
ARECA_SCHEMA_TOKEN=paste-schema-token-here
```
"The CLI automatically loads `.env.local`, then `.env`, from the current directory. Values already in the process environment take precedence."

### 1.4 Declare content model

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
        { key: 'body', label: 'Body', type: 'richtext', required: true },
        { key: 'cover', label: 'Cover', type: 'image' },
      ],
    },
  },
})
```
- `siteKey` must match the CMS site. Collection/field keys are stable identifiers used in entry data and filenames.
- `route` records the frontend route pattern; it does NOT generate routes.

### 1.5 Send schema (`areca manifest push`)

```bash
pnpm exec areca manifest push
pnpm exec areca manifest push ./config/areca.config.ts
```
- Uses `ARECA_SCHEMA_TOKEN`; CLI also requires `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` to construct the client.
- Default config path `./areca.config.ts`.
- "Only run schema publishing in the trusted authoring environment. Builds and routine content pulls need the site token, not the schema token. `areca sync-manifest` remains available as a deprecated alias for `manifest push`."

### 1.6 Pull schema back (`areca manifest pull`)

```bash
pnpm exec areca manifest pull --config ./areca.config.ts
```
- Replaces the full config file, including comments and helper functions.
- If file already defines collections: shows added/changed/removed summary and asks before replacing. `--yes` for automation.
- Existing `siteKey` preserved; if no config, set `ARECA_SITE_KEY` or run init first.

### 1.7 Pull content (`areca pull`)

```bash
pnpm exec areca pull
pnpm exec areca pull --out .cache/areca-content
```
- Default output: `src/generated/content/manifest.json` plus one JSON array per collection (e.g. `articles.json`).
- Fails if CMS has no publication.
- SDK rejects unsafe collection keys and symlink output files.
- Snapshot contains all collections. "Treat this snapshot as build input: visitor requests should read the local generated files rather than call the CMS."
- "A pull overwrites the manifest and JSON files for collections in the new snapshot, but it does not delete JSON files for collections removed since an earlier pull. Use the collection keys in the latest `manifest.json` as the list of current data; do not discover collections by listing the directory."
- Generated manifest records: publication ID, snapshot hash, creation time, collection counts.

### 1.8 Pull before build

```json
{
  "scripts": {
    "prebuild": "areca pull --out src/generated/content",
    "build": "vite build"
  }
}
```
- Requires `ARECA_CMS_URL`, `ARECA_SITE_TOKEN`, and a published snapshot.
- Demo `prebuild` (SDK.md wording): pulls when credentials set, reuses existing generated content when absent, allows local fixture when no CMS content.

Deployments started by Areca (verbatim key sentences): "For deployments started by Areca, the snapshot endpoint pins the active build to its publication, falling back to the live publication when no build is active. `createArecaClient().fetchSnapshot()` sends the site-token bearer header; it does not send a publication ID header or read `ARECA_SNAPSHOT_ID`. The Dokploy adapter sets `ARECA_SNAPSHOT_ID` as a changing Docker build argument to invalidate a cached content-pull layer. In a Dockerfile, declare that argument after dependency/SDK installation and before the build step that runs `areca pull`; keep the site token mounted as a BuildKit secret."

### 1.9 Read entries (`readContent`)

```ts
import { readContent } from '@areca-cms/site-sdk/pull'
import type { ImageValue, RichTextValue, SnapshotEntry } from '@areca-cms/site-sdk'

type Article = SnapshotEntry & {
  data: {
    title: string
    body: RichTextValue
    cover: ImageValue | null
  }
}

export function getArticles() {
  return readContent<Article>('src/generated/content', 'articles')
}
```
- Entries: `id`, `slug`, `publishedAt`, `data`, optional `seo`.
- Image: URL, nullable dimensions, alt text, MIME type.
- Rich text: Markdown source, TanStack Markdown AST, original JSON, static HTML.
- Reference: target collection, slug, ID.
- "the schema does not generate application types".
- TanStack Start: call reader from a server function; route loader calls the server function. Demo pattern: `examples/demo-site/src/lib/content.ts` and `src/lib/queries.ts`.
- "Since `readContent()` reads files at runtime, include `src/generated/content/` in your deployed server output or container."

### 1.10 Render rich text

```tsx
import { Markdown } from '@tanstack/markdown/react'
import { richTextDocument } from '@areca-cms/site-sdk'
import type { RichTextValue } from '@areca-cms/site-sdk'

export function ArticleBody({ body }: { body: RichTextValue }) {
  return <Markdown>{richTextDocument(body)}</Markdown>
}
```
- `richTextDocument()` also parses Markdown from older snapshots lacking the document property.
- `richTextMarkdown()` returns canonical source; `richTextHtml()` returns static HTML fallback.
- Markdown AST is pre-1.0; keep renderer aligned.

### 1.11 SEO (`seoHead`) — full route example

Three files in SDK.md: `src/lib/content.ts` (readContent helper `findArticle(slug)`), `src/lib/queries.ts` (`createServerFn({ method: 'GET', ...loose }).validator(z.object({ slug: z.string().min(1) })).handler(({ data }) => findArticle(data.slug) ?? null)` where `const loose = { strict: { output: false } as const }`), and `src/routes/blog/$slug.tsx` (loader throws `notFound()` when missing; `head: ({ loaderData }) => seoHead(loaderData?.article.seo, { titleTemplate: '%s · Acme' })`).

- Note: example uses `.validator(...)` on `createServerFn` — TanStack Start API naming; not verified against the repo's pinned version.
- Helper maps SEO to title, description, canonical link, robots, Open Graph, Twitter, author, JSON-LD.
- `titleTemplate` is `%s`-string or function; `siteName` overrides `og:site_name`. Missing values omitted; older snapshots without `seo` return empty head data.
- "Render SEO summaries, key takeaways, and FAQ content visibly on the page when corresponding structured data is present."
- Astro/SSR: `seoHeadHtml()` from `@areca-cms/site-sdk/seo` (escapes markup, safe JSON-LD). `seoJsonLd()` returns JSON-LD strings.

### 1.12 Draft preview

```ts
import { getPreviewEntry, previewHeaders } from '@areca-cms/site-sdk'

const { entry } = await getPreviewEntry({ token })
const headers = previewHeaders()
// Apply headers to the server response and render the entry.
```
- CMS opens production URL with collection, slug, signed token.
- `getPreviewEntry()` returns `{ collection, slug, entry }` (SDK.md says destructure `entry`).
- Headers: `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`. Also set robots meta.
- Never cache or log preview token or draft response. Show a message for invalid/expired tokens and missing entries.
- Demo route `/__preview/$collection/$slug`. Preview pages excluded from prerendering.

### 1.13 Production health check

- In CMS **Production** mode, Go live requires deployment target + health-check URL. CMS waits until deployed site reports publication ID it just built.
- Health endpoint JSON (verbatim): `{ "ok": true, "publicationId": "the-publication-id" }`
- Demo `/api/health` returns 503 if manifest missing.
- Implementation (verbatim, TanStack Start):
```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: () => {
        try {
          const path = join(process.cwd(), 'src/generated/content/manifest.json')
          const manifest = JSON.parse(readFileSync(path, 'utf8'))
          if (typeof manifest.publicationId !== 'string' || !manifest.publicationId) {
            throw new Error('Publication ID missing')
          }
          return Response.json({ ok: true, publicationId: manifest.publicationId })
        } catch {
          return Response.json({ ok: false }, { status: 503 })
        }
      },
    },
  },
})
```
- Dockerfile line (verbatim): `COPY --from=build /app/examples/demo-site/src/generated ./src/generated`
- Demo Docker image listens on port 3000.
- **Demo** publishing mode skips deployment and health verification and creates a demo snapshot.

### 1.14 Client directly

```ts
import { createArecaClient } from '@areca-cms/site-sdk'
import { pullContent } from '@areca-cms/site-sdk/pull'

const client = createArecaClient()
const manifest = await client.fetchManifest()
const snapshot = await client.fetchSnapshot()
await pullContent({ outDir: 'src/generated/content', client })
```
- Methods: `fetchManifest()`, `fetchSnapshot()`, `syncManifest(config)`, `fetchPreview(token)`.
- `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` required to create client. `syncManifest()` also requires `ARECA_SCHEMA_TOKEN`. Options `cmsUrl`, `siteToken`, `schemaToken`.

### 1.15 Common errors (verbatim table)

| Message or behavior | What to check |
| --- | --- |
| Missing `ARECA_CMS_URL` or `ARECA_SITE_TOKEN` | Set them in the environment or in `.env.local` in the directory where the CLI runs. |
| Missing `ARECA_SCHEMA_TOKEN` during manifest push | Get the schema token from the site's Developer settings and set it in the authoring environment. |
| `401` / unauthorized | Check which credential the operation needs and whether it was rotated. Schema push needs the schema token; manifest and snapshot reads need the site token. Preview needs the URL's current signed token. |
| `429` / too many requests | Wait for the `Retry-After` seconds in the response, then retry. Site manifest and snapshot routes allow 300 requests per minute per token. |
| No publication exists | Publish content in the CMS, then rerun `areca pull`. |
| No content file for collection | Pull content first and confirm the collection key matches the schema. |
| TypeScript config import fails | Use Node 24 or run the CLI through `tsx`, as suggested in the error. |

Also: "The client does not retry failed HTTP requests. Network errors include the CMS URL and underlying fetch detail. HTTP errors include their status and CMS error message when available. The CLI exits nonzero on an error."
"Manifest push can return `400` for an invalid schema or `413` when the JSON manifest exceeds 256 KiB. The server accepts up to 100 collections and 100 fields per collection."

### 1.16 CLI reference (verbatim block)

```text
areca init [--cms-url <url>] [--token <token>] [--site-key <key>] [--yes] [--force]
areca pull [--out <directory>]
areca manifest push [config]
areca manifest pull [--config <path>] [--yes]
areca run -- <command>
```
"`areca init` also accepts `--out` and `--config`; its defaults are `src/generated/content` and `areca.config.ts`. `--yes`/`-y` skips interactive prompts where supported."

(Note: the block omits `areca sync-manifest` and the `--out`/`--config` flags that the parser actually accepts — see Section 9, item 5.)

---

## 2. docs/API.md

- **Path:** `/Users/ek/development/projects/areca-cms/docs/API.md` (137 lines)
- **Purpose:** HTTP contract for the site SDK (the four `/api/sites/*` endpoints) and the matching client methods.
- **Audience:** developer (contract); contributor (behavior notes).

### 2.1 Base URL and credentials (verbatim table)

| Credential | Header | Access |
| --- | --- | --- |
| Site token | `Authorization: Bearer <site-token>` | Read the manifest and current snapshot. |
| Schema token | `Authorization: Bearer <schema-token>` | POST schema manifest. |

- `ARECA_CMS_URL`: SDK removes trailing slashes.
- `ARECA_SITE_TOKEN` and `ARECA_SCHEMA_TOKEN` are separate. SDK requires `ARECA_SITE_TOKEN` when `createArecaClient()` is constructed, including before a schema push. POST uses `ARECA_SCHEMA_TOKEN`; GET uses site token.

### 2.2 Endpoints (verbatim table)

| Method and path | Authorization | Purpose | Success body |
| --- | --- | --- | --- |
| `GET /api/sites/manifest` | Site token | Read the site's content schema | `{ "collections": { ... } }` |
| `POST /api/sites/manifest` | Schema token | Create or update the site's schema | `{ "ok": true }` |
| `GET /api/sites/snapshot/current` | Site token | Get the current publication snapshot | `Snapshot` object |
| `GET /api/sites/preview?token=<preview-token>` | Signed, expiring preview token | Get one draft entry | `{ "collection", "slug", "entry" }` |

Details per endpoint (from doc + source check):

**GET /api/sites/manifest** — site token. Success 200 `{ collections }` (enabled collections only per source `listCollections(site.id, { enabledOnly: true })`). Missing/invalid auth: 401 `{ "error": "Unauthorized" }` (source confirmed).

**POST /api/sites/manifest** — schema token (source: `authenticateSite(request, 'schema')`). Body: manifest shape `{ collections: {...} }`; SDK converts config via `manifestFromConfig` (labels preserved when provided). Responses: 200 `{ ok: true }`; 401 `{ "error": "Unauthorized" }`; 413 `{ "error": "Manifest is larger than <MANIFEST_MAX_BYTES> bytes" }` (source confirmed); 400 `{ "error": "Invalid body", "issues": [{ "message": "Expected JSON" }] }` for non-JSON (source confirmed); other 400s for invalid schema (doc only, not re-verified).

**GET /api/sites/snapshot/current** — site token. Success: `Snapshot` = `{ publicationId, siteKey, createdAt, hash, collections: { [key]: SnapshotEntry[] } }`. 404 when no publication (source confirmed, `current.ts:74`); 401 (source confirmed, `current.ts:19`); 429 rate limit.

**GET /api/sites/preview?token=...** — authorized by the signed token only. Source (`apps/cms/src/routes/api/sites/preview.ts`): 401 `{ "error": "Unauthorized" }` when token missing, undecodable, site not found, or signature invalid; 404 `{ "error": "Not found" }` when entry not found; 200 `{ collection, slug, entry }`. Response headers from source: `Cache-Control: no-store, private` and `X-Robots-Tag: noindex` on every response (including 401/404). **The server does not read the site-token bearer header for preview.**

### 2.3 Snapshot pinning (doc prose, verbatim essence)

"The snapshot endpoint pins reads to the publication associated with the site's active build job, including an uncertain dispatch. With no active build, it returns the live publication (or the current demo publication when the site is in Demo mode). The SDK makes a normal bearer-authenticated GET; it does not send a publication ID header or read `ARECA_SNAPSHOT_ID`. Dokploy changes `ARECA_SNAPSHOT_ID` as a Docker build argument to invalidate a cached pull/build layer so that the new build runs the GET again."

### 2.4 Preview token rules

"Do not place the preview token in logs or analytics. The SDK sends it as the preview URL's query parameter; handle the token only on the server, set `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`, and do not cache the response."

### 2.5 SDK client (verbatim)

```ts
import { createArecaClient } from '@areca-cms/site-sdk'
import type { SiteContentConfig } from '@areca-cms/site-sdk'

const client = createArecaClient()
const manifest = await client.fetchManifest()
const snapshot = await client.fetchSnapshot()
const config: SiteContentConfig = { siteKey: 'acme-site', collections: {} }
await client.syncManifest(config)
const preview = await client.fetchPreview(previewToken)
```
Options form:
```ts
const client = createArecaClient({
  cmsUrl: 'https://cms.example.com',
  siteToken: process.env.ARECA_SITE_TOKEN,
  schemaToken: process.env.ARECA_SCHEMA_TOKEN,
})
```
- `syncManifest(config)` requires both tokens (schema for POST). `fetchManifest`, `fetchSnapshot`, `fetchPreview` include site-token bearer header. **Source check:** `createArecaClient` throws if `ARECA_SITE_TOKEN` is missing even for `fetchPreview` / `getPreviewEntry`, because `siteToken` is required at construction (`client.ts`). So a preview-rendering server needs `ARECA_SITE_TOKEN` set even though the preview endpoint does not validate it. Not documented.

- Subpath: `@areca-cms/site-sdk/pull` exports `pullContent({ outDir, client? })` and `readContent<T>(outDir, collectionKey)`.

### 2.6 Errors and retries

- Client throws `Error` if URL/token settings missing, CMS unreachable, or CMS responds unsuccessfully. HTTP errors include status and response `error` message.
- Missing snapshot has dedicated message (source confirmed: `No publication exists for this site. Publish content in the CMS before running areca pull.`).
- CLI prints error and exits 1.
- SDK does not retry automatically.
- Rate limit: "Site manifest and snapshot routes are limited to 300 requests per minute per site token (or client IP when no token is supplied and trusted proxy IPs are configured). A rate-limited response is HTTP `429` with `{ "error": "Too many requests" }` and a `Retry-After` header in seconds." Source: `SITE_API_RULE = { limit: 300, windowSeconds: 60 }`, `Retry-After` set in `rate-limit.ts:69`. Confirmed. Note: the doc says the limit covers manifest and snapshot routes; the preview route's rate-limit coverage is not stated.
- Manifest limits: 256 KiB body (413), 100 collections, 100 fields per collection. Select fields: max 200 options. Collection routes: max 500 chars. Labels: max 200 chars. Descriptions: max 1,000 chars. Option strings: max 200 chars. Invalid manifests `400`; oversized `413`.
  Source confirmed: `MANIFEST_MAX_BYTES` used in manifest route; 256 KiB matches `256 * 1024` pattern usage elsewhere — exact constant not re-read.

### 2.7 Types (verbatim export list in doc)

"The package root exports `ArecaClient`, `ArecaClientOptions`, `SiteManifest`, `Snapshot`, `SnapshotEntry`, `PreviewResult`, `PulledContentManifest`, schema types, and `ImageValue`, `RichTextValue`, `ReferenceValue`, and `SeoMeta`."

Source (`packages/site-sdk/src/index.ts`) also exports: `defineSiteContent`, `manifestFromConfig`, `getPreviewEntry`, `previewHeaders`, `seoHead`, `seoHeadHtml`, `seoJsonLd`, `HeadLink`, `HeadMeta`, `HeadScript`, `SeoHeadOptions`, `SeoHeadResult`, `richTextDocument`, `richTextHtml`, `richTextMarkdown`, `CollectionConfig`, `Field`, `FieldType`, `SiteContentConfig`. (Undocumented in API.md: `defineSiteContent`, `manifestFromConfig`, the `Head*` and `SeoHead*` types.)

Type definitions (source, `types.ts`) useful for docs:
- `FieldType` = `'text' | 'textarea' | 'richtext' | 'image' | 'date' | 'datetime' | 'select' | 'reference' | 'slug' | 'boolean' | 'number' | 'url'`.
- `Field` = `{ key, label, type, required?, options?, collection?, description?, after? }` (`after` = other date/datetime key this value must be on or after).
- `CollectionConfig` = `{ route, label?, fields: Field[] }`.
- `SiteContentConfig` = `{ siteKey, collections: Record<string, CollectionConfig> }`.
- `SiteManifest` = `{ collections }`.
- `RichTextValue` = `{ json: unknown, markdown: string, document: MarkdownDocument, html: string }`.
- `ImageValue` = `{ url, width: number|null, height: number|null, alt, mimeType }`.
- `ReferenceValue` = `{ collection, slug, id }`.
- `SnapshotEntry` = `{ id, slug, publishedAt: string|null, data: Record<string, unknown>, seo?: SeoMeta }`.
- `SeoMeta` (full shape in source): `title`, `description`, `canonicalUrl`, `robots: {index, follow, content}`, `focusKeyphrase`, `openGraph: {type, title, description, url, siteName, image, publishedTime, modifiedTime}`, `twitter: {card, title, description, image}`, `author: {name, url, bio} | null`, `summary`, `keyTakeaways: string[]`, `faq: {question, answer}[]`, `about: {name, sameAs}[]`, `jsonLd: Record<string, unknown>[]`.
- `Snapshot` = `{ publicationId, siteKey, createdAt, hash, collections: Record<string, SnapshotEntry[]> }`.
- `PreviewResult` = `{ collection, slug, entry: SnapshotEntry }`.
- `PulledContentManifest` = `{ publicationId, hash, createdAt, collections: Record<string, number> }`.
- `ArecaClientOptions` = `{ cmsUrl?, siteToken?, schemaToken? }`.
- `ArecaClient` = `{ syncManifest(config) => Promise<{ok:true}>, fetchManifest() => Promise<SiteManifest>, fetchSnapshot() => Promise<Snapshot>, fetchPreview(token) => Promise<PreviewResult> }`.

Doc claim: "Collection field values are application-defined" — confirmed (`data: Record<string, unknown>`).

---

## 3. docs/INTEGRATIONS.md

- **Path:** `/Users/ek/development/projects/areca-cms/docs/INTEGRATIONS.md` (181 lines)
- **Purpose:** Operating contract for the integrations in audit section 7: frontend SDK, Dokploy deployment, S3 storage, invitation email. Covers publication identity, dispatch recovery, invitation recovery, secrets, credential rotation, verification suites.
- **Audience:** operator (recovery, rotation); contributor (verification suites).

### 3.1 Identity and publication requests

- Each release has publication ID, immutable snapshot, snapshot hash. Build job identifies publication and site; logs include job ID.
- Publish and rollback RPCs require UUID `requestKey`. Retrying same key/actor/site/operation/payload returns original publication and job. Reusing a key for different actor/site/operation/payload = conflict.
- Go-live UI retains request key and payload in browser local storage until request resolves (survives reload).
- "Scheduled releases run as the system. Their `publication.requested` audit entry records `scheduledBy` and, for multiple approvers, `approvers`; a single approver is the audit actor."

### 3.2 Deployment delivery (Dokploy)

- Worker persists dispatch intent and target before calling Dokploy. Adapter calls carry job ID, publication ID, snapshot hash.
- "The adapter sets `ARECA_SNAPSHOT_ID` to the publication ID before deploying and tags the Dokploy deployment with `title=areca:<jobId>` plus publication and hash in its description."
  **Contradiction:** SDK.md, API.md, and the source (`apps/cms/src/adapters/deployment/dokploy.ts:202-220`, which passes `ARECA_SNAPSHOT_ID` as a build arg) say it is a Docker **build argument**. INTEGRATIONS.md says "sets ... before deploying", which reads like an env var.
- Saved target pins application ID and health URL; recovery resolves org's current Dokploy host and credential. Do not change host during an uncertain dispatch.
- Retries: safe reads and identical env writes have at most 3 attempts with short exponential backoff. Deployment POST sent once. Ambiguous response → adapter searches for tagged deployment before proceeding.

Recovery workflow (verbatim numbered steps from the doc):
1. Open the failed job's details in **Go-live** and note its job/publication IDs. In Dokploy, inspect the application's deployment history for `areca:<jobId>` and the matching publication/hash description. Do not manually launch a replacement while the original build might still run.
2. Use **Reconcile deployment** on that job after restoring Dokploy connectivity or allowing its deployment record to appear. This resumes polling the same dispatch and then checks the publication-specific health response.
3. If no matching record can be established, retain the block and investigate upstream. A missing record is not proof that the deploy request was rejected. Once an agency administrator has verified that upstream work is stopped and drained (including queued builds), they can explicitly resolve the uncertain job with that confirmation and an investigation reason. This transaction records `publication.dispatch_resolved` with the administrator and reason, marks the publication failed and releases the site for a new deliberate publication. It never sends a deploy request or marks the uncertain release live. Owners can reconcile but cannot perform this terminal resolution.

- Confirmed failures before dispatch release the pin and leave the previous release live. Old jobs recovered from `deploying` without dispatch identity require manual investigation.

### 3.3 Invitation recovery

- Invitation creation persists invitation and audit record before sending email; sending is synchronous and bounded by timeouts; draft saves do not send email.
- In **People**, owners or agency administrators can resend, copy acceptance link, or revoke. Resend rotates the token and renews the seven-day expiry (old link stops working).
- Submitting another invitation while one is pending reports a conflict.
- Acceptance requires signed-in account's email to match invitation. Accepted/revoked invitations cannot be resent.
- No background email retry service. "Delivery status means the SMTP server accepted the message..."

### 3.4 Secrets and diagnostics

- Organization Dokploy API keys: AES-256-GCM with organization context; browser gets status only.
- Dokploy requests require HTTPS in production and reject redirects.
- Build log: each line bounded to ~8 Ki characters, each job log to 256 Ki characters, retaining tail with one truncation marker. Source confirms `MAX_JOB_LOG_CHARS = 256 * 1024` in `worker.ts:75`.

### 3.5 Credential rotation

- Dokploy API key: create replacement in Dokploy, save in org CMS settings, verify, revoke old.
- DB/Redis/S3/SMTP: change credential, update CMS secret configuration, restart CMS instances.
- Site token rotation invalidates old token immediately; update Dokploy build secrets and local SDK config together.
- Encryption key rotation (`DOKPLOY_CREDENTIALS_ENCRYPTION_KEY`), numbered:
  1. Pause publication workers and scheduling on every CMS instance and take a database backup paired with the current encryption key. Keep that key securely with backups encrypted under it. Obtain replacement Dokploy API keys for each configured organization before changing the encryption key.
  2. Generate a fresh 32-byte base64 key through the existing secrets management process. Set the same new value on every CMS instance and restart them together with workers still paused. Old encrypted credentials cannot be read at this point.
  3. Re-enter each organization's Dokploy API key through agency administration. Verify each connection, then take a new database backup paired with the new encryption key before resuming workers and scheduling.
- "If rotation must be abandoned, restore the pre-rotation database and its matching key together. Merely changing the environment key back does not decrypt rows already replaced under the new key. Never rotate the encryption key as part of an ordinary upgrade or restore."

### 3.6 Verification (test files cited)

- `apps/cms/src/server/publishing/request-idempotency.db.test.ts`
- `apps/cms/src/features/golive/request-identity.test.ts`
- `apps/cms/src/adapters/deployment/dokploy.test.ts` and `apps/cms/src/server/publishing/deployment-delivery.db.test.ts`
- `apps/cms/src/server/publishing/publishing.test.ts` and `worker-pool.db.test.ts`
- `apps/cms/src/server/admin/invitation-delivery.test.ts`
- `apps/cms/src/server/ops/ops.db.test.ts` and `apps/cms/src/server/log.test.ts`
- Relevant rows of `apps/cms/src/server/security/authz-matrix.test.ts`

Doc: "Database suites require an isolated PostgreSQL database with all migrations applied; do not reset the development database to run them. Run suites that claim the global job queue sequentially." Also: "Automated validation uses fake adapters; live Dokploy and end-to-end browser UI verification are not claimed."

---

## 4. docs/CONFIGURATION.md

- **Path:** `/Users/ek/development/projects/areca-cms/docs/CONFIGURATION.md` (134 lines)
- **Purpose:** Every server-side CMS environment variable, grouped.
- **Audience:** operator.

### 4.1 Mechanics

"The CMS reads its server settings from the process environment. For local work, copy `apps/cms/.env.example` to the gitignored `apps/cms/.env.local`; for Docker, use `docker/.env` with `docker/compose.yml`. Keep the same values on every CMS process that shares a database. Never commit either environment file."

Source: `apps/cms/src/env.ts` calls `config({ path: ['.env.local', '.env'] })` (dotenv, cwd-relative) and validates with `@t3-oss/env-core` + zod; `emptyStringAsUndefined: true`; `skipValidation` when `SKIP_ENV_VALIDATION=true` or `npm_lifecycle_event === 'build'`.

### 4.2 Required settings (verbatim table)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL. |
| `BETTER_AUTH_SECRET` | Signs authentication sessions. Keep stable; changing it signs everyone out. |
| `BETTER_AUTH_URL` | Canonical CMS URL used by authentication callbacks. Include the public scheme and host. |
| `APP_URL` | CMS origin included in invitation and asset URLs. Set it to an origin reachable by the browser and any site build that fetches assets. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | S3-compatible object storage for uploaded assets and branding. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | SMTP server and sender for invitation email. |
| `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` | Base64-encoded 32-byte key that encrypts organization Dokploy credentials in PostgreSQL. |

Source check: env.ts marks `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_URL`, `S3_*` (5), `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` as required. `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` regex `^[A-Za-z0-9+/]{43}=$`. `DATABASE_URL` and `BETTER_AUTH_URL`/`APP_URL`/`S3_ENDPOINT`/`SERVER_URL`... must be URLs (zod `.url()`). Note `S3_ENDPOINT` is a URL.

Key generation (verbatim):
```sh
openssl rand -hex 32       # BETTER_AUTH_SECRET
openssl rand -base64 32    # DOKPLOY_CREDENTIALS_ENCRYPTION_KEY
```
Doc note: `BETTER_AUTH_SECRET` generated with `-hex 32` in the doc, but env.ts only requires `min(1)` for it. Hex is not mandatory; the doc is a recommendation.

SMTP (verbatim): "The current mail adapter uses these three SMTP settings and does not configure SMTP username/password authentication. Use a trusted relay reachable from the CMS host; do not expose an unauthenticated relay to the public internet."

Encryption-key warning (verbatim): "Keep the Dokploy encryption key with the database backup. There is no automatic re-encryption: changing or losing it makes saved Dokploy credentials unreadable. The same applies when restoring a database; restore the matching key. See the recovery guide and the detailed Docker recovery runbook."

### 4.3 URLs and local networking (verbatim)

- Local Compose stack: CMS `http://localhost:3000`, demo site `http://localhost:3001`, PostgreSQL `localhost:5432`, RustFS S3 `localhost:9000`, Mailpit inbox `http://localhost:8025`. Inside Compose: service names `postgres`, `rustfs`, `mailpit`, `redis`.
- "`BETTER_AUTH_URL` must match the URL users use to open the CMS so OAuth and SSO callbacks land on the right origin. `APP_URL` is used to create invitation and asset links. For Dokploy builds, the CMS and its asset URLs must be reachable from the Dokploy host; `localhost` there means the Dokploy container itself."

Optional URL/storage (verbatim table):

| Variable | Default or effect |
| --- | --- |
| `SERVER_URL` | Optional server URL override. Usually leave unset. |
| `REDIS_URL` | `redis://localhost:6379`; used for shared rate-limit counters. Redis failure is reported as degraded and rate limiting fails open. |
| `S3_FORCE_PATH_STYLE` | `false`; set `true` for path-style S3 endpoints such as local RustFS/MinIO. |

### 4.4 Authentication and integrations (verbatim)

- Email/password enabled by default. `AUTH_EMAIL_PASSWORD_ENABLED=false` removes its form and rejects password sign-in. The first `/setup` account still uses a password.

Provider table (verbatim):

| Provider | Settings | Callback URL |
| --- | --- | --- |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `<BETTER_AUTH_URL>/api/auth/callback/github` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `<BETTER_AUTH_URL>/api/auth/callback/google` |
| Discord | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | `<BETTER_AUTH_URL>/api/auth/callback/discord` |
| Microsoft Entra ID | `MICROSOFT_SSO_CLIENT_ID`, `MICROSOFT_SSO_CLIENT_SECRET`, `MICROSOFT_SSO_TENANT_ID` | `<BETTER_AUTH_URL>/api/auth/sso/callback/microsoft` |

- "Entra requires a concrete directory/tenant ID; `common` is not supported. Its optional `MICROSOFT_SSO_DOMAIN` helps route a matching email domain to the provider. Restart the CMS after changing these settings. Sign-in remains invite-only. Agency administrators must enroll in TOTP by default; `ADMIN_MFA_REQUIRED=false` is only for isolated development or end-to-end test stacks."
- `VITE_APP_TITLE` optional; client-exposed variables must use `VITE_` prefix.
- `AI_SETTINGS_ENCRYPTION_KEY` optional: base64 32-byte key for the OpenRouter key saved under `/agency/ai`. Without it, AI SEO generation unavailable. Changing it means re-entering provider key. Generate with `openssl rand -base64 32`.

Source check: env.ts confirms all Provider vars, `MICROSOFT_SSO_DOMAIN`, `ADMIN_MFA_REQUIRED` default `true`, `SETUP_TOKEN` min 16, `AI_SETTINGS_ENCRYPTION_KEY` optional with same regex. Note: **`ADMIN_MFA_REQUIRED` is not in the doc's "Deployment and safety switches" table; it's only in prose.**

### 4.5 Deployment and safety switches (verbatim table)

| Variable | Default | Use |
| --- | --- | --- |
| `WORKER_ENABLED` | `true` | Runs publication workers and schedule processing in this CMS process. Set false only during maintenance or when publication and scheduled publishing are intentionally paused. |
| `WORKER_CONCURRENCY` | `2` | Maximum concurrent build jobs per process, from 1 to 16. |
| `WORKER_DRAIN_TIMEOUT_MS` | `8000` | How long shutdown waits for active jobs. Keep below the container stop grace period. |
| `DOKPLOY_DEV_FALLBACK_ENABLED` | `false` | Allows the legacy process-wide `DOKPLOY_URL` and `DOKPLOY_API_KEY` pair in non-production development only. Production ignores this fallback. |
| `DOKPLOY_URL`, `DOKPLOY_API_KEY` | unset | Legacy process-wide Dokploy connection, used only when the development fallback above is enabled. Normal deployments save credentials per organization in the CMS. |
| `DOKPLOY_ALLOW_INSECURE_HTTP` | unset | Allows HTTP Dokploy API URLs. Use only for isolated local/LAN development; production requires HTTPS. |
| `ALLOW_PRIVATE_HEALTH_CHECKS` | unset | Allows private or local health-check targets for Dokploy. Use only for isolated local/LAN development. |
| `RATE_LIMIT_TRUST_PROXY` | `false` | Use forwarding headers for client IP only when a trusted reverse proxy replaces those headers. |
| `SETUP_TOKEN` | generated while first account is absent | Optional first-run `/setup` token; if supplied, it must be at least 16 characters. If omitted, the process generates and logs one while setup is needed. |

"Do not enable the private-network or insecure-HTTP switches on a public CMS."

Source check: `WORKER_CONCURRENCY` min 1 max 16 default 2 (confirmed); `WORKER_DRAIN_TIMEOUT_MS` default 8000 (confirmed); `WORKER_ENABLED` any value except `'false'` is true (defaults true; confirmed).

### 4.6 Operations settings (verbatim table)

| Variable | Default | Use |
| --- | --- | --- |
| `METRICS_TOKEN` | unset | Bearer token of at least 16 characters for `/api/metrics`; unset returns 404. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, or `silent`. |
| `DB_CONNECT_TIMEOUT_MS` | `5000` | PostgreSQL connection wait limit; `0` disables it. |
| `DB_STATEMENT_TIMEOUT_MS` | `15000` | Per-query PostgreSQL statement deadline; `0` disables it. |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | `30000` | Closes transactions idle while holding a connection or lock; `0` disables it. |
| `READINESS_TIMEOUT_MS` | `3000` | Per-dependency readiness deadline. |
| `READINESS_MAX_QUEUE_AGE_SECONDS` | `900` | Oldest queued build age before readiness fails. |
| `READINESS_MAX_TICK_AGE_SECONDS` | `300` | Worker/scheduler heartbeat and stale-lease age before readiness fails. |

Source check: `METRICS_TOKEN` min 16 and `/api/metrics` route exists (`apps/cms/src/routes/api/metrics.ts`). `LOG_LEVEL` is **not** in `env.ts`; it is read directly in `apps/cms/src/server/log.ts` (comment lists debug|info|warn|error|silent). It is therefore unvalidated by the env schema.

### 4.7 Applying changes (verbatim)

"After changing server environment settings, restart the CMS process or container. Do not print secret values in logs or issue reports. Rotate compromised secrets at the affected provider or service, then update the CMS configuration and follow deployment secret rotation. Changing `BETTER_AUTH_SECRET` invalidates sessions; changing an encryption key makes the data encrypted with its old value unreadable until the original key is restored."

### 4.8 Settings present in source but NOT in CONFIGURATION.md

From `apps/cms/src/env.ts`:
- `AUTH_EMAIL_PASSWORD_ENABLED` — documented in prose, not in a table.
- `ADMIN_MFA_REQUIRED` — prose only.
- `SETUP_TOKEN` — documented.
- `S3_FORCE_PATH_STYLE` — documented.
- `DOKPLOY_URL` / `DOKPLOY_API_KEY` — documented.
- `WORKER_*` — documented.
- All `DB_*`, `READINESS_*` — documented.

Not in env.ts but referenced in docs/code:
- `LOG_LEVEL` (log.ts).
- `ARECA_SNAPSHOT_ID`: not a CMS env var; it is a Docker build arg (see §3, §7). `apps/cms/scripts/dokploy-setup.ts:125` writes `ARECA_SNAPSHOT_ID=0` into a generated env block — undocumented.
- `ARECA_SITE_KEY` (SDK env, used by `manifest pull`) — not in CONFIGURATION (that's SDK-side; see §5).

---

## 5. docs/DEVELOPMENT.md

- **Path:** `/Users/ek/development/projects/areca-cms/docs/DEVELOPMENT.md` (82 lines)
- **Purpose:** Contributor workflow: local dev, checks per package, tests, database changes, docs maintenance.
- **Audience:** contributor.

### 5.1 Local workflow (verbatim commands)

```sh
pnpm install --frozen-lockfile
pnpm dev
```
```sh
pnpm --filter @areca-cms/site-sdk build
pnpm --filter @areca/demo-site dev
```
- CMS runs on port 3000. "Infrastructure comes from the root `docker-compose.yml`." Demo site runs separately on port 3001.
- Demo: follow the demo README to push its manifest and generate content first.
- SDK workspace package exports built `dist`; rebuild after SDK changes.
- Do not point local reset/seed/migration experiments/integration tests at production resources.

Node/pnpm: "The repository's CI and CMS Dockerfile currently use Node 24 and pnpm 12. Use the pinned versions recorded in `.github/workflows/ci.yml` and `apps/cms/Dockerfile`."

**Contradiction/ambiguity:** DEVELOPMENT.md says infrastructure is from root `docker-compose.yml`; CONFIGURATION.md says Docker uses `docker/compose.yml`. Both files exist (`/Users/ek/development/projects/areca-cms/docker-compose.yml` and `.../docker/compose.yml`). Which one a new contributor should use is not explained.

### 5.2 Checks by package (verbatim table)

| Change | Checks |
| --- | --- |
| SDK | `pnpm --filter @areca-cms/site-sdk typecheck`, `pnpm --filter @areca-cms/site-sdk test` |
| CMS | `pnpm --filter @areca/cms typecheck`, relevant unit tests, `pnpm --filter @areca/cms test:scripts` for scripts |
| Demo website | SDK build first, then `pnpm --filter @areca/demo-site typecheck` and `pnpm --filter @areca/demo-site test` |
| Recovery tooling | `node --test docker/*.test.mjs` |
| Documentation | Verify commands and examples against source; check links, screenshots, and `git diff --check` |

CMS typecheck compiles Paraglide output first. Dev server/build generate routes and translation output.

### 5.3 Unit tests without services

```sh
SKIP_INTEGRATION_TESTS=true pnpm --filter @areca/cms test
```
PowerShell: `$env:SKIP_INTEGRATION_TESTS = 'true'`, run, then remove variable. "Skipping integration suites verifies only the remaining unit tests."

### 5.4 Integration and browser tests

- `pnpm test` includes service-dependent suites and can change test data. Use dedicated DB and bucket. "ordinary `pnpm test:e2e` runs a setup project that clears the configured database and upload bucket. Never use it against a stack whose data you want to retain."
- Isolated workflow provisions `areca_e2e`, bucket `areca-e2e`, Redis DB 1, CMS on port 3100:
  ```sh
  pnpm --filter @areca/cms test:e2e:isolated
  pnpm --filter @areca/cms test:e2e:qa:isolated
  ```
  First: setup + functional Chromium tests. Second: QA walkthrough. Infrastructure must be running.
- Env vars: `PW_CHROMIUM_PATH` (local Chromium), `QA_SCREENSHOT_DIR` (walkthrough images), `PLAYWRIGHT_BASE_URL` (server for non-isolated runs). Read `apps/cms/scripts/e2e-isolated.mjs` before changing assumptions.

### 5.5 Build and security checks

- CI: SDK/CMS/demo types and tests, recovery and CMS scripts, CMS build, client-bundle secret scan, Git-history secret scan.
- `pnpm --filter @areca/cms scan:client` inspects existing build output (build first). See `.github/workflows/ci.yml` and `.gitleaks.toml`.

### 5.6 Database changes

- Schema source: `apps/cms/src/db/schema.ts`; migrations: `apps/cms/drizzle`.
- `pnpm db:generate` produces migration; `pnpm db:migrate` applies in development. Review generated SQL.
- "Avoid `db:push` as a production upgrade workflow because it bypasses the reviewed migration sequence."
- `db:reset` erases application data and configured upload bucket; deliberate local reset tool.
- Production migrations: see `UPGRADES.md`.

### 5.7 Documentation maintenance

"Update the guide for the affected audience and link it from the documentation index. Keep code examples small but usable; identify required variables and prerequisites. Describe current behavior separately from planned work. Keep historical proposal documents labeled as such."
Screenshots: store under `docs/screenshots`, record context in `screenshots/README.md`, avoid revealing tokens or recovery codes; capturing must not require publishing/deleting/resetting data.

### 5.8 Root scripts referenced

`pnpm dev`, `pnpm test`, `pnpm test:e2e`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:reset` (forwarded to CMS package), `pnpm --filter @areca/cms scan:client`, `pnpm --filter @areca/cms test:scripts`. Doc says root scripts forward to the CMS package.

Note: `pnpm db:reset`, `db:generate`, `db:migrate` are documented as root commands in DEVELOPMENT.md but the root `package.json` was not read in this pass — verify.

---

## 6. docs/TROUBLESHOOTING.md

- **Path:** `/Users/ek/development/projects/areca-cms/docs/TROUBLESHOOTING.md` (66 lines)
- **Purpose:** Symptom → check table, grouped by area.
- **Audience:** operator; also developer (SDK/preview sections).

Intro (verbatim): "Start with the failing step: sign-in, writing content, preview, content pull, or deployment. Keep the exact error and the release/job ID when asking an agency admin for help. Do not include passwords, bearer tokens, preview URLs with tokens, recovery codes, or provider keys."

### 6.1 Sign-in and access (verbatim table)

| Problem | Check |
| --- | --- |
| `/setup` redirects to login | The instance already has a user. Sign in with an existing account; do not reset the database to solve a login problem. |
| Setup needs a token | Read the first-run token from the CMS terminal, or use the configured `SETUP_TOKEN`. See [onboarding](ONBOARDING.md). |
| Sign-in says `Invalid origin` | Open the canonical CMS origin and make sure `BETTER_AUTH_URL` and `APP_URL` match the intended origins. Restart after environment changes. |
| Sign-in requests an authenticator code | Enter the current code from the account's authenticator. A saved recovery code can be used through **Use a backup code**. Agency admins require MFA by default. |
| Access is restricted after admin sign-in | Complete two-factor enrollment or the requested verification in Account. Do not disable MFA on a shared instance. |
| Invitation email is missing | Check the address and pending invitation. Locally, open Mailpit at `http://localhost:8025`; check SMTP connectivity for deployed instances. |
| Invitation cannot be accepted | Check expiry, revocation, and whether the signed-in email matches the invited email. Ask an owner to resend it. |
| People, Settings, or publishing actions unavailable | Check your role. Editors author drafts; owners publish and manage client members; only agency admins manage Settings. See [permissions](AUTHZ_MATRIX.md). |

Contradiction check: "Ask an owner to resend it" (troubleshooting) vs INTEGRATIONS.md: "owners or agency administrators can resend". Not a hard contradiction, but "Ask an owner" is narrower than the INTEGRATIONS text. Also "Invitation email is missing ... Check the address" — fine.

### 6.2 Writing and releasing content (verbatim table)

| Problem | Check |
| --- | --- |
| New entry says it is not saved yet | Add a title or valid slug and wait for the save indicator. Slugs must be unique in the collection. |
| A field prevents approval | Fill required fields and fix the indicated value. Optional fields still need valid values when filled. |
| Changes do not appear on the public website | Save the draft, mark the new version ready, then complete a successful Go live. Later draft edits are not automatically approved. |
| Scheduled edits differ from the draft | Scheduling freezes an approved version. Later draft changes do not replace it automatically; review and update the schedule explicitly. |
| Go live reports invalid references | Ensure referenced entries are approved and included in the same snapshot. Disabled or archived target entries cannot provide a public reference. |
| Two entries use the same URL | Collection routes and slugs must produce unique website paths. Fix the route or approved slug and mark affected entries ready again. |
| Media cannot be deleted | Drafts, approved/scheduled versions, revisions, or retained snapshots still reference it. Follow asset retention (`ASSET_RETENTION.md`). |
| Draft seems lost after an interrupted save | Reopen the same entry in the same browser and review any draft-recovery offer. Compare revision history before restoring. |

### 6.3 SDK and preview (verbatim table)

| Problem | Check |
| --- | --- |
| CLI cannot find environment settings | Run from the website project root. The CLI loads that directory's `.env.local` and `.env`; existing process values take precedence. |
| Manifest push fails authentication | It needs `ARECA_SCHEMA_TOKEN`. The read-only `ARECA_SITE_TOKEN` cannot publish schema changes. |
| Content pull fails authentication | Update `ARECA_SITE_TOKEN` after rotation in the site settings. Keep schema and read credentials separate. |
| No publication exists | A ready entry alone is not enough. Request Go live and let the publication workflow finish; then pull again. |
| TypeScript config cannot be imported | Use the Node version recommended in SDK setup, or the CLI's suggested `tsx` import path. |
| Generated content file is missing | Run `areca pull` before reading it and confirm the collection key/output directory. |
| Preview returns 404 or fails to connect | Implement the website preview route and ensure the site's production URL points to that running website. Locally start the demo on port 3001. |
| Preview token is invalid or expired | Reopen Preview from the saved CMS entry to obtain a new link. Check that the route forwards the complete opaque token. |
| Rich text renderer fails | Align the site's TanStack Markdown dependency with the SDK's document format. See SDK rendering. |
| SEO changes are missing | Confirm the website uses SDK SEO helpers, the metadata was marked ready, and a new release was pulled and built. Older snapshots may have no `seo` property. |
| Images point to the wrong host | Check CMS `APP_URL`, then create a new release and pull again. Existing immutable snapshots retain their original URLs. |

**Contradictions/issues in this table:**
- "Preview returns 404 or fails to connect" — the 404 from the preview *API* means "entry not found" (source `preview.ts`), but the table attributes 404 to the website's route. Ambiguous: a 404 from the website route and a 404 from the CMS API mean different things. Doc does not separate them.
- "Preview token is invalid or expired" → fix is to reopen Preview; consistent with 401.
- "Content pull fails authentication" → "Update ARECA_SITE_TOKEN after rotation in the site settings" — consistent with INTEGRATIONS.

### 6.4 Deployment and infrastructure (verbatim table)

Intro (verbatim): "Open the failed release in the Go-live panel and read **View log**. The website's provider/build log may contain additional detail that the CMS does not have."

| Problem | Check |
| --- | --- |
| `Dokploy credentials are not configured` | Configure the client connection and the site's target, or use the site's deliberate Demo workflow. Production publishing needs a target. |
| Content pull works locally but not in Dokploy | `localhost` inside a build container points to that container. Use a reachable CMS URL, configure the site token for build time, and allow network access. |
| Deployment succeeds but health check fails | The website health endpoint must report `ok: true` and the expected publication ID. Check hostname, TLS, route, and whether the deployed build pulled the pinned snapshot. |
| A publication stays queued | Check `WORKER_ENABLED`, worker logs, database connectivity, queue age, and whether an active or uncertain job blocks the same site. |
| Dispatch outcome is uncertain | Check the upstream deployment first. Follow integration recovery; do not repeatedly redeploy or manually delete job rows. |
| CMS readiness returns 503 | Inspect `/api/health/ready` and operations. Database/storage failure, excessive queue age, or stale worker state can fail readiness. |
| Redis unavailable | Shared rate limiting degrades and fails open with a log; restore Redis and check health diagnostics. |
| Saved provider key cannot be decrypted | Restore the original encryption key matching the database, or replace the provider credential. Retain stable keys with backups. |

Note: The "Deployment succeeds but health check fails" row says the health endpoint must report `ok: true` and the expected publication ID — consistent with SDK.md. But the demo's `/api/health` returns `{ok:false, error}` 503 — consistent.

### 6.5 AI SEO assistance (verbatim)

"If **Generate with AI** is missing or unavailable, ask an agency admin to check Agency › AI and the CMS's `AI_SETTINGS_ENCRYPTION_KEY`. Check provider model access and credits if a request fails. A per-user hourly limit also applies. Generated suggestions need review and approval just like manual edits."

Doc ends: "For operational incidents, use operations, recovery, and upgrades. For website integration problems, use SDK and API."

---

## 7. packages/site-sdk/README.md

- **Path:** `/Users/ek/development/projects/areca-cms/packages/site-sdk/README.md` (266 lines)
- **Purpose:** npm-package README: quick start, CLI, reading content, rich text, SEO, preview, client, schema rules, exports.
- **Audience:** developer.
- **Package facts (verified in `packages/site-sdk/package.json`):** name `@areca-cms/site-sdk`, version `0.2.0`, `"type": "module"`, `bin: { areca: dist/cli.js }`, `engines.node >=22.6.0`, `publishConfig.access public`, exports `.`, `./pull`, `./rich-text`, `./seo`, `./package.json`. Deps: `@clack/prompts ^1.8.1`, `@tanstack/markdown 0.0.15`.

### 7.1 Quick start (verbatim commands)

```bash
pnpm add @areca-cms/site-sdk
pnpm exec areca init
```
`.env` example (verbatim):
```dotenv
ARECA_CMS_URL=https://cms.example.com
ARECA_SITE_TOKEN=site-token-from-site-settings
ARECA_SCHEMA_TOKEN=schema-token-from-site-settings
```
Collection example (verbatim, minor differences vs SDK.md: it has `body` not required and no `slug` field):
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
        { key: 'body', label: 'Body', type: 'richtext' },
        { key: 'cover', label: 'Cover', type: 'image' },
      ],
    },
  },
})
```
Publish:
```bash
pnpm exec areca manifest push
pnpm exec areca pull
```

### 7.2 CLI table (verbatim)

| Command | Purpose |
| --- | --- |
| `areca init` | Create frontend config and environment-file scaffolding. |
| `areca pull [--out <directory>]` | Download the current published snapshot; default output is `src/generated/content`. |
| `areca manifest push [config]` | Send the local config to the CMS. Default config is `./areca.config.ts`. Requires `ARECA_SCHEMA_TOKEN`. |
| `areca manifest pull [--config <path>] [--yes]` | Replace the local config with enabled CMS collections. |
| `areca sync-manifest [config]` | Deprecated alias for `areca manifest push`. |
| `areca run -- <command>` | Run a child command with SDK-loaded environment files. |

Flags (verbatim): "`areca init` accepts `--cms-url`, `--token`, `--site-key`, `--out`, `--config`, `--yes`/`-y`, and `--force`. Use flags with `--yes` in automation. `--force` allows init to overwrite its config and `.env.example` outputs."

`manifest pull` (verbatim): "replaces the entire config file, including comments and helper code. It prints a collection diff and prompts before overwriting a config that already defines collections. `--yes` skips the prompt; in non-interactive use, it is required when collections already exist. The local `siteKey` is kept. If there is no config, set `ARECA_SITE_KEY` or run `areca init` first."

`pull` (verbatim): "`areca pull` exits with an error if the site has no published snapshot. Publish content in the CMS before adding it to a production build. Pulls write: `src/generated/content/` ├── `manifest.json` (publication ID, snapshot hash, time, collection counts) └── `articles.json` (one JSON array per collection key). The generated files should usually be ignored by Git ... Pull rejects unsafe collection names and refuses symbolic-link output files."

Source-verified CLI behavior (from `cli.ts`, `args.ts`):
- `pull` success output: `Pulled publication <id> (<hash>): key=count, ...`.
- `manifest push` success output: `Synced manifest from <configPath>`.
- `manifest pull` success output: `Wrote <path> with N collection(s) (+a ~b -c)`. If user declines: prints `Aborted` and exits 0.
- `init` non-interactive success: `Areca CMS setup complete. Set ARECA_SCHEMA_TOKEN ... → pnpm sync-manifest → publish in CMS → pnpm content:pull → pnpm dev`. Interactive cancel exits 0.
- Errors: printed to stderr, exit 1. Parse errors (unknown command/flag, missing value) print the message and the usage text and exit 1.
- `areca --help`/`-h`/no args prints usage, exits 0.
- `areca run -- <command>`: joins remaining args with spaces and spawns with `shell: true` (so quoting of arguments is lost); exits with the child's code.
- `run` without `--` gives error "Missing command. Usage: areca run -- <command>".

### 7.3 Read snapshot content (verbatim)

```ts
import { readContent } from '@areca-cms/site-sdk/pull'
import type { ImageValue, RichTextValue, SnapshotEntry } from '@areca-cms/site-sdk'

type Article = SnapshotEntry & {
  data: { title: string; body: RichTextValue; cover: ImageValue | null }
}

const articles = readContent<Article>('src/generated/content', 'articles')
const article = articles.find((item) => item.slug === 'hello-world')
```
Client pull (verbatim):
```ts
import { createArecaClient } from '@areca-cms/site-sdk'
import { pullContent } from '@areca-cms/site-sdk/pull'

const client = createArecaClient()
const snapshot = await pullContent({ outDir: 'src/generated/content', client })
console.log(snapshot.publicationId)
```
`readContent<T>(directory, collectionKey)`: "returns it as `T[]`. If the content has not been pulled, it explains that you need to run `areca pull` first."

### 7.4 Rich text (verbatim)

Component example same as SDK.md. Additional: "`richTextMarkdown(value)` returns the Markdown source. `richTextHtml(value)` returns the CMS-rendered static HTML string; only render trusted CMS content as HTML. For custom rendering, pass a `components` map to `Markdown`. The SDK uses `@tanstack/markdown` 0.0.15; keep the renderer version aligned because its AST format is pre-1.0."

### 7.5 SEO (verbatim)

`seoHead` example (verbatim):
```tsx
import { seoHead } from '@areca-cms/site-sdk'
import type { SnapshotEntry } from '@areca-cms/site-sdk'

export function articleHead(entry: SnapshotEntry) {
  return seoHead(entry.seo, { titleTemplate: '%s · Acme' })
}
```
"The CMS title has no site suffix. `titleTemplate` can be a string containing `%s` or a function; `siteName` overrides `og:site_name`. Missing values are omitted. Render `seo.summary`, `seo.keyTakeaways`, and FAQ answers in the page when using related structured data so the metadata matches visible content."

Astro (verbatim):
```astro
---
import { seoHeadHtml } from '@areca-cms/site-sdk/seo'
const { entry } = Astro.props
---
<head set:html={seoHeadHtml(entry.seo, { titleTemplate: '%s · Acme' })} />
```
"`seoJsonLd(seo)` returns JSON strings safe to place inside a JSON-LD script."

**Doc link issue:** README links `../../docs/SEO.md`, `../../docs/CMS_GUIDE.md`, `../../docs/ADMIN_GUIDE.md`. All three exist. But npm consumers will not have repo-relative links resolve — the README is published in the npm package (`files: ["dist"]` means README is still included by npm automatically, and relative links break on npm). Same applies to `../../docs/SDK.md` in the first paragraph. Worth flagging for the docs site.

### 7.6 Draft preview (verbatim)

```ts
import { getPreviewEntry, previewHeaders } from '@areca-cms/site-sdk'

const preview = await getPreviewEntry({ token })
const headers = previewHeaders()
// Apply headers to the server response.
// Render preview.entry using the same view as a published entry.
```
"`previewHeaders()` returns `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`. ... Show a clear error for expired/invalid tokens (401) and missing preview entries (404)."

### 7.7 Programmatic client and errors (verbatim)

```ts
import { createArecaClient } from '@areca-cms/site-sdk'

const client = createArecaClient()
const manifest = await client.fetchManifest()
const snapshot = await client.fetchSnapshot()
await client.syncManifest(config)
const preview = await client.fetchPreview(previewToken)
```
"`createArecaClient({ cmsUrl?, siteToken?, schemaToken? })` uses the matching environment variables when options are omitted." Errors: "throws readable errors when required settings are missing, the CMS cannot be reached, or an HTTP request fails. A missing publication gives a specific publish-first error."

**Snippet bug:** `await client.syncManifest(config)` uses an undefined `config` variable in the snippet; API.md defines it. Minor.

### 7.8 Schema rules (verbatim)

"Collection and field keys start with an ASCII letter and contain at most 64 ASCII letters, digits, `_`, or `-`. Reserved names include `manifest`, `constructor`, `prototype`, `__proto__`, and Windows device names. Field types are `text`, `textarea`, `richtext`, `image`, `date`, `datetime`, `select`, `reference`, `slug`, `boolean`, `number`, and `url`. `select` uses `options`, `reference` uses `collection`, and date ordering can use `after` to refer to another date/datetime field."

Source confirmed (`identifiers.ts`): regex `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`, case-insensitive reserved check includes `__proto__`, `prototype`, `constructor`, `manifest`, `con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`. Also enforced by `manifestFromConfig` for collection keys, field keys, `field.collection`, `field.after`. Duplicate field keys within a collection throw `Duplicate field identifier`.

Note: `Field.collection` is validated as an identifier in `manifestFromConfig` — but **the CMS-side `reference` targets are not confirmed here**.

### 7.9 Public exports (verbatim)

- `@areca-cms/site-sdk`: client, schema helpers and types, preview, SEO, and rich-text helpers.
- `@areca-cms/site-sdk/pull`: `pullContent()` and `readContent()`.
- `@areca-cms/site-sdk/seo`: SEO helpers and types.
- `@areca-cms/site-sdk/rich-text`: rich-text helpers.

Source check: `./seo` and `./rich-text` subpaths exist in package.json exports. Good.

### 7.10 Stale / inconsistent items in the SDK README vs source

- `CLI` table omits `--out` on `init`? (It lists it in text) — no real issue.
- README says `areca init ... creates ... an empty generated-content directory`. Confirmed (`writeEmptyGeneratedContent`).
- The README's `.env` section claims `.env.local` then `.env` load; confirmed in `env.ts` (`loadLocalEnv(cwd)` — file not read here; trust README).

---

## 8. examples/demo-site/README.md

- **Path:** `/Users/ek/development/projects/areca-cms/examples/demo-site/README.md` (136 lines)
- **Purpose:** How to run and deploy the reference TanStack Start website (`@areca/demo-site`, private).
- **Audience:** developer; contributor.

### 8.1 Run with the CMS (verbatim)

```bash
cp .env.example .env.local
```
```dotenv
ARECA_CMS_URL=http://localhost:3000
ARECA_SITE_TOKEN=paste-site-token-here
```
```bash
pnpm dev
```
- Port `3001`; dev script reads `.env.local`. First CMS-backed run requires published snapshot:
```bash
pnpm --filter @areca/demo-site content:pull
```
Fails with publish-first message if no publication.

### 8.2 Connect/update schema (verbatim)

- Schema in `areca.config.ts`: `articles` with title, slug, excerpt, rich-text body, hero image, publication date, category.
- Set `ARECA_SCHEMA_TOKEN` in `.env.local`, then:
```bash
pnpm --filter @areca/demo-site sync-manifest
```
- Schema token: "Keep it local to this authoring environment. Routine content pulls and builds use the read-only site token."

### 8.3 How the site reads content (verbatim essence)

- `src/lib/content.ts` reads `src/generated/content/articles.json` via `readContent()`, types records, sorts newest first.
- `src/lib/queries.ts` TanStack server functions expose content to route loaders.
- `/blog` lists; `/blog/$slug` renders one article.
- Vite prerenders home, blog listing, every current article slug; excludes `/__preview` and `/api`.
- `/api/health` reports snapshot publication ID; 503 when generated manifest missing.

Source check: `examples/demo-site/src/routes/api/health.ts` returns `{ok:true, publicationId}` or 503 with `{ok:false, error}`; the error text includes the underlying exception (e.g. missing manifest message). SDK.md's health example returns `{ok:false}` only — the two differ in body (intentional? not stated).

### 8.4 Preview drafts (verbatim essence)

- CMS opens `/__preview/<collection>/<slug>?token=<opaque-preview-token>`.
- Route validates query token, fetches via `getPreviewEntry()`, renders article view. Headers: `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`; document has `noindex, nofollow` robots meta. Invalid/expired/missing: error message. "The preview URL token is temporary: do not log or store it."

Source: demo route at `examples/demo-site/src/routes/[__preview]/$collection/...` — exists (directory `[__preview]/$collection`).

### 8.5 Local fixture mode (verbatim)

```bash
pnpm --filter @areca/demo-site content:fixture
pnpm --filter @areca/demo-site dev
```
"When `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` are set, the `prebuild` script always pulls from the CMS and fails if that pull fails; it does not silently use fixtures. Without those credentials, build can reuse generated content if present. If it is absent, build explains how to pull or generate fixture content."

Note: the README says fixture mode lets you "run without a CMS", but the `dev` script (`vite dev`) doesn't run `prebuild`; so the fixture step is needed for dev and the README is correct. Fine.

### 8.6 Build and run (verbatim)

```bash
pnpm --filter @areca/demo-site build
pnpm --filter @areca/demo-site start
```
"The build runs `prebuild`, which pulls a fresh snapshot when both CMS settings are present. The production server runs on port `3000` by default."

Table (verbatim):

| Command | Purpose |
| --- | --- |
| `pnpm --filter @areca/demo-site typecheck` | Check TypeScript. |
| `pnpm --filter @areca/demo-site test` | Run demo-site unit tests. |
| `pnpm --filter @areca/demo-site verify:prerender` | Confirm generated article HTML exists. |
| `pnpm --filter @areca/demo-site content:pull` | Pull published CMS content. |
| `pnpm --filter @areca/demo-site content:fixture` | Write local fixture content. |

Source check (`examples/demo-site/package.json`): scripts `prebuild`, `content:pull`, `content:fixture`, `sync-manifest`, `dev` (port 3001), `build`, `start` (`node .output/server/index.mjs`), `generate-routes`, `typecheck`, `test`, `verify:prerender`. All documented ones exist.

### 8.7 Docker (verbatim)

```bash
DOCKER_BUILDKIT=1 docker build \
  -f examples/demo-site/Dockerfile \
  --build-arg ARECA_CMS_URL=https://cms.example.com \
  --secret id=ARECA_SITE_TOKEN,env=ARECA_SITE_TOKEN \
  .
```
"Set `ARECA_SITE_TOKEN` in the shell or CI secret store before running the command. The Dockerfile mounts it only during the content-pull/build step. A successful Docker build needs a live published snapshot. `ARECA_SCHEMA_TOKEN` is not needed to build the website. The container copies the generated snapshot and server output into a Node 24 runtime image. At runtime, the site serves the built snapshot; it does not fetch content from the CMS for visitor requests."

Source: `examples/demo-site/Dockerfile` has `ARG ARECA_SNAPSHOT_ID=` / `ENV ARECA_SNAPSHOT_ID=$ARECA_SNAPSHOT_ID` (line 15-16). Dockerfile not read in full here.

**Inconsistency:** The README says "ARECA_CMS_URL as build argument" but the snippet's `--build-arg ARECA_CMS_URL=...`; SDK.md says "keep the site token mounted as a BuildKit secret" — consistent.

### 8.8 Learn more (verbatim)
- `../../packages/site-sdk/README.md`, `../../docs/CONTENT_SCHEMA.md`, `../../docs/API.md`.

### 8.9 Demo `areca.config.ts` note

The README says the schema is "articles with title, slug, excerpt, rich-text body, hero image, publication date, category". Not verified against `areca.config.ts`; the file exists. Explorers should confirm.

---

## 9. Contradictions, staleness, and incompleteness (cross-file)

Ranked by likely user harm.

1. **Preview requires `ARECA_SITE_TOKEN` in the rendering server, despite the server not validating it.** Source: `createArecaClient` throws without `ARECA_SITE_TOKEN`; `apps/cms/src/routes/api/sites/preview.ts` authorizes only the signed token. Docs (SDK.md 1.12, API.md 2.5, site-sdk README 7.6) say the preview token is "separate from the site and schema tokens" and never say the preview route still needs site token configured. Expect support questions.

2. **`ARECA_SNAPSHOT_ID` mechanism is described two ways.** INTEGRATIONS.md §3.2 says the adapter "sets `ARECA_SNAPSHOT_ID` to the publication ID before deploying". SDK.md §1.8 and API.md §2.3 say it is a Docker build argument. Source (`dokploy.ts:202-220`) passes it as a build arg. Docs must say "build argument" and explain it is cache-busting only, not read by the SDK. The demo Dockerfile sets `ARG`/`ENV`, which can mislead readers into thinking the SDK reads it.

3. **Root vs docker Compose.** DEVELOPMENT.md says infrastructure comes from root `docker-compose.yml`; CONFIGURATION.md says `docker/compose.yml` (for Docker). Both exist. Needs a single answer.

4. **`areca sync-manifest` vs `areca manifest push`.** Consistent in docs as deprecated alias. But `init` writes a package script `sync-manifest` = `areca manifest push` (no `tsx`), while the demo's `sync-manifest` script uses `--import tsx`. Init's next-steps message also says `pnpm sync-manifest`. Docs do not explain when `tsx` is required in a user project (CLI error message suggests `pnpm exec tsx ./node_modules/@areca-cms/site-sdk/dist/cli.js manifest push ...`).

5. **CLI reference blocks are incomplete.** SDK.md §1.16 CLI block omits `areca sync-manifest` and the `--out`/`--config` flags on `init` (only described in prose). The site-sdk README table omits `--out`/`--config` flags for `init` (mentions in prose). `areca run -- <command>` is listed but its behavior (joins args with spaces, shell: true) is undocumented.

6. **CONFIGURATION.md and env.ts.** Variables in env.ts not in a CONFIGURATION table: `AUTH_EMAIL_PASSWORD_ENABLED` (prose only), `ADMIN_MFA_REQUIRED` (prose only, default true). `LOG_LEVEL` is read outside env.ts (unvalidated). Not contradictory, but a reader scanning tables misses them.

7. **Health endpoint body.** SDK.md example returns `{ "ok": false }` for 503; demo `src/routes/api/health.ts` returns `{ ok: false, error: message }`. Both valid, but docs don't say the `error` field exists; the demo README doesn't show body.

8. **API.md table for POST /api/sites/manifest** lists only `{ "ok": true }` success. Source: 401, 413 `{error}`, 400 `{error:'Invalid body', issues}`. API.md narrative covers 400/413 but not the 401 body shape or the 400 issue shape.

9. **Rate limit scope.** API.md and SDK.md say "300 requests per minute per site token"; API.md also says "(or client IP when no token is supplied and trusted proxy IPs are configured)". Source `SITE_API_RULE` is 300/60s. Preview route rate limiting is not documented.

10. **Preview response headers.** SDK helper `previewHeaders()` sends `X-Robots-Tag: noindex, nofollow`. The CMS preview route itself sends `X-Robots-Tag: noindex` and `Cache-Control: no-store, private` on all responses (401/404 included). Docs describe only the SDK helper values — fine for the site, but API.md §2.4 tells implementers to set `noindex, nofollow` and `no-store`, which does not match the CMS's own header. Not wrong for a website; just different.

11. **Invitation resend permission.** TROUBLESHOOTING: "Ask an owner to resend it." INTEGRATIONS: "owners or agency administrators can resend". Narrower in troubleshooting.

12. **Preview 404 ambiguity.** TROUBLESHOOTING "Preview returns 404 or fails to connect" conflates the website route 404 with the CMS API's 404 "Not found" (entry missing). Different causes.

13. **`fetchPreview` and `getPreviewEntry` options.** Source `getPreviewEntry({ token, client? })` accepts an optional `client`; SDK docs only show `{ token }`. Undocumented but harmless.

14. **`pull` SDK doc claims** "The SDK rejects unsafe collection keys and symbolic-link output files." Source confirmed (`containedPath`, `assertSafeIdentifier`, `O_NOFOLLOW`). Good.

15. **Doc snippet defects.** `packages/site-sdk/README.md` §7.7 uses `config` without declaring it. SDK.md §1.9 `readContent` import path correct. SDK.md §1.11 `createServerFn(...).validator(...)`: API name not checked against the pinned TanStack Start version.

16. **Relative links in package README.** `packages/site-sdk/README.md` links `../../docs/*.md`. These break on npm/registry pages. Docs site must rewrite.

17. **SDK install availability.** Docs say "pnpm add @areca-cms/site-sdk" and "If your registry does not have a published package yet, install from a release..." — there is no stated public registry/version. Package version is 0.2.0 (`package.json`). Open question whether it is published.

18. **Schema-token location.** `init` writes `ARECA_SCHEMA_TOKEN=` (blank) into `.env.example` but the site token into `.env.local`. Docs say to add schema token to `.env.local` manually (SDK.md 1.3). Not contradictory; `.env.example` contents are not described.

19. **Demo prebuild.** SDK.md §1.8 describes demo `prebuild` as "pulls when credentials are set, reuses existing content when absent, allows a local fixture when there is no CMS content." Demo README §8.5 says "fails if pull fails" when credentials set. Consistent. Not verified against `scripts/prebuild.mjs` (not read).

20. **TROUBLESHOOTING row "Content pull works locally but not in Dokploy" says "configure the site token for build time"**; SDK.md says "keep the site token mounted as a BuildKit secret". Consistent.

21. **`areca pull` default output.** SDK.md and site-sdk README both say `src/generated/content`; `init` `--out` default matches. Consistent.

22. **Engine mismatch.** SDK.md says Node 22.6+ required; `engines.node >=22.6.0` consistent. Some CMS docs say Node 24. Not a conflict.

23. **Missing from every doc (SDK side):**
    - Exact JSON shape of `SeoMeta` (only described in source types).
    - `SeoHeadOptions`, `SeoHeadResult`, `HeadLink`, `HeadMeta`, `HeadScript` shapes.
    - `richTextDocument` behavior when `document` missing (older snapshots) — said to parse Markdown; no error modes.
    - `ImageValue` nullable details beyond prose.
    - Snapshot JSON file layout for each collection (array of `SnapshotEntry`).
    - `manifest.json` exact schema (`PulledContentManifest` fields are only in types).
    - Output of CLI success messages.

---

## 10. Proposed docs-site pages (SDK / API / configuration material)

Proposed nav (sections → pages → slugs). Slugs are suggestions.

**Getting started**
- `/docs/getting-started/overview` — What Areca is; CMS vs SDK vs site; credentials model. Sources: SDK.md intro, site-sdk README intro, DEVELOPMENT.md opening, INTEGRATIONS intro.

**Site SDK (developer)**
- `/docs/sdk/install-and-init` — "Install the SDK and initialize a site" (`areca init`, flags, `.env.local`, package scripts, `.gitignore`). Sources: SDK.md §Install, §Initialize; site-sdk README Quick start.
- `/docs/sdk/declare-content-model` — "Declare the content model (`defineSiteContent`)". Sources: SDK.md §Declare; site-sdk README schema rules; `identifiers.ts`.
- `/docs/sdk/schema-sync` — "Push and pull the schema (`manifest push` / `manifest pull`)". Sources: SDK.md §Send the schema.
- `/docs/sdk/pull-content` — "Pull published content and build integration". Sources: SDK.md §Publish and download, §Pull automatically before a build; demo README.
- `/docs/sdk/read-content` — "Read entries in a server loader (`readContent`)". Sources: SDK.md §Read entries; site-sdk README §Read snapshot.
- `/docs/sdk/rich-text` — "Render rich text". Sources: SDK.md §Render rich text; site-sdk README §Rich text.
- `/docs/sdk/seo` — "Page metadata and SEO". Sources: SDK.md §Add page metadata; site-sdk README §SEO metadata; `seo.ts` types.
- `/docs/sdk/preview` — "Draft preview routes". Sources: SDK.md §Add a draft preview route; API.md §Preview; demo README §Preview drafts.
- `/docs/sdk/production-health` — "Production publishing and health checks". Sources: SDK.md §Production publishing and health checks; demo README /api/health.
- `/docs/sdk/client` — "Programmatic client". Sources: SDK.md §Use the client directly; site-sdk README §Programmatic client; API.md §SDK client.
- `/docs/sdk/cli-reference` — "CLI reference" (`areca init|pull|manifest push|manifest pull|sync-manifest|run`). Sources: SDK.md §CLI reference; site-sdk README §CLI; `args.ts` (authoritative).
- `/docs/sdk/schema-rules` — "Content schema rules and field types" (may merge with CONTENT_SCHEMA.md). Sources: site-sdk README §Schema rules; `types.ts`; `identifiers.ts`; docs/CONTENT_SCHEMA.md (not read in this pass).
- `/docs/sdk/errors-troubleshooting` — "SDK errors" (common errors table). Sources: SDK.md §Common errors; API.md §Errors and retries.
- `/docs/sdk/example-demo-site` — "Reference site: the demo website". Sources: examples/demo-site/README.md (run, fixture, build, Docker).

**API reference (developer)**
- `/docs/api/overview` — Base URL, credentials, token table. Sources: API.md §Base URL and credentials.
- `/docs/api/endpoints` — Four endpoints table and per-endpoint details (see §2). Sources: API.md §Endpoints; source route files.
- `/docs/api/snapshot-pinning` — Snapshot pinning and `ARECA_SNAPSHOT_ID` (build arg). Sources: API.md §Endpoints; SDK.md §Pull before build; INTEGRATIONS §Deployment (needs correction).
- `/docs/api/errors-rate-limits` — Errors, retries, rate limits, manifest limits. Sources: API.md §Errors and retries.
- `/docs/api/types` — TypeScript types reference (`Snapshot`, `SnapshotEntry`, `RichTextValue`, `ImageValue`, `ReferenceValue`, `SeoMeta`, `PreviewResult`, `PulledContentManifest`). Sources: API.md §Types; `types.ts`.

**Operator guides**
- `/docs/operate/configuration` — Full env reference (required/optional/URL/auth/deploy/ops). Sources: CONFIGURATION.md (all tables); env.ts.
- `/docs/operate/authentication-and-sso` — Providers, callback URLs, invite-only, MFA. Sources: CONFIGURATION.md §Authentication; TROUBLESHOOTING §Sign-in.
- `/docs/operate/integrations-and-recovery` — Publication identity, Dokploy delivery, uncertain dispatch recovery, invitation recovery, rotation. Sources: INTEGRATIONS.md (all sections). Consider separate pages: `/docs/operate/dokploy-delivery`, `/docs/operate/credential-rotation`, `/docs/operate/invitation-recovery`.
- `/docs/operate/troubleshooting` — Symptom tables (sign-in, content, SDK/preview, deployment, AI SEO). Sources: TROUBLESHOOTING.md. Consider splitting per area: `/docs/troubleshooting/sdk-and-preview`, `/docs/troubleshooting/deployment`.

**Contributing**
- `/docs/contribute/development` — Local workflow, checks by package, tests, DB changes. Sources: DEVELOPMENT.md.
- `/docs/contribute/integration-verification` — Test suites list. Sources: INTEGRATIONS.md §Verification (may merge with development page).

---

## 11. Open questions / gaps

Items a developer would need that the docs do not explain. Each is a target for code explorers.

**SDK / site integration**
1. Is `@areca-cms/site-sdk` published to npm? Which registry, which version is current (package says 0.2.0)? Docs say "install from a release or registry configured by your project maintainer" with no version guidance.
2. Does `getPreviewEntry()` / `fetchPreview()` need `ARECA_SITE_TOKEN` on the preview server? Code requires it to construct the client, but the endpoint ignores it. Confirm and document.
3. Exact `SeoMeta`, `SeoHeadOptions`, `SeoHeadResult`, `HeadLink`, `HeadMeta`, `HeadScript` shapes and how `seoHead` maps each field. Only types exist; no doc lists fields or the output array shape.
4. What `richTextDocument()` does when `document` is absent and Markdown parsing fails; what `components` keys are valid for `Markdown`.
5. `RichTextValue.json` format: what schema it has, whether any consumer should use it.
6. `manifest.json` in `src/generated/content` — exact fields and the `publicationId: ""` placeholder written by `init` (empty strings before first pull). Does `getManifest()` in the demo accept that?
7. Snapshot JSON file format per collection: are entries sorted? Is `publishedAt` nullable only for drafts? Can a published snapshot contain `null` `slug`?
8. `reference` field value: how a site resolves `ReferenceValue` to a target entry (is there a helper, or must the site join by `collection`/`slug`/`id`?). No helper exists in the SDK exports listed.
9. `Field.description`, `Field.options` for `select`, `after` semantics for date/datetime — only type comments; user-visible rules are in CONTENT_SCHEMA.md (not read in this pass).
10. `areca run -- <command>`: quoting is lost (joined with spaces, `shell: true`). Should we document the limitation or fix? Also: does `run` load `.env.local` before spawning? (`cli.ts` calls `loadLocalEnv(cwd)` at start — appears yes.)
11. `areca init` `--out` and `--config` are accepted; SDK.md and site-sdk README describe them only in prose. Confirm defaults and whether `--config` changes the path written to package scripts (script currently hardcodes `areca manifest push` without a path).
12. `areca init` writes `sync-manifest` = `areca manifest push` with no `tsx`. When is `tsx` required in a user project? The docs say Node 24 native import, but the demo's script uses `--import tsx`. Clarify.
13. Exit codes: CLI returns 1 on errors; `manifest pull` abort returns 0. Document in CLI reference.
14. CLI output strings on success (`Pulled publication ...`, `Synced manifest from ...`, `Wrote ... (+a ~b -c)`) are not shown anywhere.
15. Snapshot endpoint 404 vs. "pending" builds: what does a site see during an active build versus after live publish? (API.md §Snapshot pinning is prose only.)
16. `ARECA_SNAPSHOT_ID` at runtime: is it only cache-busting, or does anything else read it? Confirm the demo Dockerfile's `ENV ARECA_SNAPSHOT_ID=$ARECA_SNAPSHOT_ID` is needed.
17. Preview route rate-limit coverage and what 429 looks like there (only manifest/snapshot are documented).
18. Preview `Retry-After` on 429 is documented but not verified for the site routes beyond `rate-limit.ts:69`.
19. Demo mode vs Production mode for `/api/sites/snapshot/current`: "current demo publication" — how does a site distinguish? (Is there a flag in the response?)
20. `pullContent` on a snapshot with zero collections writes only `manifest.json`. Confirm.
21. Field key rules: `SITE_KEY_PATTERN` for site keys (lowercase slug) vs collection key rules (ASCII letter start) — two different identifier rules; docs only mention the collection/field rule. Confirm that `siteKey` format is documented in SDK.md (it is not).

**CMS configuration**
22. Full list of env vars that changed between `apps/cms/.env.example` and `CONFIGURATION.md` — `.env.example` is modified in the working tree; confirm the example matches the tables.
23. `ADMIN_MFA_REQUIRED` and `AUTH_EMAIL_PASSWORD_ENABLED` need table rows.
24. `LOG_LEVEL` is not in `env.ts`; document as read directly, and what happens on invalid values.
25. `S3_FORCE_PATH_STYLE` is a string in env.ts; confirm accepted values (`true`/`false`) and that anything else is treated as false.
26. `SETUP_TOKEN` "generated and logged while setup is needed": where exactly is it logged (stdout of CMS process)? Docs say "CMS terminal".
27. `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` and `AI_SETTINGS_ENCRYPTION_KEY` validation: both require exactly 43 base64 chars + `=`. Doc says "32-byte base64" — add the exact format check and the `openssl rand -base64 32` note already present.
28. `docker/.env` vs `apps/cms/.env.local` vs root `docker-compose.yml`: which applies to which setup. (DEVELOPMENT.md and CONFIGURATION.md disagree on the compose file.)
29. `BETTER_AUTH_SECRET`: doc recommends `openssl rand -hex 32`; env.ts only requires `min(1)`. Document minimum length as a recommendation, or state the actual validation.
30. `REDIS_URL` is in env.ts with `.url()`; doc calls it optional with a default, fine. Confirm behavior when unreachable (fail-open for rate limits per doc).
31. Worker/queue semantics: `WORKER_DRAIN_TIMEOUT_MS` "keep below container stop grace period" — what is the default Docker/Dokploy grace period? Not documented.
32. `DOKPLOY_ALLOW_INSECURE_HTTP` and `ALLOW_PRIVATE_HEALTH_CHECKS` are documented as env vars but are not in `env.ts` as typed server schema entries? Actually they are present (`z.enum(['true','false']).optional()`). Confirm the code reads them from env.ts (they are).

**Deployment / integrations**
33. How to configure Dokploy from the CMS UI (Organization settings → Dokploy); the docs point to deployment guide but DEPLOYMENT.md was not read in this pass.
34. What the **health URL** must be for a production site, and whether it must be HTTPS (`ALLOW_PRIVATE_HEALTH_CHECKS` implies private hosts are blocked by default).
35. Exact list of Dokploy API operations the adapter performs (for ops debugging).
36. Retry/backoff numbers: "short exponential backoff" — no values documented.
37. Rate-limit storage without Redis: is it in-memory per process? (Doc says fails open; not stated what happens without Redis configured at all.)

**Troubleshooting**
38. The troubleshooting table has no entries for SDK errors like `Unsafe collection or field identifier`, `Duplicate field identifier`, `Output path escapes content directory`, `Content output must not be a symbolic link`, `Config module ... has no default export`, `No siteKey found` (manifest pull), or `Failed to reach CMS at ...`. These are all thrown by source and would be searched by users.
39. Preview: no entry for `Missing ARECA_SITE_TOKEN` in the preview server context.
40. Manifest push: no entry for `Invalid body` / `Manifest is larger than ... bytes` text shapes (only status codes are mentioned).
41. `pnpm dev` at repo root vs `pnpm --filter @areca/demo-site dev`: the demo's `dev` runs `vite dev --port 3001`; the root `pnpm dev` may start CMS only. Confirm.
42. Demo `prebuild` script behavior: the exact conditions (`scripts/prebuild.mjs`) not read in this pass.
43. `pnpm verify:prerender` (demo) — what it checks and where output goes.

**Other repo facts**
44. `docs/CONTENT_SCHEMA.md`, `docs/SEO.md`, `docs/CMS_GUIDE.md`, `docs/ADMIN_GUIDE.md`, `docs/ASSET_RETENTION.md`, `docs/ONBOARDING.md`, `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`, `docs/UPGRADES.md`, `docs/RECOVERY.md`, `docs/AUTHZ_MATRIX.md`, `docs/ARCHITECTURE.md`, `docs/README.md` were referenced but not read in this pass (they exist). They must be read before finalizing those pages.
45. Root `package.json` scripts (`db:generate`, `db:migrate`, `db:reset`, `test:e2e`, etc.) were documented as forwarding to the CMS package; not verified.
46. Node/pnpm versions: docs say Node 24 and pnpm 12 "pinned in ci.yml and apps/cms/Dockerfile"; not verified in those files in this pass (`packageManager` in root `package.json` was not found by grep).

---

## 12. Notes on the MCP auth notice

The session reported that several design-plugin MCP servers (asana, atlassian, figma, intercom, linear, notion, slack) require OAuth authorization before their tools can be used. They were not needed for this research and were not used. To enable them, authorize via the claude.ai connector settings (for claude.ai connectors) or `/mcp` / `claude mcp` in an interactive session. No codes or tokens were requested.
