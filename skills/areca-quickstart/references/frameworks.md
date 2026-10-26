# Framework wiring

Use the section for the framework detected in step 0. Each section gives the pattern and a small example. The API is in the `areca-sdk` skill. Do not add other helpers.

The reference implementation is the demo site: https://github.com/ekozf/areca-cms/tree/master/examples/demo-site (TanStack Start with Paraglide, two languages, drafts, health route). Copy its patterns, not its copy.

Rules for every framework:

- Read content only on the server or at build time. Import `content` in server code only: a server function, a server component, a build script or a server route.
- Never import the generated `content` into a client component or a browser bundle. It reads files with `node:fs`, so the client build breaks or leaks server code.
- Use the same code path for every page. Keep list and detail pages on the same functions.
- Write the file, then run the typecheck (step 6) before you move to the next file.

Common pieces, in every framework:

```json
{
  "scripts": {
    "content:sync": "areca manifest pull && areca pull --out src/generated/content",
    "content:pull": "areca pull --out src/generated/content",
    "prebuild": "areca pull"
  }
}
```

Keep the script names the ones your project uses. `content:sync` is for MCP-first. Code-first uses `content:pull` and `sync-manifest`.

`areca pull` reads `areca.config.ts` and `.env.local` itself, so the hook needs no extra flags.

## Paraglide (only when the plan uses it)

Paraglide is the only i18n library the SDK wires for you. With it set in the config (`i18n: { paraglide: './src/paraglide/runtime.js' }`), `areca pull` passes Paraglide's `getLocale` to the generated content object. The current URL language is then used for every read.

Steps (install only after the user says yes):

1. `pnpm add @inlang/paraglide-js`
2. Create `project.inlang/settings.json`. Copy the shape from the demo (`examples/demo-site/project.inlang/settings.json`). Set `baseLocale` to the main language and `locales` to `languages.all`. Keep them equal to `areca.config.ts`.
3. Compile before anything imports the generated content, and before the pull:

   ```json
   {
     "scripts": {
       "paraglide": "paraglide-js compile --project ./project.inlang --outdir ./src/paraglide",
       "predev": "pnpm run paraglide",
       "prebuild": "pnpm run paraglide && areca pull"
     }
   }
   ```

   The generated `areca.gen.ts` imports the runtime from `src/paraglide`. A build without the compile step fails with a missing module.
4. Use the URL strategy only. Locale comes from the URL prefix, so prerendered pages never depend on a cookie or the browser language. The demo uses `strategy: ['url', 'baseLocale']`.
5. Route paths are written once in the main language. The other language's path segments come from `routes` in `areca.config.ts`. Use the demo's router setup (`src/router.tsx`, `src/lib/locale-routes.ts`) as the pattern.

Without Paraglide, pass the locale yourself (see "Explicit locale" at the end).

## TanStack Start

Detected by `@tanstack/react-start` in `package.json`. Mirror the demo.

Dependencies to add (ask first): `@tanstack/markdown@1.0.0` for rich text (same version as the SDK).

### Server functions

Keep every content call inside a `createServerFn`. The route files import the server function, not the content object.

```ts
// src/lib/content.functions.ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { content } from '../generated/content/areca.gen'

const slugInput = z.object({ slug: z.string().min(1) })

export const loadPosts = createServerFn({ method: 'GET' }).handler(() =>
  content.posts.all({ orderBy: { publishedAt: 'desc' } }),
)

export const loadPost = createServerFn({ method: 'GET' })
  .validator(slugInput)
  .handler(({ data }) => {
    const post = content.posts.get(data.slug)
    if (!post) return null
    return { post, author: content.resolve(post.data.author) }
  })
```

The demo uses the same `.validator(...)` call with zod. If the project uses a newer TanStack Start version that renames it, follow the version the project already uses.

### Detail route with SEO and rich text

