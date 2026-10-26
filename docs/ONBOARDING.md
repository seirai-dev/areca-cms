# First-run onboarding

This is the from-zero walkthrough: empty CMS → first agency admin → Agency workspace → client → site (token) → site settings → connect `examples/demo-site` → invite people → author articles → Mark as ready → Go live → pull content and preview locally.

Button labels, URLs, and commands below match the UI as of this guide. PowerShell-friendly: do not chain with `&&`; run commands separately (or join with `;`).

## Prerequisites

- **Docker Desktop** (Postgres, RustFS/S3, Mailpit)
- **Node 24** (`node -v` should start with `v24`)
- **pnpm** 12 (`corepack enable`, then `corepack prepare pnpm@12.8.1 --activate` if needed)
- This repo cloned locally

## 1. Infrastructure

From the repo root:

```powershell
docker compose up -d
pnpm install
cp apps/cms/.env.example apps/cms/.env.local
```

Now edit `apps/cms/.env.local` before running the CMS setup commands below.
Replace the example `BETTER_AUTH_SECRET` and set
`DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` to the output of `openssl rand -base64 32`.
Keep the encryption key safe and stable; the CMS configuration requires it
even before you connect Dokploy. `docker compose up` provides the local database,
Redis, RustFS and Mailpit services. The full variable reference is
[CMS configuration](CONFIGURATION.md).

`apps/cms/.env.local` is gitignored. For **local** sign-in links, images and
previews, set:

```
APP_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
```

Then create the local storage bucket and apply database migrations:

```powershell
pnpm --filter @areca/cms s3:init
pnpm db:migrate
```

