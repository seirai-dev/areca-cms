# @areca-cms/site-sdk

Tiny library a TanStack Start (or any Node) site uses to declare its content schema, pull a published CMS snapshot at build time, and render draft previews. No React imports — use it from loaders, prerender, or scripts.

The CMS site must already exist. This package wires an **existing** frontend to that site. It does not scaffold routes or create a CMS site.

Requires `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` (sent as `Authorization: Bearer <token>`). The CLI loads `.env.local` then `.env` from the current directory without overriding existing `process.env` keys.

## 1. Init

Install it from npm in the frontend project:

```bash
pnpm add @areca-cms/site-sdk
pnpm exec areca init
```

The package is ESM-only and requires Node.js 22.6 or newer. Node 24 LTS is
recommended because `areca manifest push` imports the TypeScript
`areca.config.ts` file directly.

Non-interactive / CI:

```bash
pnpm exec areca init --cms-url http://localhost:3000 --token <token> --site-key acme-site --yes
```

Init writes frontend wiring only:

- `areca.config.ts` — empty `collections: {}` (fill this in next)
- `.env.example` and gitignored `.env.local` (`ARECA_CMS_URL`, `ARECA_SITE_TOKEN`)
- `.gitignore` entries for `.env.local` and generated content
- `package.json` scripts: `sync-manifest` (runs `areca manifest push`), `content:pull` (wraps `dev` with `areca run --` if a `dev` script already exists)
- empty `src/generated/content/manifest.json` so the site can boot before the first CMS publish

Then:

1. Add collections to `areca.config.ts`
2. `pnpm sync-manifest`
3. Publish in the CMS
4. `pnpm content:pull`
5. `pnpm dev`

Flags: `--cms-url`, `--token`, `--site-key`, `--out` (default `src/generated/content`), `--config` (default `areca.config.ts`), `--yes` / `-y`, `--force` (overwrite `areca.config.ts` / `.env.example`).

## 2. Declare collections

`areca.config.ts`:

```ts
import { defineSiteContent } from "@areca-cms/site-sdk";

export default defineSiteContent({
  siteKey: "demo",
  collections: {
    articles: {
      route: "/blog/$slug",
      label: "Articles",
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "body", label: "Body", type: "richtext" },
        { key: "cover", label: "Cover", type: "image" },
      ],
    },
  },
});
```

Push the schema to the CMS (Node 24 can import `.ts` natively):

```bash
pnpm sync-manifest
# or: areca manifest push ./areca.config.ts
```

### Schema sync both ways

```bash
areca manifest push [./areca.config.ts]                  # site → CMS
areca manifest pull [--config ./areca.config.ts] [--yes] # CMS → site
```

`areca sync-manifest` is the old alias for `areca manifest push` and still
works.

`manifest pull` fetches the enabled collections from the CMS and **regenerates
the whole config file** — hand-written comments, helpers, and any formatting in
`areca.config.ts` are lost. The `siteKey` is preserved from the existing file
(or `ARECA_SITE_KEY` if there is no file yet; otherwise run `areca init` first).

When the existing config already declares collections, the command prints an
added / changed / removed summary and asks for confirmation. Pass `--yes` /
`-y` to skip the prompt — required in CI, where the command errors out instead
of prompting.

## 3. Pull content

```json
{
  "scripts": {
    "content:pull": "areca pull --out src/generated/content"
  }
}
```

`areca pull` writes:

- `src/generated/content/manifest.json` — `publicationId`, `hash`, `createdAt`, collection keys + counts
- `src/generated/content/<collectionKey>.json` — array of snapshot entries

The command exits `1` if no publication exists. Do not add a `prebuild` pull until the CMS has published at least once.

## 4. Read content in a loader / prerender

