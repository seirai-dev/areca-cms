# Framework wiring

Use the section for the framework detected in step 0. Each section gives the pattern and a small example. The API is in the `areca-sdk` skill. Do not add other helpers.

The reference implementation is the demo site: https://github.com/seirai-dev/areca-cms/tree/main/examples/demo-site (TanStack Start with Paraglide, two languages, drafts, health route). Copy its patterns, not its copy.

Rules for every framework:

- Read content only on the server or at build time. Import `content` in server code only: a server function, a server component, a build script or a server route.
- Never import the generated `content` into a client component or a browser bundle. It reads files with `node:fs`, so the client build breaks or leaks server code.
- Use the same code path for every page. Keep list and detail pages on the same functions.
- Typecheck only after the first release pull (`areca.gen.ts` is written by the pull). Before that, check the files by reading them.

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

Keep the script names the ones your project uses. `content:sync` is for MCP-first. Code-first uses `content:pull` and `sync-manifest`. How `content:sync` behaves (it asks only before a removal) is in [SKILL.md](../SKILL.md), step 4b.

`areca pull` reads `areca.config.ts` and `.env.local` itself, so the hook needs no extra flags.

## Paraglide with TanStack Start (verified)

Paraglide is the only i18n library the SDK wires for you. With `i18n: { paraglide: './src/paraglide/runtime.js' }` in `areca.config.ts`, the generated content module reads the language from Paraglide's `getLocale()`. Use Paraglide when the project has no i18n library yet. If the project already uses another library, use the explicit locale (the end of this file).

This recipe was run end to end on a TanStack Start app with two languages (`en` main, `nl`). The Dutch blog is `/nl/blog/<slug>`, and the Dutch vacancies are `/nl/vacatures/<slug>`. Versions: `@inlang/paraglide-js` 2.29.1, `@tanstack/react-start` 1.169.4, Node 24.

Install only after the user says yes (step 1). The other steps only change files the plan names.

1. Install: `<pm> add @inlang/paraglide-js`. The compile reads plugins from a CDN (see the settings file), so it needs internet access.
2. Create `project.inlang/settings.json`. Keep `baseLocale` and `locales` equal to `languages` in `areca.config.ts`:

   ```json
   {
     "$schema": "https://inlang.com/schema/project-settings",
     "baseLocale": "en",
     "locales": ["en", "nl"],
     "modules": [
       "https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@4/dist/index.js",
       "https://cdn.jsdelivr.net/npm/@inlang/plugin-m-function-matcher@2/dist/index.js"
     ],
     "plugin.inlang.messageFormat": {
       "pathPattern": "./messages/{locale}.json"
     }
   }
   ```

3. Create `messages/en.json` and `messages/nl.json`. Each holds only `{ "$schema": "https://inlang.com/schema/inlang-message-format" }`. Add UI strings later. Until then, the UI text stays in one language.
4. `tsconfig.json`: add `"allowJs": true` to `compilerOptions`. The compiled Paraglide files are JavaScript. The `#/*` alias must exist in `tsconfig.json` (`paths`) and `package.json` (`imports`). The scaffold has both. Add them if they are missing.
5. `areca.config.ts`: add `i18n: { paraglide: './src/paraglide/runtime.js' },` below `languages`.
6. `package.json` scripts. Keep `dev` as it is. Add `paraglide`, add `predev`, and change `prebuild` so the compile runs before the pull:

   ```json
   "paraglide": "paraglide-js compile --project ./project.inlang --outdir ./src/paraglide",
   "predev": "pnpm run paraglide",
   "prebuild": "pnpm run paraglide && areca pull"
   ```

   The pull writes `areca.gen.ts`, which imports `src/paraglide/runtime.js`. The compile must exist before the typecheck.
7. `vite.config.ts`: add the Paraglide plugin, and point the TanStack Start server at `src/server.ts`:

   ```ts
   import { paraglideVitePlugin } from '@inlang/paraglide-js'
   // ...
   plugins: [
     paraglideVitePlugin({
       project: './project.inlang',
       outdir: './src/paraglide',
       strategy: ['url', 'baseLocale'],
     }),
     tanstackStart({ server: { entry: 'server.ts' } }),
     viteReact(),
   ],
   ```

   `strategy: ['url', 'baseLocale']` takes the language from the URL prefix only. Pages never depend on a cookie or the browser language.
8. `src/server.ts` (new). It sets the language for each server request from the URL:

   ```ts
   import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
   import type { Register } from '@tanstack/react-router'
   import type { RequestHandler } from '@tanstack/react-start/server'
   import { paraglideMiddleware } from '#/paraglide/server.js'

   const startFetch = createStartHandler(defaultStreamHandler)

   const fetch: RequestHandler<Register> = (req, ...args) =>
     paraglideMiddleware(req, () => startFetch(req, ...args))

   export default { fetch }
   ```

