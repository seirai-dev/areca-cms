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

`src/lib/content.ts` reads `articles`, `coffees` and `authors` from
`src/generated/content` with `readContent()`, types the records, sorts them,
and resolves references by id. The TanStack server functions in
`src/lib/queries.ts` expose the content to route loaders. Routes: `/coffees`
and `/coffees/$slug`, `/journal` and `/journal/$slug`, `/team` and
`/team/$slug`, and `/about`. Rich text is rendered from the SDK's TanStack
Markdown document. Update the route and UI types if you change the collection
fields.

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
| `pnpm --filter @areca/demo-site content:fixture` | Write local fixture content. |

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
- [Content schema guide](../../docs/CONTENT_SCHEMA.md)
- [Site API contract](../../docs/API.md)
