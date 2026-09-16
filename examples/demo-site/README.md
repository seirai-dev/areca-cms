# Acme (`@areca/demo-site`)

A TanStack Start customer site that consumes Areca at **build time**. Editors publish in the CMS; this package pulls the pinned snapshot, prerenders `/`, `/blog`, and every `/blog/<slug>`, and serves draft preview + health dynamically.

## Content

`areca.config.ts` declares the `acme-site` articles collection (same schema the CMS seed creates).

```bash
# After the CMS has a live publication (loads `.env.local` automatically):
pnpm content:pull
# → areca pull --out src/generated/content

# Push the schema to the CMS:
pnpm sync-manifest

# No CMS fallback only — never used when ARECA_* env vars are set:
pnpm content:fixture
```

`src/generated/content/` is gitignored. Copy `.env.example` to `.env.local` and paste the site token. Scripts load `.env.local` via Node `--env-file-if-exists`.

`prebuild` runs `areca pull` when `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` are set, and **fails loudly** if the pull fails (it does not fall back to the fixture). The fixture is only for local/CI work without a CMS.

## Environment

See `.env.example` (copy to gitignored `.env.local`):

- `ARECA_CMS_URL` — CMS base URL (`http://localhost:3000` locally; LAN URL for Dokploy)
- `ARECA_SITE_TOKEN` — site token (`Authorization: Bearer`)

## Scripts

| Script                  | Purpose                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `pnpm dev`              | Vite dev server on port 3001                                                 |
| `pnpm build`            | Prebuild (pull or fixture) + Vite/Nitro build with prerender                 |
| `pnpm start`            | `node .output/server/index.mjs`                                              |
| `pnpm typecheck`        | `tsc --noEmit`                                                               |
| `pnpm test`             | Vitest                                                                       |
| `pnpm verify:prerender` | Assert `.output/public/blog/<slug>/index.html` exists for every fixture slug |
| `pnpm content:fixture`  | Write the local snapshot fixture                                             |
| `pnpm content:pull`     | `areca pull --out src/generated/content`                                     |
| `pnpm sync-manifest`    | Sync `areca.config.ts` to the CMS                                            |

## Preview

Drafts open at `/__preview/$collection/$slug?token=`. The loader calls `getPreviewEntry({ token })` on the server (opaque token, `ARECA_CMS_URL`). The page sends `previewHeaders()` (`X-Robots-Tag: noindex, nofollow`) and a robots meta tag. 401/404 render an error message instead of the article.

## Docker

Build context is the **repo root**:

```bash
ARECA_SITE_TOKEN=x docker build -f examples/demo-site/Dockerfile \
  --build-arg ARECA_CMS_URL=http://host.docker.internal:3000 \
  --secret id=ARECA_SITE_TOKEN,env=ARECA_SITE_TOKEN .
```

Install + `@areca-cms/site-sdk` build run first. `areca pull` then fails if the CMS has no publication — that error is expected.
