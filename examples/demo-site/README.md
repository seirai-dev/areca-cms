# Acme (`@areca/demo-site`)

A TanStack Start customer site that consumes Areca at **build time**. Editors publish in the CMS; this package pulls the pinned snapshot, prerenders `/`, `/blog`, and every `/blog/<slug>`, and serves draft preview + health dynamically.

## Content

`areca.config.ts` declares the `acme-site` articles collection (same schema the CMS seed creates).

```bash
# Production / Dokploy (requires env):
pnpm content:pull
# → areca pull --out src/generated/content

# Push the schema to the CMS:
pnpm sync-manifest

# Local / CI without a live publication:
pnpm content:fixture
```

`src/generated/content/` is gitignored. The fixture writes `manifest.json` + `articles.json` (3 articles with `{ json, html, markdown }` rich text) so `dev` and `build` work without the CMS.

`prebuild` runs `areca pull --out src/generated/content` when `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` are set. Otherwise it keeps an existing fixture.

## Environment

See `.env.example`:

- `ARECA_CMS_URL` — CMS base URL
- `ARECA_SITE_TOKEN` — site token (`Authorization: Bearer`)

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Vite dev server on port 3001 |
| `pnpm build` | Prebuild (pull or fixture) + Vite/Nitro build with prerender |
| `pnpm start` | `node .output/server/index.mjs` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest |
| `pnpm verify:prerender` | Assert `.output/public/blog/<slug>/index.html` exists for every fixture slug |
| `pnpm content:fixture` | Write the local snapshot fixture |
| `pnpm content:pull` | `areca pull --out src/generated/content` |
| `pnpm sync-manifest` | Sync `areca.config.ts` to the CMS |

## Preview

Drafts open at `/__preview/$collection/$slug?token=`. The loader calls `getPreviewEntry({ token })` on the server (opaque token, `ARECA_CMS_URL`). The page sends `previewHeaders()` (`X-Robots-Tag: noindex, nofollow`) and a robots meta tag. 401/404 render an error message instead of the article.

## Docker

Build context is the **repo root**:

```bash
docker build -f examples/demo-site/Dockerfile --build-arg ARECA_CMS_URL=http://host.docker.internal:3000 --build-arg ARECA_SITE_TOKEN=x .
```

Install + `@areca/site-sdk` build run first. `areca pull` then fails if the CMS has no publication — that error is expected.
