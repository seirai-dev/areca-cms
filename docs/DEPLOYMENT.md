# Deploying a customer site to Dokploy

Areca publishes by snapshot: the CMS pins content, Dokploy builds the site from
git, `areca pull` fetches that snapshot **at build time**, then the CMS
health-checks the new container and marks the publication live.

This is the checklist used for the Acme demo (`examples/demo-site`) against
Dokploy v0.29.12. Register or update an application with:

For the full CMS environment variable reference, including local versus
production values, see [configuration](CONFIGURATION.md).

```
pnpm --filter @areca/cms dokploy:setup
```

The script is idempotent: it looks up an existing app by `APP_NAME` in
`DOKPLOY_ENVIRONMENT_ID` before creating. Load setup-script secrets from
`apps/cms/.env.local` (gitignored). Do not commit API keys. Runtime publishing
credentials are configured per CMS organization.

## Prerequisites

- Monorepo pushed to a git host Dokploy can clone (private GitHub is fine)
- Dokploy API reachable (`DOKPLOY_URL`, header `x-api-key`)
- CMS reachable from the Dokploy host at `CMS_URL` (LAN IP, not `localhost`)
- Site token (`SITE_TOKEN`) and a Dokploy SSH key id (`SSH_KEY_ID`)

Required env for `dokploy:setup`: `DOKPLOY_URL`, `DOKPLOY_API_KEY`,
`DOKPLOY_ENVIRONMENT_ID`, `GIT_URL`, `SSH_KEY_ID`, `SITE_TOKEN`, `CMS_URL`.
Optional: `APP_NAME` (default `acme-demo-site`), `GIT_BRANCH` (`master`),
`DOCKERFILE` (`examples/demo-site/Dockerfile`), `PUBLISHED_PORT` (`3101`),
`TARGET_PORT` (`3000`), `AUTO_DEPLOY` (`false`). Production/shared URLs must
use HTTPS. For local or LAN-only testing, set `DOKPLOY_ALLOW_INSECURE_HTTP=true`.

The running CMS requires `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY`, a stable
base64-encoded 32-byte key (generate one with `openssl rand -base64 32`). Keep
the same key across replicas and restores; losing it makes stored Dokploy API
keys unrecoverable. For local development only, the legacy global URL/key can
be enabled with `DOKPLOY_DEV_FALLBACK_ENABLED=true`.

## 1. Git repo + deploy key (one-time)

1. Push the monorepo to GitHub.
2. Generate an ed25519 keypair (`ssh-keygen -t ed25519 -N "" -f areca_deploy -C areca-dokploy`).
3. `POST /api/sshKey.create` with `name`, `publicKey`, `privateKey`, `organizationId`
   (from `GET /api/project.all` → `organizationId`). Then `GET /api/sshKey.all` for `sshKeyId`.
4. Add the **public** key as a read-only GitHub deploy key. Delete the local private key.

Auth is header `x-api-key` (not Bearer). Use an HTTPS Dokploy API URL outside
explicit local/LAN testing.
More request shapes: `apps/cms/src/adapters/deployment/dokploy-api-notes.md`.

## 2. Register the Dokploy application

`dokploy:setup` (or the same API calls) will:

1. Create the application if the name is new (`POST /api/application.create`).
2. Save git (`customGitUrl`, branch, `customGitSSHKeyId`).
3. Set build type `dockerfile` with the given Dockerfile and context.
4. Write runtime `env`, non-secret `buildArgs`, and `ARECA_SITE_TOKEN` as a
   BuildKit build secret. The token is not stored in a Docker `ARG` or image
   `ENV`; the Dockerfile mounts it only for the content-pull build step.

```
PORT=3000
ARECA_CMS_URL=http://<cms-lan-ip>:3000
ARECA_SITE_TOKEN=<plain site token>
```

Only `ARECA_CMS_URL` and `ARECA_SNAPSHOT_ID=0` go in `buildArgs`.
`ARECA_SITE_TOKEN` goes in `buildSecrets` and remains in runtime `env` for
server-rendered previews. The CMS adapter rewrites `ARECA_SNAPSHOT_ID` on every
deploy.

5. Publish host port (`PUBLISHED_PORT` → `TARGET_PORT`, `publishMode: host`).
6. Turn off push auto-deploy so only **Go live** in the CMS triggers a build.
7. Set Swarm `updateConfigSwarm.Order = "stop-first"`. The default
   `start-first` cannot bind the same host port; Dokploy still marks the deploy
   `done` while the old container keeps serving.

