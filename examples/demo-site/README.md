# Areca demo website

This TanStack Start website shows one way to use `@areca-cms/site-sdk`. It
downloads the current published snapshot during development/build, renders
articles from local JSON, prerenders article pages, and loads drafts through a
server-side preview route.

## Run with the CMS

Create a site in the CMS and save its **site token**. From this directory:

```bash
cp .env.example .env.local
```

Set the CMS URL and site token in `.env.local`:

```dotenv
ARECA_CMS_URL=http://localhost:3000
ARECA_SITE_TOKEN=paste-site-token-here
```

The file is gitignored. Start the dev site with:

```bash
pnpm dev
```

It runs on port `3001`. Its dev script reads `.env.local`. The first CMS-backed
run requires a published snapshot. From the repository root, pull it with:

```bash
pnpm --filter @areca/demo-site content:pull
```

If there is no publication, publish content in the CMS first; the command
fails with a publish-first message.

## Connect or update the schema

The schema is in [`areca.config.ts`](./areca.config.ts). It defines `articles`
with title, slug, excerpt, rich-text body, hero image, publication date, and
category. To send schema changes, also set `ARECA_SCHEMA_TOKEN` in `.env.local`
and run:

```bash
pnpm --filter @areca/demo-site sync-manifest
```

The schema token grants schema-write access. Keep it local to this authoring
environment. Routine content pulls and builds use the read-only site token.

## How the site reads content

`areca pull` writes `src/generated/content/areca.gen.ts` next to the pulled
JSON. That file is committed: it holds the schema, the entry types
(`ArticlesEntry`, `AuthorsEntry`, `CoffeesEntry`) and a typed `content` object.
`src/lib/content.ts` sorts the entries and `src/lib/queries.ts` exposes them to
route loaders through `content.articles`, `content.coffees`, `content.authors`,
`content.resolve()` and `content.preview()`. The pulled JSON stays ignored by
git. Routes: `/coffees` and `/coffees/$slug`, `/journal` and `/journal/$slug`,
`/team` and `/team/$slug`, and `/about`. Rich text is rendered from the SDK's
TanStack Markdown document. After you change `areca.config.ts`, run
`content:pull` or `content:fixture` again so `areca.gen.ts` matches the schema.

Vite prerenders the home page, every list and detail page, and `/about`.
It excludes `/__preview` and `/api` routes. `/api/health` reports the snapshot
publication ID and returns 503 when the generated manifest is missing.

## Preview drafts

The CMS opens `/__preview/<collection>/<slug>?token=<opaque-preview-token>`.
The preview route validates the query token, fetches the entry on the server
with `getPreviewEntry()`, and renders the article view. It sends
`X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`; its document
also has a `noindex, nofollow` robots meta tag. Invalid or expired tokens and
missing entries render an error message. The preview URL token is temporary:
do not log or store it.

Inside the Areca visual editor, the preview also shows unsaved changes as they
are typed: `loadLivePreview` renders the values the CMS sends, without saving
them. The preview document sends `Content-Security-Policy: frame-ancestors 'self'`
plus the origin of `ARECA_CMS_URL`, so only that CMS can frame it; other sites
still cannot.

### Field markers for the visual editor

The views put `data-areca-*` markers on the elements that show a field, so the
visual editor can outline them and jump to the field on click. Markers come from
`useField()` in `src/lib/visual-markers.tsx`, which returns the SDK's `field()` on
the preview route and `{}` everywhere else. The root layout turns them on from
the route match, so public pages render no markers.

- The page's own entry: `field('title')` and so on, with no owner.
- A referenced entry (the article's author, featured coffee and the related
  article cards): `field('name', { entry: author.id })`.
- Site content: the footer uses `field('email', { global: 'companyInfo' })`. The
  header shows no company field.
- SEO blocks use `$seo.*` keys, for example `$seo.summary`.

Keys match `areca.config.ts`. A new visible field needs a marker too.

## Site content (globals)

`areca.config.ts` defines three site content sections under `globals`:
`companyInfo` (name, tagline, contact, founding year), `homePage` (hero copy and
a featured coffee reference, with SEO) and `aboutPage` (heading, rich-text body,
image and the Numbers stats, with SEO). `areca pull` writes them to
`_globals.json`, and `areca.gen.ts` exports `globalSchema` and the `CompanyInfoGlobal`,
`HomePageGlobal` and `AboutPageGlobal` types.

`content.globals.<key>` is a synchronous read of the published values:

- `src/routes/__root.tsx` loads `companyInfo` for the site-wide head defaults
  and the footer (`site-chrome.tsx`).
- `src/routes/index.tsx` renders the hero from `homePage` and uses its
  `$seo` for the page head. `src/routes/about.tsx` renders `aboutPage` the same way.
- `SITE_NAME` and `SITE_DESCRIPTION` in `src/lib/seo.ts` stay as fallbacks and
  for the title suffix on pages that do not read a section.