For **Dokploy** builds later, `APP_URL` and `ARECA_CMS_URL` must be a LAN URL the Dokploy host can reach (see [Deploying with Dokploy](#deploying-with-dokploy)).

Expected: compose starts Postgres on `5432`, RustFS on `9000`, Mailpit SMTP on `1025` and UI on [http://localhost:8025](http://localhost:8025). `s3:init` prints `Created bucket: areca` or `Bucket already exists: areca`. `db:migrate` applies migrations without dropping them.

## 2. Start from an empty CMS

This step is optional. A new database already has no users or content, so skip
it on first run. `db:reset` is destructive: it truncates every CMS table and
empties the configured S3 prefix subtree, or the entire bucket when `S3_PREFIX`
is unset or exactly empty. Use it only when you intentionally want to erase the
local instance, and confirm `DATABASE_URL`, `S3_BUCKET` and `S3_PREFIX` select
throwaway local resources before running it. Never run it against a shared or
production instance.

```powershell
pnpm db:reset
```

This **does not** drop the schema. It `TRUNCATE`s every application table (`RESTART IDENTITY CASCADE`) and empties the entire configured upload subtree, including manually placed objects. With `S3_PREFIX` unset/empty, it empties the whole bucket. Neighboring prefixes are excluded. See [storage configuration](CONFIGURATION.md#storage-prefix). You should see a list of truncated tables and `Reset complete`.

`pnpm --filter @areca/cms db:seed` still works after a reset if you want the Acme demo users instead of this walkthrough.

## 3. Start the CMS

```powershell
pnpm --filter @areca/cms dev
```

Open [http://localhost:3000](http://localhost:3000). With an empty `user` table you are redirected to `/setup`.

If you already had a session cookie from a previous admin, sign out first or use a private window.

## 4. Super-admin at `/setup`

URL: [http://localhost:3000/setup](http://localhost:3000/setup)

Page title: **Welcome to Areca** — *Create the first admin account.* The form
asks for the first-run setup token. If you did not set `SETUP_TOKEN`, read the
generated token in the CMS terminal output; it is printed while the instance
has no users. Do not share it.

1. **Setup token** — paste the token from the CMS terminal, unless you configured `SETUP_TOKEN` yourself
2. **Name** — e.g. `Kaan Kaya`
3. **Email** — e.g. `admin@areca.local`
4. **Password** — at least 8 characters (the eye icon shows it)
5. Click **Create admin account**

Expected: you are signed in. The first agency admin is prompted to enroll in
two-factor authentication (TOTP); save the recovery codes somewhere safe. Then
you land in the **Agency workspace** (`/agency`). While the instance is empty the
**Get your agency ready** checklist lists five steps, each with a direct action:
*Create a client*, *Add a site*, *Connect the site project*, *Invite the client*,
*Go live*. It collapses to **All set** once they are done.

A second visit to `/setup` redirects to `/login` when you are signed out (“already set up”). If you still have a session you land in your workspace instead. `/login` and every signed-in page also redirect to `/setup` while the user table is empty.

### Finding your way around

- The **workspace card** at the top of the sidebar says where you are (*Agency*, or a site such as *Acme Website*). Click it to switch workspace: recent sites, all sites grouped by client, the Agency workspace and **New site…**.
- **Search** (⌘K / Ctrl K) opens the command palette: go to pages, create entries, Go live, Invite people, Upload, switch appearance or language, sign out.
- The **account row** at the bottom holds Appearance (Light · Dark · Auto), Language, **Keyboard shortcuts…** and **Sign out**.
- On phones the sidebar becomes a top bar plus a bottom tab bar (**Overview · Content · Library · More**).

## 4b. Whitelabel the CMS (optional)

Agency admins can rebrand the whole CMS at **Agency › Branding**. URL: [http://localhost:3000/agency/branding](http://localhost:3000/agency/branding)

- **Name** replaces "Areca" in the sidebar, browser tab, sign-in, setup, and invitation pages.
- **Logo** and **favicon** are uploaded to the S3 bucket under `branding/` and served through `/api/assets/file/…`.
- **Colour**: pick a preset or your own **accent**. The accent re-tints selection, focus rings, links, switches, progress and the "Ready" state in light and dark mode. Primary buttons stay ink (near-black / near-white); status colours stay green/orange/red.
- **Typography** picks from a curated font list (rendered in each font), or the system font.
- **Sender name** is the display name on invitation emails; the address still comes from `SMTP_FROM`.
- The live preview on the right shows the sidebar, a card and a button in light and dark side by side. Changes save from the floating **Save** pill.

Settings live in the single-row `branding` table. **Reset to defaults** clears everything and deletes the uploaded images.

## 4c. Sign-in methods (optional)

Every sign-in method is configured in `apps/cms/.env.local` (see `.env.example`); nothing is stored in the database and no code changes are needed. Restart the CMS after editing.

| Method | Enabled by | Callback URL to register with the provider |
| --- | --- | --- |
| Email + password | `AUTH_EMAIL_PASSWORD_ENABLED=true` (default) | — |
| GitHub | `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` | `<BETTER_AUTH_URL>/api/auth/callback/github` |
| Google | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | `<BETTER_AUTH_URL>/api/auth/callback/google` |
| Discord | `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` | `<BETTER_AUTH_URL>/api/auth/callback/discord` |
| Microsoft SSO (Entra ID) | `MICROSOFT_SSO_CLIENT_ID` + `MICROSOFT_SSO_CLIENT_SECRET` + `MICROSOFT_SSO_TENANT_ID` | `<BETTER_AUTH_URL>/api/auth/sso/callback/microsoft` |

A method that is off never appears on the sign-in or invitation page, and its endpoint is rejected server-side. `MICROSOFT_SSO_TENANT_ID` must be a real directory id: the multi-tenant `common` endpoint advertises a templated issuer that cannot be validated. Entra accounts need a mail address, because the connection reads the `email` claim.

Registration stays invite-only whichever method is used. A provider sign-in succeeds only when the email already has an account — the provider is then linked to it — or has a pending invitation; anyone else gets *This account is not allowed to sign in*. The one-time `/setup` bootstrap always accepts a password, even with `AUTH_EMAIL_PASSWORD_ENABLED=false`, so an instance can never be locked out; with password sign-in off, that first admin then signs in through a provider using the same address.

## 5. Create a client

A **client** is a company you build and run sites for (the database calls it an organization).

1. In the Agency sidebar open **Clients** (or click **New client** on the checklist). URL: [http://localhost:3000/agency/clients](http://localhost:3000/agency/clients)
2. Click **New client**
3. **Name**: `Acme` — the slug is suggested as `acme` (shown as a whisper; **Edit** to change it now, it can't be changed later)
4. Click **Create client**

Expected: toast **Client created** and you land on the client page `/agency/clients/<id>` with heading **Acme** and tabs **Sites · People · Deployment · Settings**.

## 6. Add a site and save its token (once)

On the client page, **Sites** tab:

1. Click **New site** — a two-step sheet opens
2. **Site name**: `Acme Website` — the site key (slug) becomes `acme-website`
3. **Production URL**: `http://localhost:3001` (the default; previews open on this address too)
4. Click **Create site**

Expected: toast **Site created**, then step 2, **Connect your site**: the site token with **Copy token**, and an **Environment** snippet (`ARECA_CMS_URL=…`, `ARECA_SITE_TOKEN=…`) with **Copy snippet**.

**Copy it now.** It is not shown again. Put it in `examples/demo-site/.env.local` (section 8), then click **I've saved it**. Rotating the token later (**Settings › Developer › Rotate token…**) invalidates the old one immediately (local `.env.local` and any Dokploy build args).

Each site card on the Sites tab has **Open** (into the site workspace) and **Settings**.

## 7. Site settings (agency admins)

Open the site (sidebar **All sites**, the workspace switcher, or **Open** on the card), then **Settings** in the sidebar (`/sites/<id>/settings`). Tabs:

- **General** — name and **Production URL** (where the live site is; Preview opens `<productionUrl>/__preview/<collection>/<slug>?token=`). **Delete site…** sits in the danger zone.
- **Deployment** — choose **Demo** for local work; its releases are labeled demo and do not count as production live. For **Production**, connect Dokploy and set its publication-aware health check URL before going live. Production publishing is blocked until a valid target is configured. **Stop deploying…** clears the target.
- **Developer** — the site key, read-only site token and separate schema-write token, **Rotate token…**, the **Site project** status (content types synced from the project's `areca.config`) and a **Quick start** snippet.
- **AI** — site-specific instructions for the optional agency-configured SEO assistant; see [SEO and AI](SEO.md).
- **Content** — the content types (collections): label, key, route, field count and an On/Off switch. **New content type** (or clicking a row) opens the schema editor; content types normally arrive from `sync-manifest` (section 8). Until there are any, the site Overview says *This site has no content types yet*.

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
ARECA_SCHEMA_TOKEN=<paste the separate schema-write token>
```

Copy the schema-write token from **Settings › Developer**. It is separate from
the site token: builds and content pulls use `ARECA_SITE_TOKEN`; only schema
publishing uses `ARECA_SCHEMA_TOKEN`. Keep the schema token in this local,
trusted authoring environment, never in a public build secret.

Scripts load `.env.local` automatically (`node --env-file-if-exists=.env.local`). From the repo root:

```powershell
pnpm --filter @areca-cms/site-sdk build
pnpm --filter @areca/demo-site sync-manifest
```

Build the workspace SDK first so its `dist/cli.js` exists for the demo site's
schema-push script.

Expected: the command exits 0. **Settings › Content** lists key `articles`, label **Articles**, route `/blog/$slug`, and **Settings › Developer** reports *1 content type synced from the site project*. The site sidebar's **CONTENT** section now shows **Articles**.

`pnpm content:fixture` is the **no-CMS fallback only**. `prebuild` / `content:pull` do **not** fall back to the fixture when `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` are set — a failed pull exits non-zero.

For Docker deployments, pass `ARECA_CMS_URL` as a build argument and `ARECA_SITE_TOKEN` as a BuildKit build secret. The adapter updates `ARECA_SNAPSHOT_ID` to invalidate the cached content-pull layer. See [deployment](DEPLOYMENT.md).

## 9. Invite the client's people

Owners and agency admins can invite. Either:

- In the site: **People** in the sidebar (`/sites/<id>/people`), or ⌘K → **Invite people**
- In the Agency workspace: **Clients › Acme › People**

Then:

1. Click **Invite people**
2. **Email addresses**: e.g. `owner@acme.local` (several addresses separated by commas are fine)
3. **They'll join as**: **Editor** — *Can write and edit drafts.* or **Owner** — *Can also make changes live and manage people.*
4. Click **Send invitation**

Expected: the address appears under **Invitations** (*Expires in 7 days*, **Revoke**). Everyone in a client can open all of that client's sites.

Open Mailpit at [http://localhost:8025](http://localhost:8025). The message subject is `Invitation to Acme`; its link opens `/invite/<token>`, headed **Acme invited you** with the role explained in plain words:

- Signed out: **Name** and **Password** (the email is locked to the invitation) → **Create account and join**. The invitation is accepted automatically; there is no second click. Provider buttons work too.
- Already signed in as that email: **Join Acme**.
- Expired or used: *This link no longer works* with a way back to sign-in.

Members are managed on the same People screen: the **Owner | Editor** switch per person (demoting yourself asks first; the last owner can't be demoted) and **⋯ › Remove from Acme…**. Agency admins manage agency access for everyone at **Agency › People**.

### What each role can do

| Role | Can do |
| --- | --- |
| **Agency admin** (`isAgencyAdmin`) | Everything: the Agency workspace (clients, sites, people, activity, branding), site **Settings** (general, deployment, developer, content types), plus everything an owner can do in every site |
| **Owner** | Everything in their client's sites: write drafts, **Mark as ready**, move back to draft, schedule, archive, delete, restore revisions, **Go live** and roll back, delete Library files; **People** (members and invitations) and **Activity** |
| **Editor** | Create entries, edit and save drafts, preview, upload and describe Library files. Editors **cannot** mark as ready, schedule, archive, delete, restore or go live — those controls stay visible but disabled, with the reason (*Only owners can publish…*). No People, Settings or Activity |

Agency admins are not client members by default; they still see every site.

## 10. Author articles

In the site workspace the sidebar's **CONTENT** section lists every content type with its entry count. Open **Articles** (`/sites/<id>/c/articles`), then **New article** (or `n`; the Overview's **Create** tiles and the sidebar **+** do the same).

The editor is a focus page: the sidebar tucks away, a slim top bar holds **← Articles**, the save status, **Preview**, **⋯** and the **Mark as ready** split button, and **▥** (⌘.) toggles the **Details** panel.

| Field | Where | Notes |
| --- | --- | --- |
| **Title \*** | Canvas, the big "Untitled" line | Typing it also fills the slug until you edit the slug |
| **Excerpt**, **Body \*** | Canvas | Rich text: a format bar appears while the body has focus (Paragraph/Heading 2–4/Quote/Code, Bold, Italic, Link, lists, **Insert** › Image · Table · Divider, undo/redo); `/` opens the slash menu |
| **Slug** | Details › Page | `lowercase-letters-numbers-and-hyphens` only; unique per collection; **Reset from title** while it is manual |
| **Hero image** | Details › Fields | **Choose** opens the Library picker (upload, search, drop anywhere); add a description (alt text) |
| **Published at**, **Category** | Details › Fields | Optional metadata; not the same as going live |

There is no Save-then-leave step: a draft **saves itself** 2 seconds after the last change (also on ⌘S, the quiet **Save** button, leaving the tab or navigating away). A new entry has no server row until the title produces a slug — the status reads *Not saved yet — add a title* — then it becomes `/c/articles/<id>` without losing your place.

Create three articles (give one a hero image). Example titles: `Welcome to Acme`, `Shipping the first release`, `How preview works`.

## 11. Draft → Ready → Live

One vocabulary everywhere (status pills, filters, the editor, the Go-live panel):

| Status | Meaning |
| --- | --- |
| **Draft** | Only in the CMS |
| **Ready** | Marked as ready, waiting for the next **Go live** |
| **Live** | In the live snapshot |
| **Scheduled** | Goes live by itself at the chosen time |
| **Archived** | Kept, but not on the site |

On an entry (owners and agency admins):

- **Mark as ready** — copies the draft to the published version (`publishEntryFn`). Visitors still do not see it until the site goes live.
- **▾ › Mark as ready & go live now** — both steps at once.
- **▾ › Schedule…** — quick chips (*Tomorrow 9:00*, *Monday 9:00*, *In 1 hour*), date, time and timezone → **Schedule**. The in-process worker publishes when due; **Cancel schedule** undoes it.
- **⋯** — **Move back to draft**, **Archive**, **Delete…**, copy link / ID, **Preview formatting**.
- **Details › History** — revisions grouped by author; **Restore** an earlier one.

Collections also support **Select** (Photos-style) for bulk **Mark as ready**, **Move to draft** and **Delete**.

## 12. Preview a draft

Click **Preview** (the eye icon; enabled once the entry is saved and has a slug).

Expected URL:

```
http://localhost:3001/__preview/articles/<slug>?token=<signed>
```

The demo-site process must be running (`pnpm --filter @areca/demo-site dev`) and its `.env.local` must have `ARECA_CMS_URL`. The page shows **PREVIEW - draft content** and must not be indexed (`X-Robots-Tag: noindex, nofollow`).

## 12b. Go live and releases

The **Go-live tray** at the bottom of the site sidebar always shows the publishing state: *Not live yet*, *3 changes ready* (with **Go live**), *Going live…* (Queued → Building → Checking → Deploying), *Up to date*, or *Last release failed* (**See what happened**). On phones it is the small pill in the top bar.

1. Mark each article as ready
2. Click **Go live** in the tray (or on the Overview's *changes ready* card)

Expected: in **Demo** mode, the tray shows that the demo publication completed; it is labeled Demo and is not a production live release. In **Production** mode, the tray shows *Going live…* while Dokploy builds and the CMS verifies the exact publication ID at the site's health URL. Production mode requires a deployment target before publishing.

Click the tray (or open `/sites/<id>?panel=golive`) for the **Go-live panel**:

- The status sentence and **What's changing** (the ready entries, each linking to its editor)
- **Urgent — skip the queue** and **Go live**; validation problems appear as a *Fix these first* checklist linked to the entries
- **Releases**, a timeline of every release: *Went live*, *Failed*, *Replaced*, *Waiting…*. **Details** shows the snapshot hash and build steps with **View log** (auto-refreshing) and **Cancel** for queued jobs; earlier live releases offer **Restore this version** (rollback). **Show older** pages back.

| Publication status | Shown as |
| --- | --- |
| `pending` / `building` | Waiting… / Going live |
| `live` | Went live (current production release) |
| `demo` | Demo publication; no production deployment |
| `failed` | Failed — the previous live release stays |
| `superseded` | Replaced by a newer release |
| `rolled_back` | An earlier release was restored |

Owners and admins can open **Activity** (the Overview's **See all activity**, ⌘K → **Open activity**, **More** on phones, or `?panel=activity`) for the site's audit trail; agency admins see everything at **Agency › Activity** (`/agency/activity?client=` filters by client).

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

If the image host is a LAN IP, `APP_URL` in `apps/cms/.env.local` is not `http://localhost:3000` — fix it and **Go live** again so the snapshot URLs update, then re-pull.

`pnpm dev` on the demo site serves the **pulled** files (not the fixture) after a successful pull.

## 14. How a site consumes content (short)

`areca.config.ts` calls `defineSiteContent`. At build / pull time `areca pull` calls `GET /api/sites/snapshot/current` with `Authorization: Bearer <token>` and writes JSON under `src/generated/content`.

```ts
import { readContent } from '@areca-cms/site-sdk/pull'
import { richTextDocument } from '@areca-cms/site-sdk'
import { Markdown } from '@tanstack/markdown/react'

const articles = readContent('src/generated/content', 'articles')
// article.data.body → <Markdown components={yourComponents}>{richTextDocument(body)}</Markdown>
// (TanStack Markdown AST; richTextHtml(body) is the static fallback)
// article.data.heroImage.url → CMS /api/assets/file/...
```

Preview is a live fetch: `getPreviewEntry({ token })` → `GET /api/sites/preview?token=`. Normal content pages use the pulled snapshot. Build pulls and draft previews contact the CMS; visitors also contact its asset endpoint when pages use CMS-hosted images.

See [`packages/site-sdk/README.md`](../packages/site-sdk/README.md).

## Deploying with Dokploy

After you are happy locally, follow [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).

Important after a **db:reset**:

1. Create the site again and copy the **new** token
2. Update Dokploy runtime environment as needed, the `ARECA_CMS_URL` build argument, and the `ARECA_SITE_TOKEN` build secret — `pnpm --filter @areca/cms dokploy:setup` or edit the app in the Dokploy UI
3. `APP_URL` (CMS) and `ARECA_CMS_URL` (site build) must be **LAN-reachable** from the Dokploy host, not `localhost`
4. Listen on all interfaces: `pnpm --filter @areca/cms dev:lan`
5. Set a deployment target on the site (application id + health check URL) (**Settings › Deployment**) so **Go live** actually deploys

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `areca pull` 404 / `No publication exists` | Mark at least one entry as ready, then **Go live**, wait until the tray says **Up to date**, pull again |
| `areca pull` 401 | Wrong or rotated token. Copy the current token into `.env.local` (and the Dokploy build secret) |
| Images 404 or wrong host | `APP_URL` must be `http://localhost:3000` for local; **Go live** again so snapshot URLs refresh |
| `/setup` says already set up / redirects to `/login` | A user already exists. Sign in at `/login`; only use the optional destructive reset above when intentionally erasing a throwaway local instance |
| Worker not running / publication stuck `pending` | `WORKER_ENABLED` must not be `false` in `apps/cms/.env.local`. Restart `pnpm --filter @areca/cms dev`. Logs should include `[areca] publishing worker started` |
| Invite mail missing | Mailpit at http://localhost:8025. Check `SMTP_HOST=localhost` and `SMTP_PORT=1025` |
| `pnpm sync-manifest` fails | CMS on :3000, `ARECA_CMS_URL`, `ARECA_SITE_TOKEN`, and `ARECA_SCHEMA_TOKEN` in `.env.local`; use the schema-write token, not the read-only site token |
| `prebuild` failed after setting env | Intended: it will not use the fixture when env vars are set. Fix CMS/token/publication, or unset the vars and run `pnpm content:fixture` only for no-CMS work |