Health URL for a host-published port is
`https://<site-host>/api/health`. Local/LAN HTTP requires the explicit CMS
`ALLOW_PRIVATE_HEALTH_CHECKS=true` development override.

## First-run setup and admin security

A fresh CMS has no users, so `/setup` is protected by a **setup token**. Set
`SETUP_TOKEN` (at least 16 characters) in the CMS environment, or leave it unset
and the CMS generates a random token, printing it once to stdout
(`[setup] First-run setup token: ...`) the first time a page is loaded while no
user exists; a generated token changes on every restart. Enter it on `/setup`.
A wrong or missing token is refused with a generic error, and once an account
exists the token is no longer used.

Agency admins must enable two-factor authentication (TOTP, with backup codes)
before they can use any admin feature; the first admin is sent to **Account and
security** right after setup. Deleting a client, saving or removing Dokploy
credentials, creating a site or rotating its tokens, and granting or removing
agency access additionally require a code entered in the last 10 minutes; the CMS
asks for one when needed. `ADMIN_MFA_REQUIRED=false` turns the requirement off
(for throwaway dev stacks only). Note that SSO and social sign-ins skip the CMS's
own two-factor prompt and rely on the identity provider's MFA.

## 3. CMS must be reachable from the Dokploy host

The Docker build calls `GET /api/sites/snapshot/current` on `ARECA_CMS_URL`.

- Listen on all interfaces: `pnpm --filter @areca/cms dev:lan` (or `vite dev --port 3000 --host 0.0.0.0`).
- Set `APP_URL=http://<cms-lan-ip>:3000` in `apps/cms/.env.local` so snapshot asset URLs are LAN-reachable.
- If the build log shows `areca pull` cannot connect, allow inbound TCP 3000 on the CMS machine
  (elevated): `New-NetFirewallRule -DisplayName "Areca CMS dev 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow`.

## AI apps need public HTTPS

ChatGPT and Claude connect to the CMS from the internet, so the CMS must answer on a public HTTPS address for them. Claude Code, Cursor and VS Code need HTTPS for any address except `localhost`, so a plain `http://` LAN address does not work for their sign-in.

- Set `APP_URL` and `BETTER_AUTH_URL` to the same public `https://` origin. The connector URL (`<APP_URL>/api/mcp/<site-slug>`), the OAuth issuer (`<BETTER_AUTH_URL>/api/auth`) and the discovery documents are built from them.
- A reverse proxy must forward every path to the CMS, including `/.well-known/*` (discovery), `/api/auth/*` (sign-in and OAuth) and `/api/mcp/*` (the connectors). A proxy that forwards only some paths breaks AI app sign-in.
- Check the discovery documents after a deploy. `https://<cms>/.well-known/oauth-protected-resource/api/mcp/<site-slug>` must return a `resource` equal to the connector URL, and `https://<cms>/.well-known/oauth-authorization-server/api/auth` must return the issuer `https://<cms>/api/auth`.

## 4. CMS site settings

As an agency administrator, first save and verify the organization's Dokploy
URL and API key under **Agency → Clients → {client} → Deployment** (**Save and
verify**). Verification lists
the applications accessible to the organization-scoped key. The key is never
shown again after saving.

Then configure the site in **Settings › Deployment** (agency admins): pick the
application from the verified list (or type its ID) and set the health check
URL. The stored target is equivalent to (`updateSite`):

```json
{
  "provider": "dokploy",
  "applicationId": "<from application.create / dokploy:setup>",
  "healthCheckUrl": "http://<dokploy-host>:<published-port>/api/health"
}
```

`productionUrl` = `https://<site-host>`. Sync the site
manifest from the customer package (`pnpm sync-manifest` with `ARECA_CMS_URL`
and `ARECA_SITE_TOKEN`).

## 5. What **Go live** does

**Go live** is in the Go-live tray at the bottom of the sidebar (and the
Go-live panel, `?panel=golive`). Owners and agency admins can use it.

1. CMS writes an immutable publication snapshot and enqueues a `build_job`.
2. Worker sets the publication to `building` and calls `POST /api/application.deploy`.
3. **Cache bust:** Dokploy cannot pass a per-deploy env var from the worker
   except by rewriting the app config. Before deploy, the adapter writes
   `ARECA_SNAPSHOT_ID=<publication-id>` into `buildArgs`. The demo Dockerfile
   declares that `ARG` _after_ the SDK build and _immediately before_
   `pnpm --filter @areca/demo-site build` (which runs `areca pull`). Changing
   the ARG invalidates only the content-pull layer, so Docker does not reuse a
   cached snapshot from an earlier publication.