Each section's `previewPath` (`/` and `/about`) is where the CMS opens a draft of
that section. The pages accept `?arecaPreview=<token>`, and
`content.previewGlobals(token)` overlays the draft when the token is for that
page's section. When that draft is incomplete, the published values stay and the banner says so. Other tokens, invalid tokens and missing tokens serve the
published values. Any request with a token gets `noindex, nofollow` (header and
meta) and `Cache-Control: no-store`. The draft banner appears only when the
draft is shown.

## Languages

The site is English (main language, no prefix) and Dutch (`/nl/...`). The
language setup lives in four places that must agree:

- `areca.config.ts`: `languages` (main and the list of languages),
  `i18n.paraglide` (the runtime `areca pull` wires into `content`), the
  per-language collection `routes` (Dutch journal pages are `/nl/journaal/<slug>`)
  and `translatable: false` on shared fields such as prices, emails and names.
- `project.inlang/settings.json` and `messages/{en,nl}.json`: Paraglide's
  languages and UI strings. `pnpm run paraglide` compiles them to `src/paraglide`
  (the build, tests, typecheck and fixtures run it first).
- `src/lib/locale-routes.ts`: the translated first path segment of each page
  family (`journal` is `journaal` in Dutch). `src/router.tsx` applies it, so
  `<Link to="/journal/$slug">` renders `/nl/journaal/<slug>` in Dutch.
- `areca.gen.ts` (committed): the `Locale` union and the Paraglide import. It
  is regenerated by `areca pull` or `content:fixture`.

Content translations come from the CMS, and the build pulls them. Entries
without a Dutch translation show the English version under `/nl`, flagged
`isFallback`. After a deploy that adds languages, do this in the CMS:

1. Run `pnpm --filter @areca/demo-site sync-manifest` once, so the CMS gets the
   languages, the Dutch routes and the translatable flags from
   `areca.config.ts`. (Requires the schema token.)
2. For each journal entry, coffee, and the home, about and company info
   sections, switch to Nederlands in the language bar, fill in the translatable
   fields (title, excerpt and body for journal entries; the Dutch slug for
   journal entries) and mark the entry ready. Dutch is optional here: a
   translation ships only when all its required translatable fields are filled
   in; until then visitors get the English version.
3. Publish, then rebuild the site so `areca pull` picks up the new publication.

The `hreflang` links and the language switcher come from the entry's
`alternates` (detail pages) or the same path in each language (other pages).
Hreflang hrefs are absolute when the page has an SEO block with a canonical
URL, and relative otherwise.

## Local fixture mode

To run without a CMS, write the checked-in demo fixture content:

```bash
pnpm --filter @areca/demo-site content:fixture
pnpm --filter @areca/demo-site dev
```

When `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` are set, the `prebuild` script
always pulls from the CMS and fails if that pull fails; it does not silently
use fixtures. Without those credentials, build can reuse generated content if
present. If it is absent, build explains how to pull or generate fixture
content.

## Build and run

```bash
pnpm --filter @areca/demo-site build
pnpm --filter @areca/demo-site start
```

The build runs `prebuild`, which pulls a fresh snapshot when both CMS settings
are present. The production server runs on port `3000` by default. Other useful
commands:

| Command | Purpose |
| --- | --- |
| `pnpm --filter @areca/demo-site typecheck` | Check TypeScript. |
| `pnpm --filter @areca/demo-site test` | Run demo-site unit tests. |
| `pnpm --filter @areca/demo-site verify:prerender` | Confirm generated article HTML exists. |
| `pnpm --filter @areca/demo-site content:pull` | Pull published CMS content. |
| `pnpm --filter @areca/demo-site content:fixture` | Write local fixture content (articles, coffees, team and site content). |

## Docker

Build from the repository root because the image needs the workspace lockfile. The image installs the published `@areca-cms/site-sdk` package from npm.
Pass the CMS URL as a build argument and the site token as a BuildKit secret:

```bash
DOCKER_BUILDKIT=1 docker build \
  -f examples/demo-site/Dockerfile \
  --build-arg ARECA_CMS_URL=https://cms.example.com \
  --secret id=ARECA_SITE_TOKEN,env=ARECA_SITE_TOKEN \
  .
```

Set `ARECA_SITE_TOKEN` in the shell or CI secret store before running the
command. The Dockerfile mounts it only during the content-pull/build step. A
successful Docker build needs a live published snapshot. `ARECA_SCHEMA_TOKEN`
is not needed to build the website.

The container copies the generated snapshot and server output into a Node 24
runtime image. At runtime, the site serves the built snapshot; it does not
fetch content from the CMS for visitor requests.

## Learn more

- [SDK setup and examples](../../packages/site-sdk/README.md)
- [Content schema guide](https://docs.arecacms.com/docs/sdk/defining-content)
- [Site API contract](https://docs.arecacms.com/docs/sdk/http-api)
