---
name: areca-sdk
description: Connects a website project to Areca CMS with the @areca-cms/site-sdk package. Covers setup, tokens and env vars, areca.config.ts collections, site content globals and field types, the areca CLI (init, manifest push/pull, pull, run), typed content from the generated areca.gen.ts (import { content }), rich text, SEO head tags, multilingual sites (languages, locales, hreflang), draft preview routes and Go-live builds. Use when a project imports @areca-cms/site-sdk, has an areca.config.ts or areca.gen.ts, mentions ARECA_* env vars, or the user wants to add, render or deploy Areca CMS content.
license: MIT
metadata:
  version: "0.7.0"
---

# Areca site SDK

`@areca-cms/site-sdk` connects a Node.js website to one site in an Areca CMS. The schema is declared in code and pushed to the CMS. Editors write and publish there, and the website pulls the published snapshot as JSON at build time. Visitor requests never call the CMS.

Requirements: Node >= 22.6 (24 LTS recommended), ESM only. It works with any framework because the core has no React dependency.

## Mental model

1. `areca.config.ts` declares **collections** (content types), **globals** (single site content sections) and their **fields**.
2. `areca manifest push` sends that schema to the CMS (needs the schema token). It is refused while a removed field still holds content, until the removal is confirmed.
3. Editors create entries in the CMS and **Go live**, which creates an immutable **publication** (snapshot) with the schema embedded.
4. `areca pull` downloads the publication into `src/generated/content/` and writes `src/generated/content/areca.gen.ts`.
5. Server code reads it through the typed `content` object from `areca.gen.ts`: `import { content } from "../generated/content/areca.gen"`.

Typing is generated, not hand-written: after a pull, every collection, field, value, select option, reference and route is typed and autocompletes. Commit `areca.gen.ts`; never commit the pulled JSON. Single sections of values, such as company details or the home page, are site content (`globals`). There are no blocks, webhooks or HTTP query API. A "page" is an entry in a collection, or a site content section. Queries run in memory on the pulled files, with `where`, `orderBy`, `limit`, `offset` and `with`.

## Setup

```bash
pnpm add @areca-cms/site-sdk          # or npm install / yarn add
pnpm exec areca init                  # interactive; writes config, env files, scripts
# non-interactive:
pnpm exec areca init --cms-url https://cms.example.com --token "$ARECA_SITE_TOKEN" --site-key acme-site --yes
```

`init` writes `areca.config.ts` (including an `assets` block), `.env.example`, `.env.local` (`ARECA_CMS_URL`, `ARECA_SITE_TOKEN`), `.gitignore` entries (the pulled content folder as `<out>/*` with `!<out>/areca.gen.ts` so the types stay tracked, and the media folder), `src/generated/content/manifest.json`, and the package scripts `sync-manifest` and `content:pull`. It also wraps `dev` in `areca run --`. Use `--force` to overwrite an existing config. `--out` and `--config` change the paths. Media flags: `--assets-dir <dir>` (default `public/areca`), `--assets-public-path <path>` (only for folders outside `public/`), `--no-assets`. On an existing config, init inserts an `assets` block if there is none.

