# First-run onboarding

This is the from-zero walkthrough: empty CMS → first agency admin → organization + site → connect `examples/demo-site` → author articles → publish → pull content and preview locally.

Button labels, URLs, and commands below match the UI as of this guide. PowerShell-friendly: do not chain with `&&`; run commands separately (or join with `;`).

## Prerequisites

- **Docker Desktop** (Postgres, RustFS/S3, Mailpit)
- **Node 24** (`node -v` should start with `v24`)
- **pnpm** 11 (`corepack enable`, then `corepack prepare pnpm@11.18.0 --activate` if needed)
- This repo cloned locally

## 1. Infrastructure

From the repo root:

```powershell
docker compose up -d
pnpm install
cp apps/cms/.env.example apps/cms/.env.local
pnpm --filter @areca/cms s3:init
pnpm db:migrate
```

`apps/cms/.env.local` is gitignored. For **local** images and preview links, set:

```
APP_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
```

For **Dokploy** builds later, `APP_URL` and `ARECA_CMS_URL` must be a LAN URL the Dokploy host can reach (see [Deploying with Dokploy](#deploying-with-dokploy)).

Expected: compose starts Postgres on `5432`, RustFS on `9000`, Mailpit SMTP on `1025` and UI on [http://localhost:8025](http://localhost:8025). `s3:init` prints `Created bucket: areca` or `Bucket already exists: areca`. `db:migrate` applies migrations without dropping them.

## 2. Start from an empty CMS

```powershell
pnpm db:reset
```

This **does not** drop the schema. It `TRUNCATE`s every application table (`RESTART IDENTITY CASCADE`) and empties the S3 bucket. You should see a list of truncated tables and `Reset complete`.

`pnpm --filter @areca/cms db:seed` still works after a reset if you want the Acme demo users instead of this walkthrough.

## 3. Start the CMS

```powershell
pnpm --filter @areca/cms dev
```

Open [http://localhost:3000](http://localhost:3000). With an empty `user` table you are redirected to `/setup`.

If you already had a session cookie from a previous admin, sign out first or use a private window.

## 4. Super-admin at `/setup`

URL: [http://localhost:3000/setup](http://localhost:3000/setup)

Page title: **Set up Areca**.

1. **Name** — e.g. `Agency Admin`
2. **Email** — e.g. `admin@areca.local`
3. **Password** — at least 8 characters (e.g. `password123`)
4. Click **Create admin account**

Expected: you are signed in and land on `/` (Dashboard). With zero organizations the **Get started** card lists the remaining steps.

A second visit to `/setup` redirects to `/login` (“already set up”). `/login` and every signed-in page also redirect to `/setup` while the user table is empty.

## 5. Create an organization

1. Open **Organizations** in the sidebar Agency section, or click **Create an organization** on the Get started card. URL: [http://localhost:3000/admin/organizations](http://localhost:3000/admin/organizations)
2. Click **New organization**
3. **Name**: `Acme` — **Slug** fills as `acme`
4. Click **Create organization**

Expected: you land on `/admin/organizations/<id>` with heading **Acme**.

## 6. Invite an org owner or editor (optional)

On the organization page open the **Members** tab.

1. Click **Invite**
2. **Email**: e.g. `owner@acme.local`
3. **Role**: `owner` or `editor`
4. Click **Send invitation**

Expected: toast **Invitation sent**. The address appears under **Pending invitations**.

Open Mailpit at [http://localhost:8025](http://localhost:8025). The message subject is `Invitation to Acme`. The body has **Accept invitation** → `/invite/<token>`.

On the invite page:

- If you are not signed in: **Name**, read-only **Email**, **Password** (min 8) → **Create account**, then **Accept**
- If you are already signed in as that email: **Accept**

After accept you go to `/`.

### What each role can do

| Role | Can do |
| --- | --- |
| **Agency admin** (`isAgencyAdmin`) | Everything: orgs, sites, collections, tokens, users, all releases |
| **Owner** | Manage members/invitations of their org; edit + publish content; see Team / Activity |
| **Editor** | Edit + publish content only (no member management, no Agency sidebar) |

Agency admins are not org members by default; they still see every site.

## 7. Create a site and copy the token (once)

Still on the Acme org page, **Sites** tab:

1. Click **New site**
2. **Name**: `Acme Site` — **Slug** becomes `acme-site`
3. **Production URL**: `http://localhost:3001` (default for local demo; Preview opens this origin)
4. Click **Create site**

Expected: toast **Site created**. An alert **Store this site token** shows the hex token and a **Copy** button.

**Copy it now.** It is not shown again. Put it in `examples/demo-site/.env.local` as `ARECA_SITE_TOKEN`. Rotating the token in **Settings** invalidates the old one immediately (local `.env.local` and any Dokploy build args).

Open **Settings** on the site row (or `/sites/<id>/settings`):

- **Production URL** — live origin; Preview uses `<productionUrl>/__preview/<collection>/<slug>?token=`
- **Deployment target** — optional. Provider is Dokploy. Leave empty for local: **Publish site** marks the release **live** without deploying
- **Site token** — rotate only if leaked
- **Collections** — filled by `pnpm sync-manifest` (or **Add collection** by hand). Until then the site dashboard says there are no collections and points you at `pnpm sync-manifest`

## 8. Connect the demo site

`examples/demo-site` is a TanStack Start customer site. `areca.config.ts` declares the `articles` collection (title, slug, excerpt, body, hero image, published at, category).

A **manifest** is that schema, pushed to the CMS so editors get the right fields. The CMS owns the live schema after sync; the site file is the source you re-sync when fields change.

```powershell
cd examples/demo-site
copy .env.example .env.local
```

Edit `.env.local` (gitignored):

```
ARECA_CMS_URL=http://localhost:3000
ARECA_SITE_TOKEN=<paste the token>
```

Scripts load `.env.local` automatically (`node --env-file-if-exists=.env.local`). From the repo root:

```powershell
pnpm --filter @areca/demo-site sync-manifest
```

Expected: the command exits 0. On **Site settings → Collections** you see key `articles`, label **Articles**, route `/blog/$slug`.

`pnpm content:fixture` is the **no-CMS fallback only**. `prebuild` / `content:pull` do **not** fall back to the fixture when `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` are set — a failed pull exits non-zero.

The demo-site **Dockerfile is unchanged**: Dokploy still passes `ARECA_CMS_URL` / `ARECA_SITE_TOKEN` as build args.

## 9. Author articles

Open the site from the sidebar (or `/sites/<id>`). Click **Open** on **Articles**, then **New**.

| Field | Notes |
| --- | --- |
| **Title \*** | Text. Typing it also fills **Slug** until you edit the slug |
| **Slug \*** | `lowercase-letters-numbers-and-hyphens` only (`hello-world`). Unique per collection |
| **Excerpt** | Plain textarea |
| **Body \*** | Rich text. Toolbar: Heading 2/3/4, Bold, Italic, Link, Bullet list, Ordered list, Quote, Code block, Image (media library), Horizontal rule, Undo, Redo |
| **Hero image** | **Choose** → **Choose media** → **Upload** or pick an existing file |
| **Published at** | Datetime (optional metadata; not the same as clicking Publish) |
| **Category** | `news` or `updates` |

**Save draft** persists without going live. Status badge: `draft` / `published` / `scheduled` / `archived`.

Create three articles (give one a hero image via **Choose** → **Upload**). Example titles: `Welcome to Acme`, `Shipping the first release`, `How preview works`.

## 10. Draft vs publish vs schedule

On the entry:

- **Save draft** — writes `draftData` only
- **Publish → Publish now** — copies draft to published. Toast: **Published. Remember to Publish site to deploy.** Visitors still do not see it until you **Publish site** and the site pulls the snapshot
- **Publish → Schedule…** — picks a local datetime + timezone. The in-process worker publishes when due
- **Unpublish** / **Archive** / **Delete** — in the same **Publish** menu

A **draft** is CMS-only. **Preview** (next section) renders that draft on the customer site without publishing.

## 11. Preview a draft

1. Save a draft (or leave one unpublished)
2. Click **Preview** (enabled once the entry has a slug)

Expected URL:

```
http://localhost:3001/__preview/articles/<slug>?token=<signed>
```

The demo-site process must be running (`pnpm --filter @areca/demo-site dev`) and `.env.local` must have `ARECA_CMS_URL`. The page shows **PREVIEW - draft content** and must not be indexed (`X-Robots-Tag: noindex, nofollow`).

If Preview is disabled, save once so a slug exists.

## 12. Publish site and Releases

On the site dashboard (`/sites/<id>`), the bar has **Publish site** (optional **Urgent** checkbox).

1. Publish each article first (**Publish now**)
2. Click **Publish site**

Expected: toast **Publish requested**. With **no deployment target**, the worker log is `no deployment target configured, marking live without deploy`. The bar shows **Live publication …**.

Open **Releases** (`/sites/<id>/releases`):

| Publication status | Meaning |
| --- | --- |
| `pending` / `building` | Snapshot created, job running |
| `live` | Current snapshot sites should pull |
| `failed` | Job failed; previous live (if any) stays |
| `superseded` | Replaced by a newer live publication |
| `rolled_back` | An older `wasLive` snapshot was re-enqueued |

Each **Build job** has **Logs**. **Rollback** is offered on publications that `wasLive` and are not currently `live`.

## 13. Pull content and run the demo site

```powershell
pnpm --filter @areca/demo-site content:pull
pnpm --filter @areca/demo-site dev
```

`content:pull` writes `examples/demo-site/src/generated/content/` (`manifest.json` + `articles.json`). That folder is gitignored.

Open [http://localhost:3001/blog](http://localhost:3001/blog). You should see the three articles. An article page (`/blog/<slug>`) renders title, excerpt, body HTML, and the hero image from the CMS:

```
http://localhost:3000/api/assets/file/<storageKey>
```

If the image host is a LAN IP, `APP_URL` in `apps/cms/.env.local` is not `http://localhost:3000` — fix it and **Publish site** again so the snapshot URLs update, then re-pull.

`pnpm dev` on the demo site serves the **pulled** files (not the fixture) after a successful pull.

## 14. How a site consumes content (short)

`areca.config.ts` calls `defineSiteContent`. At build / pull time `areca pull` calls `GET /api/sites/snapshot/current` with `Authorization: Bearer <token>` and writes JSON under `src/generated/content`.

```ts
import { readContent, richTextHtml } from '@areca/site-sdk'

const articles = readContent('src/generated/content', 'articles')
// article.data.body → richTextHtml(...)
// article.data.heroImage.url → CMS /api/assets/file/...
```

Preview is a live fetch: `getPreviewEntry({ token })` → `GET /api/sites/preview?token=`. Visitors never call the CMS; only the build and the preview route do.

See [`packages/site-sdk/README.md`](../packages/site-sdk/README.md).

## Deploying with Dokploy

After you are happy locally, follow [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).

Important after a **db:reset**:

1. Create the site again and copy the **new** token
2. Update Dokploy `env` + `buildArgs` (`ARECA_SITE_TOKEN`, `ARECA_CMS_URL`) — `pnpm --filter @areca/cms dokploy:setup` or edit the app in the Dokploy UI
3. `APP_URL` (CMS) and `ARECA_CMS_URL` (site build) must be **LAN-reachable** from the Dokploy host, not `localhost`
4. Listen on all interfaces: `pnpm --filter @areca/cms dev:lan`
5. Set a deployment target on the site (application id + health check URL) so **Publish site** actually deploys

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `areca pull` 404 / `No publication exists` | Publish at least one entry, then **Publish site**, wait until status is **live**, pull again |
| `areca pull` 401 | Wrong or rotated token. Copy the current token into `.env.local` (and Dokploy build args) |
| Images 404 or wrong host | `APP_URL` must be `http://localhost:3000` for local; republish the site so snapshot URLs refresh |
| `/setup` says already set up / redirects to `/login` | A user already exists. `pnpm db:reset` to start empty, or sign in at `/login` |
| Worker not running / publication stuck `pending` | `WORKER_ENABLED` must not be `false` in `apps/cms/.env.local`. Restart `pnpm --filter @areca/cms dev`. Logs should include `[areca] publishing worker started` |
| Invite mail missing | Mailpit at http://localhost:8025. Check `SMTP_HOST=localhost` and `SMTP_PORT=1025` |
| `pnpm sync-manifest` cannot connect | CMS on :3000, `ARECA_CMS_URL` in `.env.local`, token matches |
| `prebuild` failed after setting env | Intended: it will not use the fixture when env vars are set. Fix CMS/token/publication, or unset the vars and run `pnpm content:fixture` only for no-CMS work |
