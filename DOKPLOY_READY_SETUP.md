# From empty Dokploy to “type in CMS → site rebuilds”

Dokploy runs **everything**: Postgres, S3, mail, the CMS, and the customer site. Your laptop is only used to push git, create the first admin, and register the site app.

```text
Dokploy host
─────────────────────────────────────────
:3000  Dokploy UI
:3100  CMS  ──Publish site──►  site build
:3101  demo site (areca pull → CMS :3100)
:9000  RustFS (S3)
:1025  Mailpit SMTP  (:8025 UI)
Postgres (internal)
```

Replace `HOST` with the Dokploy machine’s LAN IP or DNS, e.g. `192.168.0.141`. Do **not** use `localhost` inside env vars — containers cannot see each other’s `localhost`.

| Public URL | What |
| --- | --- |
| `http://HOST:3000` | Dokploy |
| `http://HOST:3100` | CMS |
| `http://HOST:3101` | Live site |

---

## 0. Before you start

- Empty Dokploy is installed and open at `http://HOST:3000`
- This monorepo is **pushed** to GitHub (private is fine)
- Node + pnpm on your laptop (only for `dokploy:setup` and `sync-manifest`)

---

## 1. Project, API token, SSH key

1. In Dokploy, create a **project** (e.g. `areca`). Open its **production** environment.
2. Copy the **environment id** from the URL (`…/environment/<this>/…`).
3. Create an **API token** (Settings → API). Copy it once.
4. On your laptop:

```powershell
ssh-keygen -t ed25519 -N "" -f areca_deploy -C areca-dokploy
```

5. In Dokploy, create an **SSH key**: paste the private key (`areca_deploy`) and the public key (`areca_deploy.pub`). Copy the **SSH key id**.
6. GitHub → repo → Settings → Deploy keys → add `areca_deploy.pub` (read-only).
7. Delete the local key files.

---

## 2. Postgres, S3, mail

Create these **in the same Dokploy project**.

### Postgres

Dokploy → **Databases** → PostgreSQL. Name it `areca`. Copy the connection URL (the one other apps on this Dokploy can reach — usually the internal hostname, not `localhost`).

### RustFS (S3)

New application from **Docker image** `rustfs/rustfs:latest`.

- Command: `/data`
- Env: `RUSTFS_ACCESS_KEY=areca`, `RUSTFS_SECRET_KEY=areca-secret`
- Ports: **9000 → 9000** and **9001 → 9001** (`publishMode: host`)
- Persist `/data` on a volume

S3 API: `http://HOST:9000`. Console: `http://HOST:9001`.

### Mailpit

New application from **Docker image** `axllent/mailpit`.

- Ports: **1025 → 1025** (SMTP) and **8025 → 8025** (UI)

---

## 3. CMS application

New **application** from Git (same SSH key + `git@github.com:…` URL).

| Setting | Value |
| --- | --- |
| Build type | Dockerfile |
| Dockerfile | `apps/cms/Dockerfile` |
| Docker context | `.` |
| Auto deploy | **on** (git push updates the CMS) |
| Port | **3100 → 3000**, `publishMode: host` |
| Swarm update | `stop-first` |

Environment (runtime, not build args):

```
PORT=3000
HOST=0.0.0.0
DATABASE_URL=<postgres url from step 2>
BETTER_AUTH_SECRET=<long random string>
BETTER_AUTH_URL=http://HOST:3100
APP_URL=http://HOST:3100
S3_ENDPOINT=http://HOST:9000
S3_REGION=us-east-1
S3_BUCKET=areca
S3_ACCESS_KEY=areca
S3_SECRET_KEY=areca-secret
S3_FORCE_PATH_STYLE=true
SMTP_HOST=HOST
SMTP_PORT=1025
SMTP_FROM=cms@areca.local
DOKPLOY_URL=http://HOST:3000
DOKPLOY_API_KEY=<token from step 1>
WORKER_ENABLED=true
```

Deploy it. On boot the image runs migrations and creates the S3 bucket. Confirm `http://HOST:3100/api/health` returns `{"ok":true,"service":"cms"}`.

Open `http://HOST:3100/setup`, create the first admin, then in the CMS:

1. Create an organization
2. Create a site (slug `acme-site` if you want the demo package as-is)
3. Copy the **site token** (shown once)
4. Set **Production URL** to `http://HOST:3101`

---

## 4. Register the customer site app

On your **laptop**, `apps/cms/.env.local` is only for this script (the running CMS already has its env on Dokploy):

```
DOKPLOY_URL=http://HOST:3000
DOKPLOY_API_KEY=<token from step 1>
DOKPLOY_ENVIRONMENT_ID=<from step 1>
GIT_URL=git@github.com:<you>/<repo>.git
GIT_BRANCH=<branch you pushed, often main>
SSH_KEY_ID=<from step 1>
SITE_TOKEN=<token from step 3>
CMS_URL=http://HOST:3100
APP_NAME=acme-demo-site
PUBLISHED_PORT=3101
```

Other keys from `.env.example` can stay as dummies; the script does not use them.

```powershell
pnpm --filter @areca/cms dokploy:setup
```

Copy `applicationId`. Health URL: `http://HOST:3101/api/health`.

Leave **auto-deploy off** on this app. **Publish site** is the trigger, not git push.

Push the demo schema into the CMS:

```powershell
cp examples/demo-site/.env.example examples/demo-site/.env.local
```

```
ARECA_CMS_URL=http://HOST:3100
ARECA_SITE_TOKEN=<token from step 3>
```

```powershell
pnpm --filter @areca/demo-site sync-manifest
```

---

## 5. Couple the site to Dokploy

CMS → the site → **Settings** → **Deployment target**:

- Application ID → from step 4
- Health check URL → `http://HOST:3101/api/health`
- **Save target**

Without this, **Publish site** marks content live and does **not** rebuild the site.

---

## 6. The loop

1. Open `http://HOST:3100` → **Articles** → **New**.
2. Title, excerpt, body → **Save draft** → **Publish** → **Publish now**.
3. **Publish site** on the site dashboard.
4. Wait until **Releases** shows **live** (clone + Docker build).
5. Open `http://HOST:3101/blog`.

Path: CMS snapshot → worker → Dokploy `application.deploy` → image build runs `areca pull` against `http://HOST:3100` → health check → live.

---

## If it fails

| What you see | Fix |
| --- | --- |
| Job succeeds instantly, site unchanged | CMS `DOKPLOY_API_KEY` is empty → deploys are mocked. Set it and redeploy the CMS. |
| CMS crash loop on boot | Postgres URL / RustFS URL wrong. From the CMS container those hosts are **HOST**, not `localhost`. |
| Login / cookies broken | `BETTER_AUTH_URL` and `APP_URL` must be exactly `http://HOST:3100`. |
| `areca pull` timeout / 401 | Site build args `ARECA_CMS_URL` / `ARECA_SITE_TOKEN` must match the live CMS. Re-run `dokploy:setup` after rotating the token. |
| Clone / SSH errors | Git URL is `git@github.com:…`, deploy key is on that repo. |
| Images 404 on the site | `APP_URL` must be `http://HOST:3100`, then **Publish site** again so snapshot URLs update. |