4. Dokploy clones git, builds the Dockerfile, and `areca pull` requests the exact
   frozen publication (`GET /api/sites/snapshot/current?publicationId=<id>`)
   selected by `ARECA_SNAPSHOT_ID`. A missing or different publication fails the build.
5. Worker polls `application.one` until that deployment is `done`, then GET
   the health URL until `{ ok: true, publicationId }` matches the publication.
6. Publication becomes `live` (`wasLive=true`); the previous live one is
   `superseded`.

Rollback creates a new publication containing the selected previously live snapshot,
then deploys and verifies that new publication ID. Its scheduling membership is
empty, so it cannot promote unrelated due entries. A failed rollback leaves the
previous live publication and its rollback eligibility intact.

Sites default to **Production** mode. A production publication requires both a
Dokploy application and an HTTP(S) health URL. The health response must contain
`{ ok: true, publicationId }` with the exact requested publication ID; a generic
HTTP 200 is insufficient. Missing configuration rejects publishing, and failed
verification leaves the previous release live.

For a site intentionally used without deployment, an agency admin can select
**Demo** in Settings → Deployment. Demo publications are visibly labeled, use
status `demo`, never set `wasLive` or `deployedAt`, and never count as production
live or become rollback targets. The site's build token can pull the latest demo
snapshot for local demonstration. Configure a deployment target and health URL
and switch to Production before releasing a production site.

The queue locks each site when enqueueing or claiming work and enforces one
queued and one active job per site in PostgreSQL. Sites may share a Dokploy
application; deployments for that application are serialized, including uncertain
dispatches. The website developer controls how combined content is built. Claimed jobs carry a 60-second
lease, renewed every 15 seconds. Recovery runs periodically, independently of
long deployment polling. Expired jobs fail and cannot subsequently mark a
publication live; request a fresh publication to retry. Scheduled failures allow an initial attempt and three retries, after 1, 5, and
15 minutes. After those retries the schedule stays paused until an owner
manually requests a release or replaces the scheduled approval.

## Media privacy