```tsx
// src/routes/blog/$slug.tsx
import { createFileRoute, notFound } from '@tanstack/react-router'
import { Markdown } from '@tanstack/markdown/react'
import { richTextDocument, seoHead } from '@areca-cms/site-sdk'
import { richTextComponents } from '@areca-cms/site-sdk/rich-text-react'
import { loadPost } from '../../lib/content.functions'

export const Route = createFileRoute('/blog/$slug')({
  loader: async ({ params }) => {
    const result = await loadPost({ data: { slug: params.slug } })
    if (!result) throw notFound()
    return result
  },
  head: ({ loaderData }) =>
    seoHead(loaderData?.post.seo, { titleTemplate: '%s · Acme', siteName: 'Acme' }),
  component: PostPage,
})

function PostPage() {
  const { post } = Route.useLoaderData()
  return (
    <article>
      <h1>{post.data.title}</h1>
      <Markdown components={richTextComponents()}>{richTextDocument(post.data.body)}</Markdown>
    </article>
  )
}
```

The list route (`src/routes/blog/index.tsx`) uses `loader: () => loadPosts()` and maps the entries to links with `content.posts.href(post)`.

Replace `Acme` with the client's site name from `companyInfo`, or pass it in from the root route.

### Preview route (optional)

Only when the user wants drafts. The CMS opens `<productionUrl>/__preview/<collection>/<slug>?token=…`.

- Name the folder `[__preview]` so the router keeps the `__preview` path (the demo does this).
- Read the token from the search params. Call `content.preview(token)` in a server function. Check `result.complete` before you render the entry. When it is false, show `result.issues`.
- Set the preview headers with `previewHeaders()` and add `<meta name="robots" content="noindex, nofollow">` in the head.
- Exclude `/__preview` from prerendering and caching. In the Vite config, use a `filter` on the prerender (the demo does this).

```ts
tanstackStart({
  prerender: {
    enabled: true,
    crawlLinks: true,
    filter: (page) => !page.path.startsWith('/__preview') && !page.path.startsWith('/api'),
  },
})
```

An expired or wrong preview link makes the fetch throw. Catch the error and show a short message, not a stack trace.

### Health route (only for go-live builds)

```ts
// src/routes/api/health.ts
import { createFileRoute } from '@tanstack/react-router'
import { readContentManifest } from '@areca-cms/site-sdk/pull'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: () => {
        try {
          const { publicationId } = readContentManifest('src/generated/content')
          return Response.json({ ok: true, publicationId })
        } catch {
          return Response.json({ ok: false }, { status: 503 })
        }
      },
    },
  },
})
```

## Next.js (App Router)

Detected by `next` in `package.json`, and an `app/` or `src/app/` folder. Needs Next 15 or newer, where `params` is a promise.

- Read content in server components (the default). Do not add `'use client'` to a file that imports the content.
- Use `generateStaticParams` for static detail pages. It runs at build time, after the pull.

```tsx
// app/blog/[slug]/page.tsx
import { notFound } from 'next/navigation'
import { richTextHtml, seoJsonLd } from '@areca-cms/site-sdk'
import { content } from '../../../src/generated/content/areca.gen'

type Props = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return content.posts.all().map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params
  const post = content.posts.get(slug)
  if (!post) return {}
  const seo = post.seo
  return {
    title: seo?.title ?? post.data.title,
    description: seo?.description ?? post.data.excerpt ?? undefined,
    alternates: { canonical: seo?.canonicalUrl ?? undefined },
    robots: seo ? { index: seo.robots.index, follow: seo.robots.follow } : undefined,
  }
}

export default async function PostPage({ params }: Props) {
  const { slug } = await params
  const post = content.posts.get(slug)
  if (!post) notFound()
  return (
    <>
      {seoJsonLd(post.seo).map((json, index) => (
        <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
      ))}
      <article>
        <h1>{post.data.title}</h1>
        {/* CMS HTML from the snapshot. Trusted output, so it is safe to render as HTML. */}
        <div dangerouslySetInnerHTML={{ __html: richTextHtml(post.data.body) }} />
      </article>
    </>
  )
}
```