```ts
import { readContent } from "@areca-cms/site-sdk/pull";
import { richTextDocument } from "@areca-cms/site-sdk";
import type {
  ImageValue,
  RichTextValue,
  SnapshotEntry,
} from "@areca-cms/site-sdk";

type ArticleData = {
  title: string;
  body: RichTextValue;
  cover: ImageValue | null;
};

const articles = readContent<SnapshotEntry & { data: ArticleData }>(
  "src/generated/content",
  "articles",
);

export function articleDocument(article: (typeof articles)[number]) {
  return richTextDocument(article.data.body);
}
```

### Rendering rich text

Rich text fields arrive as `{ json, markdown, document, html }`. `document` is a
[TanStack Markdown](https://tanstack.com/markdown) AST parsed by the CMS from
`markdown`; render it with `@tanstack/markdown/react` and your own component
map so the site decides how every element looks:

```tsx
import { Markdown } from "@tanstack/markdown/react";
import type { MarkdownComponents } from "@tanstack/markdown/react";
import { richTextDocument } from "@areca-cms/site-sdk";

const components = {
  h2: (props) => <h2 {...props} className="mt-10 text-2xl font-semibold" />,
  a: (props) => <a {...props} rel="noopener noreferrer" target="_blank" />,
  img: (props) => <img {...props} loading="lazy" className="rounded-xl" />,
} satisfies MarkdownComponents;

export function ArticleBody({ body }: { body: RichTextValue }) {
  return <Markdown components={components}>{richTextDocument(body)}</Markdown>;
}
```

Pin `@tanstack/markdown` to the version the CMS uses: the AST is public but
pre-1.0. `richTextMarkdown()` returns the source if you want to re-parse with
your own options or extensions, and `richTextHtml()` is a static fallback for
non-React sites (`renderHtml(richTextDocument(body))` produces the same
markup).

## 5. Preview route

CMS preview URLs hit `/__preview/$collection/$slug?token=`. The site fetches draft data live and must not be indexed:

```ts
import { createFileRoute } from '@tanstack/react-router'
import { Markdown } from '@tanstack/markdown/react'
import { getPreviewEntry, previewHeaders, richTextDocument } from '@areca-cms/site-sdk'

export const Route = createFileRoute('/__preview/$collection/$slug')({
  loader: async ({ location }) => {
    const token = new URL(location.href, 'https://site.local').searchParams.get('token')
    if (!token) throw new Error('Missing preview token')
    return getPreviewEntry({ token })
  },
  headers: () => previewHeaders(),
  component: PreviewPage,
})

function PreviewPage() {
  const { entry } = Route.useLoaderData()
  return (
    <article>
      <Markdown components={components}>{richTextDocument(entry.data.body as never)}</Markdown>
    </article>
  )
}
```

`previewHeaders()` returns `{ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' }`.

## Programmatic API

```ts
import { createArecaClient } from "@areca-cms/site-sdk";
import { pullContent } from "@areca-cms/site-sdk/pull";

const client = createArecaClient(); // or { cmsUrl, siteToken }
await client.syncManifest(config);
const manifest = await client.fetchManifest();
const snapshot = await client.fetchSnapshot();
await pullContent({ outDir: "src/generated/content", client });
```

### Token privileges and upgrade

`ARECA_SITE_TOKEN` is read-only (snapshot, preview, manifest GET). Manifest POST now requires a separate `ARECA_SCHEMA_TOKEN`, or `createArecaClient({ schemaToken })`. Existing site tokens immediately lose schema-write permission after migration. An agency administrator can rotate/reveal the schema token in Site settings → Developer. Set it only in the local schema-authoring environment; keep it out of Docker build secrets and deployment environments. `areca init` creates a blank schema-token entry in `.env.example`; configure it before `areca manifest push`. Build integrations including the demo site continue using only `ARECA_SITE_TOKEN`.

Collection and field keys must begin with an ASCII letter and contain at most 64 ASCII letters, digits, `_` or `-`. Prototype, Windows device and `manifest` names are reserved (case insensitive). Invalid existing keys must be renamed by an administrator before syncing or pulling. Pull independently rejects unsafe names and symlink destinations before writing collection JSON.