**Uploaded assets are public by design.** Sites are static builds that embed
image and file URLs, so a browser (and the site's build) must be able to fetch
them without signing in. The CMS therefore serves every upload from
`/api/assets/file/<organization-id>/<random-id>.<ext>` with no authentication,
and with `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy:
cross-origin`.

- Anyone who has or guesses a URL can read the file. The random key is not
  access control; URLs leak through page source, referrers, browser history,
  caches and shared links.
- **Assets attached to drafts, unpublished entries and archived content are
  public too.** Draft _content_ is protected by sign-in and preview tokens, but
  its images are not. Do not upload embargoed or confidential material, and do
  not rely on removing an entry to retract a file that has already been shared:
  deleting the asset (see [asset retention](ASSET_RETENTION.md)) is the only way
  to make its URL stop working.
- The S3 bucket itself should stay private and unreachable from the internet.
  Only the CMS reads it, and it is what enforces the URL space above.

To put a CDN in front, point it at the CMS origin and cache only
`/api/assets/file/*` (keys are immutable: a replaced image gets a new key).
Forward nothing but the path, ignore cookies and `Authorization` on that path so
cached responses are never user specific, and respect the origin's
`Cache-Control` headers. Do not cache other `/api/*` or app routes. Keep
`APP_URL` on the CMS origin unless you also rewrite asset URLs; assets stored
with the CMS host in their URLs keep that host.

If a deployment ever needs private media (for example per-user downloads), that
is a product change (authenticated or signed URLs plus build-time handling), not
a configuration switch.

## Secret handling

What is secret, and where it lives:

| Secret                               | Where                                             | Notes                                                                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                 | CMS environment                                   | Signs sessions and cookies.                                                                                                                                                                                                             |
| `DATABASE_URL`, `REDIS_URL`          | CMS environment                                   | Contain passwords.                                                                                                                                                                                                                      |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY`    | CMS environment                                   | Full access to every upload.                                                                                                                                                                                                            |
| `SMTP_*`, OAuth/SSO client secrets   | CMS environment                                   |                                                                                                                                                                                                                                         |
| `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` | CMS environment                                   | Encrypts each organization's Dokploy API key at rest. Back it up with the database ([RECOVERY.md](../docker/RECOVERY.md)).                                                                                                              |
| `AI_SETTINGS_ENCRYPTION_KEY`         | CMS environment (optional)                        | Encrypts the OpenRouter API key saved on `/agency/ai`. AI SEO suggestions stay off until it is set. Changing it means re-entering the key. Generate with `openssl rand -base64 32`; retain it with backups if restoring those settings. |
| Dokploy API keys                     | Database, encrypted                               | Entered per organization in the CMS.                                                                                                                                                                                                    |
| Site build token, schema-write token | Site settings > Developer (agency administrators) | `ARECA_SITE_TOKEN` is read-only and used by `areca pull`; `ARECA_SCHEMA_TOKEN` allows `areca manifest push` and belongs only in the schema-authoring environment, never in build secrets.                                               |
| Deploy keys                          | Dokploy                                           | Never commit them.                                                                                                                                                                                                                      |

Only `.env.example` files with placeholders are tracked in git. Real values live
in the host's environment, a secrets manager, or gitignored `.env` /
`.env.local` files.

CI enforces this on every pull request and before any image is published
(`.github/workflows/ci.yml`):

- **Secret scan:** gitleaks over the full git history using `.gitleaks.toml`.
  Add an allowlist entry there only for a specific fixture file, never for a
  real credential.
- **Client bundle scan:** the CMS is built with dummy values and
  `apps/cms/scripts/scan-client-bundle.mjs` fails if the browser assets contain
  server-only variable names or values, connection strings, private keys or
  `pg` imports. Run it locally with `pnpm --filter @areca/cms build` then
  `pnpm --filter @areca/cms scan:client`.

If a secret is ever committed, rotate it first (below); rewriting history is
secondary because clones and caches may already hold it.

Rotation:

- **`BETTER_AUTH_SECRET`:** generate a new value (`openssl rand -hex 32`),
  update the environment and restart every CMS instance together. All sessions
  end and everyone signs in again. Rotate in a maintenance window if multi-factor
  authentication is enabled: authenticator data protected by this secret may no
  longer verify, so confirm an administrator can still sign in (and has recovery
  codes) before relying on it.
- **Site build token / schema-write token:** _Settings > Developer > Rotate
  token…_. The old token stops working immediately; update `ARECA_SITE_TOKEN`
  (and `ARECA_SCHEMA_TOKEN`) in the site's Dokploy env/build secrets and in local
  `.env.local` files.
- **Database, Redis, S3, SMTP credentials:** change them on the service, then
  update the CMS environment and restart. Rotate S3 keys without touching the
  stored objects.
- **Dokploy API key:** create a new key in Dokploy, replace it in the
  organization's CMS settings, revoke the old one.
- **`DOKPLOY_CREDENTIALS_ENCRYPTION_KEY`:** there is no re-encryption tool.
  Changing the value makes every saved Dokploy API key undecryptable, so after
  switching you must re-enter each organization's key. Keep the old key until
  that is done, and never change it during an upgrade or restore (a restore
  needs the key the data was encrypted with).

## Troubleshooting

| Symptom                                                                | What to check                                                                                                                                                              |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Unexpected end of JSON input`                                         | `application.deploy` can return an empty 200. Current adapter treats that as success.                                                                                      |
| Deploy finishes in a few seconds, site still shows old `publicationId` | Docker cached `areca pull`. Confirm `ARECA_SNAPSHOT_ID` is in `buildArgs` and sits **after** the SDK build in the Dockerfile.                                              |
| Job `failed: Deploy error` / clone errors                              | Deploy key, `customGitSSHKeyId`, repo URL `git@github.com:…`.                                                                                                              |
| `areca pull` 401                                                       | Site token rotated; update Dokploy runtime `env` + `buildSecrets` and the local token you use for `sync-manifest`.                                                         |
| `areca pull` 404 `No publication exists`                               | Unpinned pulls require a successful `live`/`demo` release for the current mode. Worker builds request the exact `ARECA_SNAPSHOT_ID`; a missing pin fails without fallback. |
| `areca pull` connection refused / timeout                              | CMS not on `0.0.0.0`, wrong `ARECA_CMS_URL`, or Windows firewall blocking :3000.                                                                                           |
| `pnpm install --frozen-lockfile` fails                                 | Lockfile out of date vs `package.json`; commit an updated `pnpm-lock.yaml`.                                                                                                |
| Health check fails                                                     | `GET /api/deployment.all?applicationId=` then `GET /api/deployment.readLogs?deploymentId=&tail=200`. Port `3101→3000` `publishMode: host`.                                 |
| Build succeeds, site still serves old `publicationId`                  | Swarm kept the old task (`docker.getContainers` image digest unchanged). Set `updateConfigSwarm.Order` to `stop-first` and publish again.                                  |
| `application.saveGitProdiver` 404                                      | Typo path on v0.29.12. Use `saveGitProvider`.                                                                                                                              |
| `sshKey.create` 400 `organizationId`                                   | Required. Take it from `project.all`.                                                                                                                                      |
