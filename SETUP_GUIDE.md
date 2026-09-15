# Areca setup guide

Areca is a **build-time CMS**. Editors write in the CMS. **Publish site** freezes a snapshot. The example site **pulls** that snapshot into files, then serves or rebuilds from those files. Visitors never call the CMS.

```text
edit in CMS  →  Publish article  →  Publish site (snapshot goes live)
                                              ↓
                         example site pulls snapshot  →  refresh or rebuild
```

Two different “pushes/pulls”:

| Command | Direction | What it moves |
| --- | --- | --- |
| `pnpm --filter @areca/demo-site sync-manifest` | site → CMS | **Schema** (fields, routes). Run when `areca.config.ts` changes. |
| `pnpm --filter @areca/demo-site content:pull` | CMS → site | **Content** (articles). Run after a live publication. |

Content is not committed to git (`src/generated/content/` is gitignored).

## Prerequisites

- Docker Desktop running
- Node 24 (`node -v` should start with `v24`)
- pnpm (`corepack enable`, then `corepack prepare pnpm@11.18.0 --activate` if needed)

All commands below are from the **repo root**. Run them one at a time.

## 1. Start databases and mail

```powershell
docker compose up -d
```

This starts:

- Postgres `localhost:5432`
- RustFS / S3 `localhost:9000`
- Mailpit UI [http://localhost:8025](http://localhost:8025) (SMTP `1025`)

Leave it running.

## 2. Install and prepare the CMS

```powershell
pnpm install
cp apps/cms/.env.example apps/cms/.env.local
pnpm --filter @areca/cms s3:init
pnpm db:migrate
pnpm --filter @areca/cms db:seed
```

Keep `APP_URL` and `BETTER_AUTH_URL` as `http://localhost:3000` in `apps/cms/.env.local`.

Seed prints a **site token once**. Copy it. You will not see it again (rotate later in CMS **Settings** if you lose it).

Logins (password `password123`):

- `admin@areca.local` — agency admin
- `owner@acme.local` — org owner
- `editor@acme.local` — editor

## 3. Start the CMS

```powershell
pnpm --filter @areca/cms dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in.

Leave this terminal running. Logs should include `publishing worker started`.

## 4. Connect the example site

```powershell
cp examples/demo-site/.env.example examples/demo-site/.env.local
```

Edit `examples/demo-site/.env.local`:

```
ARECA_CMS_URL=http://localhost:3000
ARECA_SITE_TOKEN=<paste the token from seed>
```

Push the site schema into the CMS:

```powershell
pnpm --filter @areca/demo-site sync-manifest
```

In the CMS: open **acme-site** → **Settings** → **Collections**. You should see `articles` / Articles / `/blog/$slug`.

## 5. Write and publish articles

1. Open **acme-site** in the sidebar.
2. **Open** on **Articles** → **New**.
3. Fill **Title** (slug auto-fills), **Excerpt**, **Body** (required). Optional: hero image, category, published at.
4. **Save draft**.
5. **Publish** → **Publish now**. Toast: *Published. Remember to Publish site to deploy.*  
   The public site still does **not** have this until the next step.
6. Repeat for a couple of articles.
7. Back on the site dashboard, click **Publish site**.

With no Dokploy target (local default), the worker marks the snapshot **live** immediately. The bar should show **Live publication**. Check **Releases** if you want the history.

A **draft** is CMS-only. **Preview** opens `http://localhost:3001/__preview/articles/<slug>?token=…` against the running demo site. That live-fetches the draft; it is not the published snapshot.

## 6. Pull content and run the example site

```powershell
pnpm --filter @areca/demo-site content:pull
pnpm --filter @areca/demo-site dev
```

- Pull writes `examples/demo-site/src/generated/content/` (`manifest.json` + `articles.json`).
- Dev server: [http://localhost:3001](http://localhost:3001)
- Blog: [http://localhost:3001/blog](http://localhost:3001/blog)
- Article: [http://localhost:3001/blog/<slug>](http://localhost:3001/blog)

Leave this terminal running too.

## 7. Everyday loop (this is the whole product)

After the first setup, this is all you do:

1. Edit the article in the CMS. **Save draft**.
2. **Publish** → **Publish now** on that article.
3. **Publish site** on the site dashboard. Wait until status is **live**.
4. Pull the new snapshot into the example site:

```powershell
pnpm --filter @areca/demo-site content:pull
```

5. Refresh [http://localhost:3001/blog](http://localhost:3001/blog). The running `dev` server reads the pulled JSON from disk, so you do **not** need to restart it.

Until you pull, the example site keeps showing the **previous** snapshot. That is intentional.

### Rebuild with the new content (production-like)

`build` runs `areca pull` first (because `.env.local` has the CMS URL and token), then prerenders `/`, `/blog`, and every `/blog/<slug>` into `examples/demo-site/.output`.

```powershell
pnpm --filter @areca/demo-site build
```

To serve that build (CMS already uses port 3000, `dev` uses 3001):

```powershell
# macOS / zsh
PORT=3002 pnpm --filter @areca/demo-site start

# PowerShell
$env:PORT = "3002"
pnpm --filter @areca/demo-site start
```

### If you change the article fields in code

Edit `examples/demo-site/areca.config.ts`, then:

```powershell
pnpm --filter @areca/demo-site sync-manifest
```

The CMS collection form updates. Existing articles keep their old data; fill any new required fields before the next **Publish site**.

## 8. Next time you sit down

```powershell
docker compose up -d
pnpm --filter @areca/cms dev
```

In a second terminal:

```powershell
pnpm --filter @areca/demo-site content:pull
pnpm --filter @areca/demo-site dev
```

You do **not** re-run migrate/seed unless you wiped the database.

Stop: `Ctrl+C` the two `dev` processes, then `docker compose stop`.

## 9. A new site in a separate repo

The demo above lives in this monorepo. A real customer site is its own project. The CMS does not care where the code lives. It only needs a **site record + token**, a **schema push**, and later a **content pull** at build time.

Do this once per site.

### On the CMS

1. Sign in as an agency admin.
2. Create an **organization** if you need one.
3. **New site**. Set **Production URL** to the origin of *this* site (`http://localhost:3001` locally, or the real URL). Preview links use that host: `/__preview/<collection>/<slug>?token=`.
4. **Copy the site token immediately.** Each site has its own token. Do not reuse the demo-site token.

The CMS must be reachable from the machine that will pull. Same laptop: `http://localhost:3000`. Another machine: a LAN/public URL, and `APP_URL` in `apps/cms/.env.local` must be that same URL so image links in the snapshot work.

### In the new project

`@areca/site-sdk` is not on npm yet. Copy `packages/site-sdk` into the new repo (or depend on it with `pnpm add <path-to>/packages/site-sdk`), then `pnpm install`. Fastest path: copy `examples/demo-site` and rename it.

1. Add `areca.config.ts` — this is the schema the CMS will show editors. `siteKey` should match the CMS site slug. Collections and `route`s must match pages you actually render.

```ts
import { defineSiteContent } from '@areca/site-sdk'

export default defineSiteContent({
  siteKey: 'my-site',
  collections: {
    articles: {
      route: '/blog/$slug',
      label: 'Articles',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'body', label: 'Body', type: 'richtext', required: true },
      ],
    },
  },
})
```

2. Gitignored `.env.local`:

```
ARECA_CMS_URL=http://localhost:3000
ARECA_SITE_TOKEN=<token from the new CMS site>
```

3. Scripts (TypeScript config needs `tsx`):

```json
{
  "scripts": {
    "sync-manifest": "node --env-file-if-exists=.env.local --import tsx ./node_modules/@areca/site-sdk/dist/cli.js sync-manifest ./areca.config.ts",
    "content:pull": "node --env-file-if-exists=.env.local ./node_modules/@areca/site-sdk/dist/cli.js pull --out src/generated/content",
    "prebuild": "node --env-file-if-exists=.env.local ./node_modules/@areca/site-sdk/dist/cli.js pull --out src/generated/content"
  }
}
```

Gitignore `src/generated/`. Content is pulled, not committed.

4. Push schema, then confirm collections in CMS **Settings**:

```powershell
pnpm sync-manifest
```

5. In the site, **read the pulled files**, never the CMS, on public pages:

```ts
import { readContent } from '@areca/site-sdk/pull'
import { richTextDocument } from '@areca/site-sdk'
import { Markdown } from '@tanstack/markdown/react'

const articles = readContent('src/generated/content', 'articles')
// article.data.body → <Markdown components={yourComponents}>{richTextDocument(body)}</Markdown>
// (TanStack Markdown AST; richTextHtml(body) is the static fallback)
```

Wire those entries to your routes (the demo uses `/blog` and `/blog/$slug`). Add a `/__preview/$collection/$slug` route if you want CMS **Preview** (it live-fetches a draft; needs `ARECA_CMS_URL` at runtime). Copy `examples/demo-site/src/routes/[__preview]/$collection/$slug.tsx` if you are on TanStack Start.

### Then the same loop as the demo

1. CMS: write entries → **Publish now** → **Publish site** → wait until **live**.
2. Site: `pnpm content:pull` (dev) or `pnpm build` (prebuild pulls, then prerenders).
3. Schema change: edit `areca.config.ts` → `pnpm sync-manifest` → fill new fields in the CMS → publish site → pull again.

Until the new site pulls (or rebuilds), it will not show the new snapshot. Git push of the site repo does not publish content.

## Useful URLs

| What | URL |
| --- | --- |
| CMS | http://localhost:3000 |
| Example site | http://localhost:3001 |
| Mailpit (invites) | http://localhost:8025 |

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `areca pull` 404 / `No publication exists` | Publish at least one article, then **Publish site**, wait until **live**, pull again |
| `areca pull` 401 | Wrong or rotated token. Each CMS site has its own token. Paste the current one into that project's `.env.local` |
| Example site still shows old copy | You published in the CMS but did not `content:pull` (or `build`) after the snapshot went **live** |
| Images 404 | `APP_URL` must be `http://localhost:3000`. **Publish site** again, then pull |
| `/setup` instead of login | Empty user table. Either finish setup or run `pnpm --filter @areca/cms db:seed` |
| Lost site token | Site **Settings** → **Rotate token**, update `.env.local` |
| Worker stuck `pending` | Restart CMS `dev`. Do not set `WORKER_ENABLED=false` |
| `docker compose` keychain error | Docker Desktop creds helper. Sign in to Docker Desktop, or pull images from a normal terminal first |
| `sync-manifest` / pull cannot reach CMS | Other machine must use a LAN/public `ARECA_CMS_URL`, not `localhost`. CMS `APP_URL` must be that same origin |

Dokploy (real deploys, not local): [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Empty-CMS first run (no seed): [`docs/ONBOARDING.md`](docs/ONBOARDING.md).