| Env var | Needed for | Where the user gets it |
| --- | --- | --- |
| `ARECA_CMS_URL` | everything | The CMS base URL, e.g. `https://cms.example.com` |
| `ARECA_SITE_TOKEN` | reads (pull, `manifest pull`, the client's snapshot calls) | CMS: site Settings > Developer > build token (shown once; rotate to get a new one) |
| `ARECA_SCHEMA_TOKEN` | `manifest push` only | Settings > Developer > Rotate schema token. Keep it in the authoring env only, never in builds. |
| `ARECA_SITE_KEY` | `manifest pull` without a config | The site key shown in Settings |
| `ARECA_SNAPSHOT_ID` | pinned pulls during Go-live builds | Set by the CMS deploy; empty or `0` means current live |
| `ARECA_CONTENT_DIR` | the generated `content` object at run time | Optional. The content folder, when it is not the folder that was pulled into |

The CLI loads `.env.local` and then `.env`, and existing process env wins. Library imports do **not** load env files. Each call reads only the credential it sends: a schema push needs the schema token but not the site token, and a preview needs neither (its token is signed).

**Security:** both tokens are server secrets. Never put them in browser code or behind a `VITE_`, `NEXT_PUBLIC_` or `PUBLIC_` prefix, and never commit them. Only import the content object, `readContent` and the client in server or build code.

## Declare content

```ts
// areca.config.ts
import { defineSiteContent } from "@areca-cms/site-sdk";

export default defineSiteContent({
  siteKey: "acme-site", // must match the CMS site key
  collections: {
    articles: {
      route: "/blog/$slug", // documentation only; build the route yourself
      label: "Articles",
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "slug", label: "Slug", type: "slug", required: true },
        { key: "body", label: "Body", type: "richtext" },
        { key: "cover", label: "Cover", type: "image" },
        { key: "category", label: "Category", type: "select", options: ["news", "guides"] },
        { key: "author", label: "Author", type: "reference", collection: "authors" },
        { key: "startsAt", label: "Starts", type: "datetime" },
        { key: "endsAt", label: "Ends", type: "datetime", after: "startsAt" },
      ],
    },
    authors: {
      route: "/authors/$slug",
      fields: [{ key: "name", label: "Name", type: "text", required: true }],
    },
  },
});
```

- Field types: `text`, `textarea`, `richtext`, `image`, `date`, `datetime`, `select` (`options`), `reference` (`collection`, required), `slug`, `boolean`, `number`, `url`. Optional per field: `required`, `description`, `after` (only on `date` or `datetime`, naming another date key in the same collection).
- `defineSiteContent` checks these at compile time: `options` only on `select`, `collection` required on `reference` and must be a collection key of the same config, `after` must name a date key, and `route` must contain `$slug`.
- Keys match `^[A-Za-z][A-Za-z0-9_-]{0,63}$`. Collection keys must be unique case-insensitively. Reserved: `manifest`, `constructor`, `prototype`, `__proto__`, and Windows device names (`con`, `prn`, `aux`, `nul`, `com1`, `lpt1`, ...).
- Collection keys cannot be `resolve`, `href`, `preview`, `globals` or `previewGlobals` (any case, and `preview-globals` too), because the content object uses those names. Field keys may use them.
- In code, keys are camelCase: `blog-posts` is `content.blogPosts`, `cover_image` is `entry.data.coverImage`. The pull fails when two keys collide after this conversion (`blog-posts` and `blog_posts`).
- A push is the **full** manifest. Collections left out are disabled (their entries are kept). The CMS adds a required `slug` field if one is missing. Limits: 100 collections, 100 fields each, 256 KiB.
- `areca manifest pull --config areca.config.ts [--yes]` regenerates the config from the CMS. It replaces the whole file and keeps `siteKey` and `assets`. It prints the changes first. It asks (`--yes` without a TTY) only when something would be removed: a collection, a site content section, a field, a language, or the main language. Additions and changes are written without a question. A file that already matches writes nothing. A hand-written config that defines collections still asks before it is replaced.
- **Removing a field that still holds content** deletes that content. `manifest push` lists the affected fields (`key.field`, with the entry count) and pushes nothing until they are confirmed: `--confirm-drop <key.field>` per field (repeatable), or `--yes` for all. In code, `syncManifest(config, { confirmDropFields: ["articles.subtitle"] })` does the same. An unconfirmed push throws `FieldDropsRequiredError` (exported; `.drops` holds the `FieldDrop` list, each `{ kind, key, field, entries }`). **Ask the user before confirming a drop**; never add `--yes` or `--confirm-drop` on your own.

### Site content (globals)

```ts
globals: {
  companyInfo: {
    label: "Company info",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "email", label: "Email", type: "text", group: "Contact" },
    ],
  },
  homePage: { label: "Home page", seo: true, previewPath: "/", fields: [/* ... */] },
},
```

- A global is one set of fields with no slug and no route. Its key follows the same identifier rules as a collection key and may not be `globals`, `previewGlobals`, `resolve`, `href` or `preview`.
- `seo: true` adds a `$seo` value. `previewPath` is the page that shows the draft. Both are optional.
- `group` is an editor heading only. The SDK value stays flat, and collection fields may not set `group`.
- Sections may reference collections, not the other way round. A push is a full sync: a section left out is disabled and its content is kept.

### Media (`assets`)

```ts
assets: { download: true, dir: "public/areca" /*, publicPath: "/areca" */ }, // top level of defineSiteContent
```

`areca pull` copies every file the content uses (image fields, SEO images, rich-text images and file links) into `dir` and rewrites URLs to `<publicPath>/<name>-<id>.<ext>`, so the deployed site never calls the CMS. `publicPath` is derived for folders under `public/`; set it for others (e.g. SvelteKit `static/`). SEO image URLs become absolute with the site's production URL. `download: false` keeps CMS URLs. The setting is local only; `manifest push` does not send it. A failed download fails the pull without changing the current content.

## CLI

```text
areca init [--cms-url <url>] [--token <t>] [--site-key <key>] [--out <dir>] [--config <path>]
           [--assets-dir <dir>] [--assets-public-path <path>] [--no-assets] [--yes] [--force]
areca manifest push [config] [--confirm-drop <key.field>]... [--yes]   # needs ARECA_SCHEMA_TOKEN and ARECA_CMS_URL
areca manifest pull [--config <path>] [--yes]
areca pull [--out <dir>] [--publication <id>] [--config <path>] [--types <path>]   # default out: src/generated/content; types: <out>/areca.gen.ts; media: public/areca
areca run -- <command>                   # run a command with .env.local/.env loaded
```

`areca sync-manifest` is a deprecated alias for `manifest push`. Run the CLI as `pnpm exec areca`, `npx areca` or `yarn areca`. A pull fails until something has gone live in the CMS. To pull before every build, add `"prebuild": "areca pull"`. A pull prints a `Types:` line with the file it wrote, and it fails before writing anything when an entry does not match its schema or two keys collide in camelCase.

## Read typed content (server or build only)

```ts
// src/lib/content.ts: server only
import { content } from "../generated/content/areca.gen";

export function getNewsArticles() {
  return content.articles.all({ where: { category: "news" }, orderBy: { startsAt: "desc" }, limit: 10 });
}

export function findArticle(slug: string) {
  return content.articles.get(slug); // Entry | undefined
}

// in a server function:
const author = content.resolve(article.data.author); // Entry<"authors"> | null
```

- Each collection has `all(options?)`, `first(options?)`, `get(slug)`, `byId(id)` and `href(entryOrSlug)`. `get` and `byId` return `undefined` for an unknown value.
- `where`: a direct value means equality. Operators depend on the field type: text fields take `eq`, `ne`, `in`, `notIn`, `contains`; `select` takes `eq`, `ne`, `in`, `notIn`; `date`, `datetime` and `number` take `eq`, `ne`, `gt`, `gte`, `lt`, `lte`; `boolean` takes `eq`, `ne`; optional fields of any type take `isNull`. Several keys are AND-ed. Null, `''` and a missing key count as empty.
- `orderBy` takes an object such as `{ startsAt: "desc" }`, or an array for tie-breakers. Empty values sort last. Images, rich text and references are not sortable.
- `with: { author: true }` expands reference fields one level. `content.resolve(ref)` returns the target entry or `null`. `content.href(ref)` and `content.blogPosts.href(entry)` build routes, typed as template literals.
- `content.preview(token)` fetches a draft for a preview route. Check `result.complete` first: when true, `entry` is an `Entry`; when false, `entry` is a `DraftEntry` (every field optional) and `issues` lists the problems as `<field>: <problem>`.
- Entry: `{ id, slug, publishedAt, collection, data, seo? }`. Field values live in `data`, keyed by camelCase field name. No hand-written types are needed. Types are per collection, with `Entry<"articles">` for one collection.
- Optional fields can be `null`, missing or `''`, and the types show each case. Required fields are never empty.
- `ImageValue` = `{ url, width|null, height|null, alt, mimeType }`, where `url` is the local path after `areca pull` (e.g. `/areca/hero-3f2a91c0.jpg`), or an absolute CMS URL with `assets.download: false`. Serve the media folder with the site (it is part of `public/` by default). `ReferenceValue<C>` = `{ collection, slug, id }`.
- The content object reads files at runtime, so ship `src/generated/content/` (including `.publications/`) with the server build or container. For TanStack Start, call it inside a `createServerFn` handler, never in route or component code.
- Low-level: `readContent(dir, "blogPosts")` from `@areca-cms/site-sdk/pull` returns the typed entries of one collection and takes no type parameter. Use `readContentManifest(dir)` once when reading several collections from one publication.
- `content.globals.<camelKey>` returns a section as a flat object of its field values, plus `$seo` when SEO is on. Types: `CompanyInfoGlobal` (exported from `areca.gen.ts`), and `Global<K>`, `Globals`, `GlobalKey`, `GlobalData` and `GlobalSchema` from the package root. Without a registered schema, the value is typed as a loose record.
- `content.previewGlobals(token)` returns `{ globals, previewing, complete, issues }`. `previewing` is the camel key of the section the token targets (or `null`). A valid draft is in `globals`; an incomplete one keeps the published section, with `complete: false` and `issues` listing the problems. It also accepts a `PreviewResult` or `null`.

## Languages

Only when the CMS site has content languages. Set `languages`, `routes`, `requiredLanguages` and `translatable` in `areca.config.ts`. Reads pick a language with `content.in(locale)`, a per-call `{ locale, fallback }` or the `createContent({ locale })` resolver, and fall back to the main language. Entries carry `locale`, `isFallback`, `locales` and `alternates`; globals carry `$locale` and `$isFallback`. `seoHead` takes `locale` and `alternates` for hreflang, and `content.matchLocale` picks a visitor's language. `Href` is the union of every language's route; `content.in(locale)` narrows `href()` to that language's route. A pulled media URL is rewritten in every language view, so each language gets local files. Read [references/languages.md](references/languages.md) for the Paraglide setup, the other i18n libraries, preview with `locale`, and every export.

## Rich text

```tsx
import { Markdown } from "@tanstack/markdown/react"; // pnpm add @tanstack/markdown@1.0.0 (match the SDK)
import { richTextComponents } from "@areca-cms/site-sdk/rich-text-react";
import { richTextDocument } from "@areca-cms/site-sdk";

<Markdown components={richTextComponents()}>{richTextDocument(article.data.body)}</Markdown>
```

`RichTextValue` = `{ document, markdown, html, json }`. Outside React, use `richTextHtml(value)`, which is trusted CMS HTML, or `richTextMarkdown(value)`. Keep `img { max-width: 100% }` and don't force `width: 100%`, because editors set image sizes.

## SEO

- TanStack Router: `head: ({ loaderData }) => seoHead(loaderData?.post.seo, { titleTemplate: "%s · Acme", siteName: "Acme" })`.
- Astro or plain SSR: `seoHeadHtml(entry.seo, options)` from `@areca-cms/site-sdk/seo` returns an escaped HTML string. `seoJsonLd(seo)` returns safe JSON-LD strings.
- `seo` is optional. When `seo.summary`, `keyTakeaways` or `faq` exist, render them visibly on the page so the content matches the JSON-LD.

- Site content sections with `seo: true` have `$seo` on the section value, in the same shape as an entry's `seo`: `seoHead(content.globals.homePage.$seo)`.

## Preview, Go live and the client

Read [references/production.md](references/production.md) when the user needs any of these:

- A draft preview route: `getPreviewEntry` and `previewHeaders` at `/__preview/<collection>/<slug>?token=`, or `content.preview(token)` for a typed result. A site content section previews on its `previewPath` with `?arecaPreview=<token>`, and `content.previewGlobals(token)` returns the page's values, with the draft in place when it is complete and `previewing` is the page's section.
- The production health route that Go live waits for.
- Docker or CI builds with `ARECA_SNAPSHOT_ID`.
- The CMS settings needed: production URL, deployment target, publishing mode.
- Direct use of `createArecaClient` and error messages.

Visual editing (the CMS visual editor's live preview and click to edit, SDK 0.9.0+). Details in [references/production.md](references/production.md):

- `visualEditingHeaders({ cmsOrigin })` from `@areca-cms/site-sdk/visual` sends `frame-ancestors` on the preview route only.
- Live updates: `useLivePreview({ initial, cmsOrigin, resolve })` from `@areca-cms/site-sdk/visual-react` (React), or `createVisualBridge({ cmsOrigin, onUpdate })` from `@areca-cms/site-sdk/visual`. Render each unsaved result on the server with `content.previewFrom(result)`, or `content.previewGlobals(result)` for site content.
- `field(key, owner?)` from `@areca-cms/site-sdk/visual` returns the attributes to spread on the element that shows a field. Owner is `{ entry: id }` or `{ global: key }`. Keys are camelCase or raw; SEO is `$seo.title`. Render the attributes only on preview pages.

Read [references/api.md](references/api.md) for every export, type and signature, and [references/languages.md](references/languages.md) for languages.

## Rules

- Change the schema in `areca.config.ts` and then `manifest push`, then go live and pull. Confirm a field removal or a language removal with the user first: both can delete content or stop a language being served. Don't hand-edit generated content or `areca.gen.ts`; a pull rewrites both.
- Commit `areca.gen.ts`. Keep the pulled JSON out of Git.
- Never import the content object, `@areca-cms/site-sdk/pull` or a client with tokens into browser bundles.
- Exclude `/__preview/*` from prerendering and caching.
- Never render `data-areca-*` markers or send `frame-ancestors` headers on public pages. Only preview routes do.
- The SDK doesn't create CMS sites or tokens. An agency admin creates the site in the CMS. Ask the user for the URL, site key and tokens instead of guessing them.
- To edit content (not code) through an AI, use the Areca MCP server (see the `areca-mcp` skill).