Notes:

- `generateMetadata` covers the title, description, canonical and robots. Open Graph, hreflang and JSON-LD are the parts the SDK builds. Add the JSON-LD scripts (above) and the alternates on multilingual sites.
- Use the `alt` text and the sizes from `ImageValue` (`width`, `height`, `alt`) with `next/image`. The width and height can be `null`, so fall back to a plain `<img>`.
- Health route for go-live builds: `app/api/health/route.ts`, with `export const dynamic = 'force-dynamic'` and the same body as the TanStack health route (`readContentManifest` in a `try`, 503 on error).
- Preview: a route under a non-public path, marked `dynamic`, that calls `content.preview(token)` and sets `previewHeaders()`. Keep it out of `generateStaticParams`.

## Astro

Detected by `astro` in `package.json`. Astro builds static pages by default. The content is read in the frontmatter.

```astro
---
// src/pages/blog/[slug].astro
import { richTextHtml, seoHeadHtml, seoJsonLd } from '@areca-cms/site-sdk'
import { content } from '../../generated/content/areca.gen'

export function getStaticPaths() {
  return content.posts.all().map((post) => ({ params: { slug: post.slug }, props: { post } }))
}

const { post } = Astro.props
---
<html lang="en">
  <head>
    <Fragment set:html={seoHeadHtml(post.seo, { siteName: 'Acme' })} />
    {seoJsonLd(post.seo).map((json) => (
      <script type="application/ld+json" set:html={json} />
    ))}
  </head>
  <body>
    <article>
      <h1>{post.data.title}</h1>
      <Fragment set:html={richTextHtml(post.data.body)} />
    </article>
  </body>
</html>
```

Notes:

- `seoHeadHtml` returns the title, meta, link and script tags as one escaped string. Put it in `<head>` with `Fragment set:html`.
- Set `lang` on `<html>` to the page language.
- `getStaticPaths` runs at build time, after the pull. A detail page for every entry is generated.
- Preview on Astro: an SSR route with `output: 'server'` or an adapter. Ask before you change the output mode. It is a larger change. If the user wants it, call `content.preview(token)` there and set `previewHeaders()`.

## Vite or plain Node

Use this for any other setup, such as a Vite SPA with an API, Express, Hono, SvelteKit or a static generator.

- The generated module is plain TypeScript. Import it from server code, from a build script, or from a server route.
- The content is read from `src/generated/content` relative to the working directory. Run the commands from the project root.
- Add the pull to the prebuild script, as in the common pieces above.

```ts
// scripts/list-posts.ts (build time)
import { content } from '../src/generated/content/areca.gen.ts'

for (const post of content.posts.all()) {
  console.log(post.slug, post.data.title)
}
```

Use the SDK helpers in your renderer:

- `seoHeadHtml(entry.seo, options)` for `<head>` HTML (from `@areca-cms/site-sdk`).
- `richTextHtml(entry.data.body)` for body HTML. It is trusted CMS output.
- `richTextMarkdown(value)` when your renderer takes Markdown.

## Explicit locale

Use this when the project has an i18n library other than Paraglide, or when the server handles one request in several languages (for example next-intl).

```ts
content.in('nl').posts.all()             // every read in Dutch
content.posts.all({ locale: 'nl' })     // one call in Dutch
content.posts.get(slug, { locale: 'nl', fallback: false })  // only if a Dutch translation exists
content.matchLocale(request.headers.get('accept-language'))  // pick a language for a redirect
```

- Pass the locale from the route or the request. Do not rely on a global language setting in server code.
- `entry.isFallback` is `true` when the entry is shown in another language. Show a note or link to the main language.
- Use `seoHead(entry.seo, { locale: entry.locale, alternates: entry.alternates, main: content.languages?.main })` for hreflang.
- Set the HTML `lang` attribute to the page language.

For the full language API, read the `areca-sdk` skill, `references/languages.md`.