9. `src/lib/locale-routes.ts` (new). Routes are written once in the base language. This file translates the page segment for each other language:

   ```ts
   export const BASE_LOCALE = 'en'
   export const LOCALES = ['en', 'nl'] as const
   export type Locale = (typeof LOCALES)[number]

   // Base segment -> segment per language. Keep in step with `routes` in areca.config.ts.
   export const SEGMENTS: Record<string, Partial<Record<Locale, string>>> = {
     vacancies: { nl: 'vacatures' },
   }

   function mapFirstSegment(pathname: string, map: (segment: string) => string): string {
     const parts = pathname.split('/')
     if (parts.length < 2 || parts[1] === '') return pathname
     parts[1] = map(parts[1]!)
     return parts.join('/')
   }

   /** /vacancies/x -> /vacatures/x for nl. */
   export function toLocalePath(pathname: string, locale: Locale): string {
     if (locale === BASE_LOCALE) return pathname
     return mapFirstSegment(pathname, (segment) => SEGMENTS[segment]?.[locale] ?? segment)
   }

   /** The inverse: /vacatures/x -> /vacancies/x. */
   export function toBasePath(pathname: string, locale: Locale): string {
     if (locale === BASE_LOCALE) return pathname
     return mapFirstSegment(pathname, (segment) => {
       const base = Object.keys(SEGMENTS).find((key) => SEGMENTS[key]?.[locale] === segment)
       return base ?? segment
     })
   }
   ```

10. `src/router.tsx`: add the URL rewrite. Paraglide adds and strips `/nl`, and this code translates the page segment:

    ```tsx
    import { createRouter as createTanStackRouter } from '@tanstack/react-router'
    import { deLocalizeUrl, getLocale, localizeUrl } from '#/paraglide/runtime'
    import { routeTree } from './routeTree.gen'
    import { toBasePath, toLocalePath } from './lib/locale-routes'

    function withPathname(url: URL, pathname: string): URL {
      const next = new URL(url.href)
      next.pathname = pathname
      return next
    }

    export function getRouter() {
      const router = createTanStackRouter({
        routeTree,
        scrollRestoration: true,
        defaultPreload: 'intent',
        defaultPreloadStaleTime: 0,
        rewrite: {
          input: ({ url }) => {
            const base = deLocalizeUrl(url)
            return withPathname(base, toBasePath(base.pathname, getLocale()))
          },
          output: ({ url }) => {
            const locale = getLocale()
            return localizeUrl(withPathname(url, toLocalePath(url.pathname, locale)), { locale })
          },
        },
      })
      return router
    }

    declare module '@tanstack/react-router' {
      interface Register {
        router: ReturnType<typeof getRouter>
      }
    }
    ```

11. Routes: write the base-language routes only (`src/routes/blog/$slug.tsx`, `src/routes/vacancies/index.tsx`, and so on). Do not make `routes/nl/` copies. Every loader passes the language from `getLocale()`:

    ```tsx
    import { getLocale } from '#/paraglide/runtime'
    // ...
    loader: async ({ params }) => {
      const post = await loadPost({ data: { locale: getLocale(), slug: params.slug } })
      if (!post) throw notFound()
      return post
    },
    ```

    The list rows use TanStack `Link` with the base route. The router rewrite adds `/nl` for Dutch:

    ```tsx
    <Link to="/blog/$slug" params={{ slug: row.slug }}>{row.title}</Link>
    ```

12. `src/routes/__root.tsx`: set the page language from the URL: `<html lang={getLocale()}>` (import `getLocale` from `#/paraglide/runtime`).
13. Check, in this order:

    ```bash
    <pm> run generate-routes     # regenerates routeTree.gen.ts (or: <pm> exec tsr generate)
    <pm> exec tsc --noEmit
    <pm> run build
    ```

    Then start the dev server (`<pm> run dev`) and check the pages with the HTTP checks in [first-release.md](first-release.md).

Notes:

