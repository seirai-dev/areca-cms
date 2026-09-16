# Deploying a customer site to Dokploy

Areca publishes by snapshot: the CMS pins content, Dokploy builds the site from
git, `areca pull` fetches that snapshot **at build time**, then the CMS
health-checks the new container and marks the publication live.

This is the checklist used for the Acme demo (`examples/demo-site`) against
Dokploy v0.29.12. Register or update an application with:

```
pnpm --filter @areca/cms dokploy:setup
```

The script is idempotent: it looks up an existing app by `APP_NAME` in
`DOKPLOY_ENVIRONMENT_ID` before creating. Load secrets from
`apps/cms/.env.local` (gitignored). Do not commit API keys.

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
6. Turn off push auto-deploy so only **Publish site** triggers a build.
7. Set Swarm `updateConfigSwarm.Order = "stop-first"`. The default
   `start-first` cannot bind the same host port; Dokploy still marks the deploy
   `done` while the old container keeps serving.

Health URL for a host-published port is
`https://<site-host>/api/health`. Local/LAN HTTP requires the explicit CMS
`ALLOW_PRIVATE_HEALTH_CHECKS=true` development override.

## 3. CMS must be reachable from the Dokploy host

The Docker build calls `GET /api/sites/snapshot/current` on `ARECA_CMS_URL`.

- Listen on all interfaces: `pnpm --filter @areca/cms dev:lan` (or `vite dev --port 3000 --host 0.0.0.0`).
- Set `APP_URL=http://<cms-lan-ip>:3000` in `apps/cms/.env.local` so snapshot asset URLs are LAN-reachable.
- If the build log shows `areca pull` cannot connect, allow inbound TCP 3000 on the CMS machine
  (elevated): `New-NetFirewallRule -DisplayName "Areca CMS dev 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow`.

## 4. CMS site settings

On the site (agency admin → Settings, or `updateSite`):

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

## 5. What **Publish site** does

1. CMS writes an immutable publication snapshot and enqueues a `build_job`.
2. Worker sets the publication to `building` and calls `POST /api/application.deploy`.
3. **Cache bust:** Dokploy cannot pass a per-deploy env var from the worker
   except by rewriting the app config. Before deploy, the adapter writes
   `ARECA_SNAPSHOT_ID=<timestamp>` into `buildArgs`. The demo Dockerfile
   declares that `ARG` _after_ the SDK build and _immediately before_
   `pnpm --filter @areca/demo-site build` (which runs `areca pull`). Changing
   the ARG invalidates only the content-pull layer, so Docker does not reuse a
   cached snapshot from an earlier publication.
4. Dokploy clones git, builds the Dockerfile, `areca pull` reads the **active
   job** snapshot (`GET /api/sites/snapshot/current`).
5. Worker polls `application.one` until that deployment is `done`, then GET
   the health URL until `{ ok: true, publicationId }` matches the publication.
6. Publication becomes `live` (`wasLive=true`); the previous live one is
   `superseded`.

Rollback re-enqueues a publication that `wasLive` and repeats the same deploy.
A rollback whose deploy fails stays `failed` but remains eligible because
`wasLive` is sticky.

## Troubleshooting

| Symptom                                                                | What to check                                                                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Unexpected end of JSON input`                                         | `application.deploy` can return an empty 200. Current adapter treats that as success.                                                      |
| Deploy finishes in a few seconds, site still shows old `publicationId` | Docker cached `areca pull`. Confirm `ARECA_SNAPSHOT_ID` is in `buildArgs` and sits **after** the SDK build in the Dockerfile.              |
| Job `failed: Deploy error` / clone errors                              | Deploy key, `customGitSSHKeyId`, repo URL `git@github.com:…`.                                                                              |
| `areca pull` 401                                                       | Site token rotated; update Dokploy runtime `env` + `buildSecrets` and the local token you use for `sync-manifest`.                         |
| `areca pull` 404 `No publication exists`                               | Snapshot endpoint only returns the active job's publication or the latest `live`. Publish from the CMS first.                              |
| `areca pull` connection refused / timeout                              | CMS not on `0.0.0.0`, wrong `ARECA_CMS_URL`, or Windows firewall blocking :3000.                                                           |
| `pnpm install --frozen-lockfile` fails                                 | Lockfile out of date vs `package.json`; commit an updated `pnpm-lock.yaml`.                                                                |
| Health check fails                                                     | `GET /api/deployment.all?applicationId=` then `GET /api/deployment.readLogs?deploymentId=&tail=200`. Port `3101→3000` `publishMode: host`. |
| Build succeeds, site still serves old `publicationId`                  | Swarm kept the old task (`docker.getContainers` image digest unchanged). Set `updateConfigSwarm.Order` to `stop-first` and publish again.  |
| `application.saveGitProdiver` 404                                      | Typo path on v0.29.12. Use `saveGitProvider`.                                                                                              |
| `sshKey.create` 400 `organizationId`                                   | Required. Take it from `project.all`.                                                                                                      |
