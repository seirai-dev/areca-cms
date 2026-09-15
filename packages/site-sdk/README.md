# @areca/site-sdk

Tiny library a TanStack Start site uses to declare its content schema, pull a published CMS snapshot at build time, and render draft previews. No React imports — use it from loaders, prerender, or a `prebuild` script.

Requires `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` (sent as `Authorization: Bearer <token>`).

## 1. Declare collections

`areca.config.ts`:

```ts
import { defineSiteContent } from '@areca/site-sdk'

export default defineSiteContent({
  siteKey: 'demo',
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

Push the schema to the CMS (TypeScript configs need `tsx`):

```bash
pnpm exec tsx ./node_modules/@areca/site-sdk/dist/cli.js sync-manifest ./areca.config.ts
```

A compiled `.js` config can use `areca sync-manifest ./areca.config.js`.

## 2. Pull content at build time

```json
{
  "scripts": {
    "prebuild": "areca pull",
    "prebuild:custom": "areca pull --out src/generated/content"
  }
}
```

`areca pull` writes:

- `src/generated/content/manifest.json` — `publicationId`, `hash`, `createdAt`, collection keys + counts
- `src/generated/content/<collectionKey>.json` — array of snapshot entries

The command exits `1` if no publication exists.

## 3. Read content in a loader / prerender

```ts
import { readContent } from '@areca/site-sdk/pull'
import { richTextDocument } from '@areca/site-sdk'
import type { ImageValue, RichTextValue, SnapshotEntry } from '@areca/site-sdk'

type ArticleData = {
  title: string
  body: RichTextValue
  cover: ImageValue | null
}

const articles = readContent<SnapshotEntry & { data: ArticleData }>(
  'src/generated/content',
  'articles',
)

export function articleDocument(article: (typeof articles)[number]) {
  return richTextDocument(article.data.body)
}
```

### Rendering rich text

Rich text fields arrive as `{ json, markdown, document, html }`. `document` is a
[TanStack Markdown](https://tanstack.com/markdown) AST parsed by the CMS from
`markdown`; render it with `@tanstack/markdown/react` and your own component
map so the site decides how every element looks:

```tsx
import { Markdown } from '@tanstack/markdown/react'
import type { MarkdownComponents } from '@tanstack/markdown/react'
import { richTextDocument } from '@areca/site-sdk'

const components = {
  h2: (props) => <h2 {...props} className="mt-10 text-2xl font-semibold" />,
  a: (props) => <a {...props} rel="noopener noreferrer" target="_blank" />,
  img: (props) => <img {...props} loading="lazy" className="rounded-xl" />,
} satisfies MarkdownComponents

export function ArticleBody({ body }: { body: RichTextValue }) {
  return <Markdown components={components}>{richTextDocument(body)}</Markdown>
}
```

Pin `@tanstack/markdown` to the version the CMS uses: the AST is public but
pre-1.0. `richTextMarkdown()` returns the source if you want to re-parse with
your own options or extensions, and `richTextHtml()` is a static fallback for
non-React sites (`renderHtml(richTextDocument(body))` produces the same
markup).

## 4. Preview route

CMS preview URLs hit `/__preview/$collection/$slug?token=`. The site fetches draft data live and must not be indexed:

```ts
import { createFileRoute } from '@tanstack/react-router'
import { Markdown } from '@tanstack/markdown/react'
import { getPreviewEntry, previewHeaders, richTextDocument } from '@areca/site-sdk'

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
import { createArecaClient } from '@areca/site-sdk'
import { pullContent } from '@areca/site-sdk/pull'

const client = createArecaClient() // or { cmsUrl, siteToken }
await client.syncManifest(config)
const snapshot = await client.fetchSnapshot()
await pullContent({ outDir: 'src/generated/content', client })
```