- The `routes` values in `areca.config.ts` (for example `routes: { nl: '/vacatures/$slug' }`) have no `/nl` prefix. Keep `SEGMENTS` in step with them. See [recipes.md](recipes.md#routes-and-languages).
- The check was done with `curl` on server-rendered pages. Client-side navigation was not tested in a browser.
- The recipe does not turn on prerendering. Add `prerender` in the Vite config only when the site needs static HTML, and exclude `/__preview` and `/api` (as in the demo).

## TanStack Start

Detected by `@tanstack/react-start` in `package.json`. This section is for a site without Paraglide. For Paraglide, follow the recipe above first, then use the same pattern. The loaders pass `getLocale()` instead of a fixed locale.

No framework yet? Use the TanStack CLI: `<pm> dlx @tanstack/cli@latest create`. Do not use `create-tsrouter-app`. The rest of this skill assumes the site already exists.

Dependency to add (ask first): `@tanstack/markdown@1.0.0`, the same version the SDK pins. Install it with `<pm> add @tanstack/markdown@1.0.0`.

Rules for this framework:

- Server functions return plain data only: strings, numbers, arrays and objects. Do not return the entry, `seo` or a rich text object. `seo.jsonLd` and `richText.json` do not serialize, so the typecheck fails. Build the head on the server with `seoHead(...)`, and the body as a Markdown string with `richTextMarkdown(...)`.
- Keep every content call inside a `createServerFn`. Route files import the server function, never the content object.
- `.validator(...)` takes a plain function. No `zod` is needed.
- Run the typecheck only after the first pull (`areca.gen.ts` does not exist before it). Generate the route tree first (`<pm> run generate-routes`, or `<pm> exec tsr generate`), then `<pm> exec tsc --noEmit`.

### Server functions

```ts
// src/lib/content.functions.ts (server only)
import { createServerFn } from '@tanstack/react-start'
import { richTextMarkdown, seoHead, type SeoHeadResult } from '@areca-cms/site-sdk'
import { content } from '../generated/content/areca.gen'

type Locale = 'en' | 'nl' // the languages in areca.config.ts

function parseLocale(value: unknown): Locale {
  if (value === 'en' || value === 'nl') return value
  throw new Error(`Unknown locale: ${String(value)}`)
}

// The SDK's route has no language prefix. Add it for every language but the main one.
const localePath = (locale: Locale, path: string) => (locale === 'en' ? path : `/${locale}${path}`)

export type ListRow = { slug: string; title: string; summary: string | null; href: string }
export type PostPage = { title: string; body: string; head: SeoHeadResult }

export const loadPosts = createServerFn({ method: 'GET' })
  .validator((input: { locale: unknown }) => ({ locale: parseLocale(input.locale) }))
  .handler(({ data }): ListRow[] =>
    content
      .in(data.locale)
      .posts.all({ orderBy: { publishedAt: 'desc' } })
      .map((post) => ({
        slug: post.slug,
        title: post.data.title,
        summary: post.data.excerpt ?? null,
        href: localePath(data.locale, content.in(data.locale).posts.href(post.slug)),
      })),
  )

export const loadPost = createServerFn({ method: 'GET' })
  .validator((input: { locale: unknown; slug: unknown }) => ({
    locale: parseLocale(input.locale),
    slug: String(input.slug),
  }))
  .handler(({ data }): PostPage | null => {
    const post = content.in(data.locale).posts.get(data.slug)
    if (!post) return null
    return {
      title: post.data.title,
      body: richTextMarkdown(post.data.body),
      head: seoHead(post.seo, { siteName: 'Acme' }),
    }
  })
```

Replace `Acme` with the client's name from `companyInfo`. For a single-language site, drop `locale`, `parseLocale` and `localePath`, and call `content.posts.all()`.

### Detail and list routes

```tsx
// src/routes/blog/$slug.tsx
import { createFileRoute, notFound } from '@tanstack/react-router'
import { loadPost } from '../../lib/content.functions'
import { PostDetail } from '../../components/pages'

export const Route = createFileRoute('/blog/$slug')({
  loader: async ({ params }) => {
    const post = await loadPost({ data: { locale: 'en', slug: params.slug } })
    if (!post) throw notFound()
    return post
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: PostPage,
})

function PostPage() {
  return <PostDetail post={Route.useLoaderData()} />
}
```

Each language has its own route file that calls the same loader with its own locale. For Dutch, `src/routes/nl/blog/$slug.tsx` uses `locale: 'nl'` and renders the same component.

The list route (`src/routes/blog/index.tsx`) uses `loader: () => loadPosts({ data: { locale: 'en' } })`. Its rows already carry `href`.

```tsx
// src/components/pages.tsx
import { Markdown } from '@tanstack/markdown/react'
import { richTextComponents } from '@areca-cms/site-sdk/rich-text-react'
import type { ListRow, PostPage } from '../lib/content.functions'

export function ListPage({ heading, rows }: { heading: string; rows: ListRow[] }) {
  return (
    <main>
      <h1>{heading}</h1>
      <ul>
        {rows.map((row) => (
          <li key={row.slug}>
            <a href={row.href}>{row.title}</a>
            {row.summary ? <p>{row.summary}</p> : null}
          </li>
        ))}
      </ul>
    </main>
  )
}

export function PostDetail({ post }: { post: PostPage }) {
  return (
    <article>
      <h1>{post.title}</h1>
      <Markdown components={richTextComponents()}>{post.body}</Markdown>
    </article>
  )
}
```

`richTextComponents()` keeps the image sizes from the CMS. Use it with every `Markdown` element.

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
- `entry.alternates` holds the route of each language **without** the `/nl` prefix (see [recipes.md](recipes.md#routes-and-languages)). Add the prefix yourself before you use it for hreflang. The main language has no prefix:

  ```ts
  const alternates = Object.fromEntries(
    Object.entries(entry.alternates ?? {}).map(([tag, path]) => [
      tag,
      tag === content.languages?.main ? path : `/${tag}${path}`,
    ]),
  )
  seoHead(entry.seo, { locale: entry.locale, alternates, main: content.languages?.main })
  ```

- Set the HTML `lang` attribute to the page language.
- `content.in(locale).<collection>.href(slug)` returns the route without the prefix too. Add the same prefix for links.

For the full language API, read the `areca-sdk` skill, `references/languages.md`.
