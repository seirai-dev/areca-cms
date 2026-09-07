# Deploying a customer site to Dokploy

Areca publishes by snapshot: the CMS pins content, Dokploy builds the site from git,
`areca pull` fetches that snapshot **at build time**, then the CMS health-checks the
new container and marks the publication live.

This is the checklist used for the Acme demo (`examples/demo-site`) against Dokploy
v0.29.12. Re-run the API steps with
`pnpm --filter @areca/cms exec tsx --env-file=.env.local scripts/dokploy-setup.ts`.

## 1. Git repo + deploy key

1. Push the monorepo to GitHub (private is fine).
2. Generate an ed25519 keypair (`ssh-keygen -t ed25519 -N "" -f areca_deploy -C areca-dokploy`).
3. `POST /api/sshKey.create` with `name`, `publicKey`, `privateKey`, `organizationId`
   (from `GET /api/project.all` → `organizationId`). Then `GET /api/sshKey.all` for `sshKeyId`.
4. Add the **public** key as a read-only GitHub deploy key. Delete the local private key.

## 2. Dokploy application

`POST /api/application.create` `{ name, appName, environmentId }`.

Then:

| Endpoint | Body |
| --- | --- |
| `POST /api/application.saveGitProvider` | `{ applicationId, customGitUrl, customGitBranch, customGitBuildPath, customGitSSHKeyId, watchPaths: [] }` |
| `POST /api/application.saveBuildType` | `{ applicationId, buildType: "dockerfile", dockerfile: "examples/demo-site/Dockerfile", dockerContextPath: ".", dockerBuildStage: "", herokuVersion: null, railpackVersion: null }` |
| `POST /api/application.saveEnvironment` | `{ applicationId, env, buildArgs, buildSecrets: "", createEnvFile: false }` |
| `POST /api/port.create` | `{ applicationId, publishedPort: 3101, targetPort: 3000, protocol: "tcp", publishMode: "host" }` |

`env` and `buildArgs` are newline-separated `KEY=value` strings. Dokploy passes
`buildArgs` as Docker `--build-arg`. Required:

```
PORT=3000
ARECA_CMS_URL=http://<cms-lan-ip>:3000
ARECA_SITE_TOKEN=<plain site token>
```

and the same `ARECA_*` keys in `buildArgs`, plus `ARECA_SNAPSHOT_ID` (the CMS adapter
rewrites this on every deploy so Docker does not reuse a cached `areca pull`).

Confirm with `GET /api/application.one?applicationId=`. Health URL for a host-published
port is `http://<dokploy-host>:3101/api/health`.

Turn off push auto-deploy (`POST /api/application.update` `{ applicationId, autoDeploy: false }`)
so only **Publish site** triggers a build.

Host-published ports need Swarm `updateConfigSwarm.Order = "stop-first"`. The default
`start-first` cannot bind the same host port; Dokploy still marks the deploy `done`
while the old container keeps serving. The setup script sets this.

## 3. CMS must be reachable from the Dokploy host

The Docker build calls `GET /api/sites/snapshot/current` on `ARECA_CMS_URL`.

- Listen on all interfaces: `pnpm --filter @areca/cms dev:lan` (or `vite dev --port 3000 --host 0.0.0.0`).
- Set `APP_URL=http://<cms-lan-ip>:3000` in `apps/cms/.env.local` so snapshot asset URLs are LAN-reachable.
- If the build log shows `areca pull` cannot connect, allow inbound TCP 3000 on the CMS machine
  (elevated): `New-NetFirewallRule -DisplayName "Areca CMS dev 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow`.

## 4. CMS deployment target

On the site (agency admin → Settings, or `updateSite`):

```json
{
  "provider": "dokploy",
  "applicationId": "<from application.create>",
  "healthCheckUrl": "http://<dokploy-host>:3101/api/health"
}
```

`productionUrl` = `http://<dokploy-host>:3101`. Sync the site manifest from the customer
package (`pnpm sync-manifest` with `ARECA_CMS_URL` + `ARECA_SITE_TOKEN`).

## 5. What **Publish site** does

1. CMS writes an immutable publication snapshot and enqueues a `build_job`.
2. Worker sets the publication to `building` and calls `POST /api/application.deploy`.
3. The adapter writes a fresh `ARECA_SNAPSHOT_ID` build arg so the content layer rebuilds.
4. Dokploy clones git, builds the Dockerfile, `areca pull` reads the **active job**
   snapshot (`/api/sites/snapshot/current`).
5. Worker polls `application.one` until that deployment is `done`, then GET the health URL
   until `{ ok: true, publicationId }` matches the publication.
6. Publication becomes `live`; the previous live one is `superseded`.

Rollback re-enqueues an earlier publication and repeats the same deploy.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `Unexpected end of JSON input` | `application.deploy` can return an empty 200. Current adapter treats that as success. |
| Deploy finishes in a few seconds, site still shows old `publicationId` | Docker cached `areca pull`. Confirm `ARECA_SNAPSHOT_ID` is in `buildArgs` and sits **after** the SDK build in the Dockerfile. |
| Job `failed: Deploy error` / clone errors | Deploy key, `customGitSSHKeyId`, repo URL `git@github.com:…`. |
| `areca pull` 401 | Site token rotated; update Dokploy `env` + `buildArgs` and the local token you use for `sync-manifest`. |
| `areca pull` 404 `No publication exists` | Snapshot endpoint only returns the active job's publication or the latest `live`. Publish from the CMS first. |
| `areca pull` connection refused / timeout | CMS not on `0.0.0.0`, wrong `ARECA_CMS_URL`, or Windows firewall blocking :3000. |
| `pnpm install --frozen-lockfile` fails | Lockfile out of date vs `package.json`; commit an updated `pnpm-lock.yaml`. |
| Health check fails | `GET /api/deployment.all?applicationId=` then `GET /api/deployment.readLogs?deploymentId=&tail=200`. Port `3101→3000` `publishMode: host`. |
| Build succeeds, site still serves old `publicationId` | Swarm kept the old task (`docker.getContainers` image digest unchanged). Set `updateConfigSwarm.Order` to `stop-first` and publish again. |
| `application.saveGitProdiver` 404 | Typo path on v0.29.12. Use `saveGitProvider`. |
| `sshKey.create` 400 `organizationId` | Required. Take it from `project.all`. |

Auth is header `x-api-key` (not Bearer). Base `http://<dokploy-host>:3000`.
More request shapes: `apps/cms/src/adapters/deployment/dokploy-api-notes.md`.
