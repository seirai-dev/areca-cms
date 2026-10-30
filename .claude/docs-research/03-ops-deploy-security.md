# Research notes 03: operations, deployment, recovery, upgrades, capacity, security

Scope: read-only extraction for the public docs site. No repo files were edited.
Repo: /Users/ek/development/projects/areca-cms
Date of research: 2026-10-09

Cross-checks performed against code (noted inline as "[code]"):
- `apps/cms/src/env.ts` (env schema, defaults, validation)
- `apps/cms/Dockerfile` (image HEALTHCHECK)
- `apps/cms/drizzle/` (migration files 0000 to 0016)
- `apps/cms/package.json` scripts
- Existence of every relative link target referenced by the in-scope docs

Files that exist but were NOT in my read list and are referenced by these docs: `docs/CONFIGURATION.md`, `docs/INTEGRATIONS.md`, `CMS_AUDIT.md` (repo root), `apps/cms/src/adapters/deployment/dokploy-api-notes.md`, `packages/site-sdk/README.md`, `.github/workflows/ci.yml`, `docker/.env.example`. They were not read in full (only confirmed present), so anything that defers to CONFIGURATION.md is unverified here.

---

## Index of sources

| # | Source | One-line purpose | Primary audience |
|---|---|---|---|
| 1 | docs/DEPLOYMENT.md | Deploy a customer site to Dokploy; secrets; media privacy; first-run admin security | Self-hosting operator, agency admin |
| 2 | docs/OPERATIONS.md | Health, readiness, metrics, logs, DB deadlines, worker/scheduler, env vars | Self-hosting operator |
| 3 | docs/RECOVERY.md | Recovery paths overview (whole instance, one org, retained media) | Self-hosting operator |
| 4 | docs/UPGRADES.md | Migrations model, rules, upgrade procedure, rollback, checklist | Self-hosting operator |
| 5 | docs/HIGH_RISK_UPGRADE.md | Release-specific upgrade notes for the top 10 audit findings (migrations 0007/0008) | Operator of an existing pre-release instance |
| 6 | docs/CAPACITY.md | Supported envelope, benchmark method and results, known limits, scaling triggers | Operator, contributor |
| 7 | docs/ASSET_RETENTION.md | What keeps assets alive; org deletion; cleanup command | Operator, agency admin |
| 8 | docs/AUTHZ_MATRIX.md | Roles, policies, server-function and HTTP-route authorization matrix | Contributor, security reviewer |
| 9 | docs/DECISIONS.md | Architecture decisions: model, publishing flow, roles, Dokploy adapter | Contributor |
| 10 | docker/README.md | Local/demo Docker Compose quickstart, image build, tags | Self-hosting operator, contributor |
| 11 | docker/RECOVERY.md | Full-instance backup, isolated restore, org authoring export/import | Self-hosting operator |
| 12 | docker/compose.yml | Reference Compose stack (CMS, Postgres, Redis, RustFS, Mailpit) | Self-hosting operator |

---

## 1. docs/DEPLOYMENT.md

**Purpose:** Checklist for deploying a customer site to Dokploy (the demo is `examples/demo-site`, Dokploy v0.29.12). Explains publish-by-snapshot, Go-live, health verification, media privacy, secret handling, rotation, troubleshooting.

**Audience:** Self-hosting operator and agency admin (sections 4, 5, media, secrets). Contributor only for the `dokploy:setup` script internals.

### Core model (verbatim intent)
> Areca publishes by snapshot: the CMS pins content, Dokploy builds the site from git, `areca pull` fetches that snapshot **at build time**, then the CMS health-checks the new container and marks the publication live.

### Setup script
Command (verbatim):
```
pnpm --filter @areca/cms dokploy:setup
```
- Idempotent: looks up existing app by `APP_NAME` in `DOKPLOY_ENVIRONMENT_ID` before creating.
- Load setup-script secrets from `apps/cms/.env.local` (gitignored). Do not commit API keys.
- Runtime publishing credentials are configured per CMS organization (not in env).
- [code] `dokploy:setup` script exists in `apps/cms/package.json`.

Required env for `dokploy:setup`: `DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_ENVIRONMENT_ID`, `GIT_URL`, `SSH_KEY_ID`, `SITE_TOKEN`, `CMS_URL`.
Optional: `APP_NAME` (default `acme-demo-site`), `GIT_BRANCH` (`main`), `DOCKERFILE` (`examples/demo-site/Dockerfile`), `PUBLISHED_PORT` (`3101`), `TARGET_PORT` (`3000`), `AUTO_DEPLOY` (`false`).
Production/shared URLs must use HTTPS. Local/LAN-only testing: `DOKPLOY_ALLOW_INSECURE_HTTP=true`.

CMS env required for Dokploy credentials:
- `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY`: stable base64 32-byte key (`openssl rand -base64 32`). Same key across replicas and restores. Losing it makes stored Dokploy API keys unrecoverable.
- `DOKPLOY_DEV_FALLBACK_ENABLED=true` enables legacy global URL/key (local development only).

### Prerequisites
- Monorepo pushed to a git host Dokploy can clone (private GitHub is fine).
- Dokploy API reachable (`DOKPLOY_URL`, header `x-api-key`).
- CMS reachable from Dokploy host at `CMS_URL` (LAN IP, not `localhost`).
- Site token (`SITE_TOKEN`) and Dokploy SSH key id (`SSH_KEY_ID`).

### Procedure 1: Git repo + deploy key (one-time)
1. Push the monorepo to GitHub.
2. Generate keypair (verbatim): `ssh-keygen -t ed25519 -N "" -f areca_deploy -C areca-dokploy`
3. `POST /api/sshKey.create` with `name`, `publicKey`, `privateKey`, `organizationId` (from `GET /api/project.all` → `organizationId`). Then `GET /api/sshKey.all` for `sshKeyId`.
4. Add the **public** key as a read-only GitHub deploy key. Delete the local private key.
- Auth: header `x-api-key` (not Bearer). Use HTTPS Dokploy API URL outside explicit local/LAN testing.
- More request shapes: `apps/cms/src/adapters/deployment/dokploy-api-notes.md` (exists).

### Procedure 2: Register the Dokploy application
`dokploy:setup` (or same API calls) will:
1. Create app if name is new (`POST /api/application.create`).
2. Save git (`customGitUrl`, branch, `customGitSSHKeyId`).
3. Set build type `dockerfile` with given Dockerfile and context.
4. Write runtime `env`, non-secret `buildArgs`, and `ARECA_SITE_TOKEN` as a BuildKit build secret. Token is not stored in Docker `ARG` or image `ENV`; Dockerfile mounts it only for content-pull build step.

Env block (verbatim):
```
PORT=3000
ARECA_CMS_URL=http://<cms-lan-ip>:3000
ARECA_SITE_TOKEN=<plain site token>
```
- Only `ARECA_CMS_URL` and `ARECA_SNAPSHOT_ID=0` go in `buildArgs`.
- `ARECA_SITE_TOKEN` goes in `buildSecrets`, and remains in runtime `env` for server-rendered previews.
- CMS adapter rewrites `ARECA_SNAPSHOT_ID` on every deploy.
5. Publish host port (`PUBLISHED_PORT` → `TARGET_PORT`, `publishMode: host`).
6. Turn off push auto-deploy so only **Go live** triggers a build.
7. Set Swarm `updateConfigSwarm.Order = "stop-first"`. Default `start-first` cannot bind the same host port; Dokploy still marks deploy `done` while old container keeps serving.
- Health URL for host-published port: `https://<site-host>/api/health`. Local/LAN HTTP requires CMS `ALLOW_PRIVATE_HEALTH_CHECKS=true` (dev override).

### Procedure 3: First-run setup and admin security
- `/setup` is protected by a **setup token**. Set `SETUP_TOKEN` (≥16 chars) in CMS env, or leave unset: CMS generates a random token and prints once to stdout (`[setup] First-run setup token: ...`) the first time a page is loaded while no user exists. Generated token changes on every restart. Enter it on `/setup`.
- Wrong or missing token refused with generic error. Once an account exists the token is no longer used.
- Agency admins must enable TOTP (with backup codes) before any admin feature; first admin is sent to **Account and security** after setup.
- Step-up (fresh code within last 10 minutes; CMS prompts when needed) required for: deleting a client, saving or removing Dokploy credentials, creating a site or rotating its tokens, granting or removing agency access.
- `ADMIN_MFA_REQUIRED=false` turns MFA requirement off (throwaway dev stacks only).
- SSO and social sign-ins skip the CMS's own 2FA prompt and rely on the IdP's MFA.

### Procedure 4: CMS must be reachable from the Dokploy host
Docker build calls `GET /api/sites/snapshot/current` on `ARECA_CMS_URL`.
- Listen on all interfaces: `pnpm --filter @areca/cms dev:lan` (or `vite dev --port 3000 --host 0.0.0.0`). [code] `dev:lan` exists.
- Set `APP_URL=http://<cms-lan-ip>:3000` in `apps/cms/.env.local`.
- If build log shows `areca pull` cannot connect, allow inbound TCP 3000 (Windows, elevated):
  `New-NetFirewallRule -DisplayName "Areca CMS dev 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow`

### Procedure 5: CMS site settings
1. As agency admin, save and verify org Dokploy URL and API key under **Agency → Clients → {client} → Deployment** (**Save and verify**). Verification lists apps accessible to the org-scoped key. Key never shown again after saving.
2. Configure site in **Settings › Deployment** (agency admins): pick application from verified list (or type ID), set health check URL. Stored target (`updateSite`):
```json
{
  "provider": "dokploy",
  "applicationId": "<from application.create / dokploy:setup>",
  "healthCheckUrl": "http://<dokploy-host>:<published-port>/api/health"
}
```
- `productionUrl` = `https://<site-host>`.
- Sync site manifest from customer package: `pnpm sync-manifest` with `ARECA_CMS_URL` and `ARECA_SITE_TOKEN`.

### Procedure 6: What **Go live** does
**Go live** is in the Go-live tray at the bottom of the sidebar (and Go-live panel `?panel=golive`). Owners and agency admins.
1. CMS writes immutable publication snapshot and enqueues `build_job`.
2. Worker sets publication to `building` and calls `POST /api/application.deploy`.
3. Cache bust: adapter writes `ARECA_SNAPSHOT_ID=<publication-id>` into `buildArgs` before deploy. Demo Dockerfile declares that `ARG` after the SDK build and immediately before `pnpm --filter @areca/demo-site build` (runs `areca pull`). Changing the ARG invalidates only the content-pull layer.
4. Dokploy clones git, builds the Dockerfile, `areca pull` reads the **active job** snapshot (`GET /api/sites/snapshot/current`).
5. Worker polls `application.one` until that deployment is `done`, then GETs health URL until `{ ok: true, publicationId }` matches.
6. Publication becomes `live` (`wasLive=true`); previous live one becomes `superseded`.

Rollback: creates a NEW publication containing the selected previously-live snapshot, deploys and verifies that new publication ID. Its scheduling membership is empty, so it cannot promote unrelated due entries. Failed rollback leaves previous live publication and its rollback eligibility intact.

Production vs Demo:
- Sites default to **Production**. Production publication requires Dokploy application AND HTTP(S) health URL. Health response must contain `{ ok: true, publicationId }` with exact requested ID; generic HTTP 200 insufficient. Missing config rejects publishing; failed verification leaves previous release live.
- **Demo** (Settings → Deployment, agency admin): visibly labeled, status `demo`, never sets `wasLive` or `deployedAt`, never counts as production live or becomes rollback target. Site build token can pull latest demo snapshot. Configure target + health URL and switch to Production before releasing production site.

Queue behaviour:
- Queue locks each site on enqueue/claim; one queued and one active job per site enforced in PostgreSQL.
- Claimed jobs carry a **60-second lease**, renewed every **15 seconds**.
- Recovery runs periodically independently of deployment polling. Expired jobs fail and cannot mark a publication live; request fresh publication to retry. Scheduling retries due entries after recovery.

### Media privacy (verbatim rules)
> **Uploaded assets are public by design.**
- CMS serves every upload from `/api/assets/file/<organization-id>/<random-id>.<ext>` with no authentication, `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin`.
- Anyone who has or guesses a URL can read the file. URLs leak via page source, referrers, history, caches, shared links.
- **Assets attached to drafts, unpublished entries and archived content are public too.** Draft content is protected by sign-in and preview tokens; its images are not. Do not upload embargoed/confidential material. Deleting an entry does not retract a file already shared; "deleting the asset (see asset retention) is the only way to make its URL stop working." (**CONTRADICTION, see Stale list.**)
- S3 bucket should stay private, unreachable from the internet.
- CDN: point at CMS origin; cache only `/api/assets/file/*`; forward nothing but path; ignore cookies and `Authorization` on that path; respect origin `Cache-Control`. Do not cache other `/api/*` or app routes. Keep `APP_URL` on CMS origin unless rewriting asset URLs.
- Private media (per-user downloads) = product change (signed URLs + build-time handling), not a config switch.

### Secret handling table (verbatim)
| Secret | Where | Notes |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | CMS environment | Signs sessions and cookies. |
| `DATABASE_URL`, `REDIS_URL` | CMS environment | Contain passwords. |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | CMS environment | Full access to every upload. |
| `SMTP_*`, OAuth/SSO client secrets | CMS environment | |
| `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` | CMS environment | Encrypts each org's Dokploy API key at rest. Back up with DB (RECOVERY.md). |
| `AI_SETTINGS_ENCRYPTION_KEY` | CMS environment (optional) | Encrypts OpenRouter key saved on `/agency/ai`. AI SEO suggestions stay off until set. Changing it means re-entering key. Generate with `openssl rand -base64 32`; retain with backups. |
| Dokploy API keys | Database, encrypted | Entered per organization in the CMS. |
| Site build token, schema-write token | Site settings > Developer (agency admins) | `ARECA_SITE_TOKEN` read-only, used by `areca pull`; `ARECA_SCHEMA_TOKEN` allows `areca manifest push`, only in schema-authoring environment, never in build secrets. |
| Deploy keys | Dokploy | Never commit them. |

- Only `.env.example` files with placeholders are tracked. Real values live in host env, secrets manager, or gitignored `.env`/`.env.local`.
- CI (`.github/workflows/ci.yml`) on every PR and before any image publish:
  - **Secret scan:** gitleaks over full git history using `.gitleaks.toml`. Allowlist only for specific fixture files.
  - **Client bundle scan:** CMS built with dummy values; `apps/cms/scripts/scan-client-bundle.mjs` fails if browser assets contain server-only variable names/values, connection strings, private keys or `pg` imports. Local run:
    ```
    pnpm --filter @areca/cms build
    pnpm --filter @areca/cms scan:client
    ```
- If a secret is committed: rotate first; history rewrite is secondary.

### Rotation (verbatim rules)
- **`BETTER_AUTH_SECRET`:** `openssl rand -hex 32`; update env and restart every CMS instance together. All sessions end. Rotate in maintenance window if MFA enabled: authenticator data protected by this secret may no longer verify; confirm an admin can still sign in (and has recovery codes) first.
- **Site build token / schema-write token:** *Settings > Developer > Rotate token…*. Old token stops immediately; update `ARECA_SITE_TOKEN` (and `ARECA_SCHEMA_TOKEN`) in Dokploy env/build secrets and local `.env.local`.
- **Database, Redis, S3, SMTP:** change on the service, update CMS env, restart. Rotate S3 keys without touching stored objects.
- **Dokploy API key:** create new key in Dokploy, replace in org CMS settings, revoke old one.
- **`DOKPLOY_CREDENTIALS_ENCRYPTION_KEY`:** no re-encryption tool. Changing value makes every saved Dokploy key undecryptable; re-enter each org's key. Keep old key until done; never change during upgrade or restore.

### Troubleshooting table (verbatim)
| Symptom | What to check |
| --- | --- |
| `Unexpected end of JSON input` | `application.deploy` can return an empty 200. Current adapter treats that as success. |
| Deploy finishes in a few seconds, site still shows old `publicationId` | Docker cached `areca pull`. Confirm `ARECA_SNAPSHOT_ID` is in `buildArgs` and sits **after** the SDK build in the Dockerfile. |
| Job `failed: Deploy error` / clone errors | Deploy key, `customGitSSHKeyId`, repo URL `git@github.com:…`. |
| `areca pull` 401 | Site token rotated; update Dokploy runtime `env` + `buildSecrets` and the local token used for `sync-manifest`. |
| `areca pull` 404 `No publication exists` | Snapshot reads use active/uncertain job's publication, or latest successful `live`/`demo` publication for site's current mode. Request a publication first. |
| `areca pull` connection refused / timeout | CMS not on `0.0.0.0`, wrong `ARECA_CMS_URL`, or Windows firewall blocking :3000. |
| `pnpm install --frozen-lockfile` fails | Lockfile out of date vs `package.json`; commit updated `pnpm-lock.yaml`. |
| Health check fails | `GET /api/deployment.all?applicationId=` then `GET /api/deployment.readLogs?deploymentId=&tail=200`. Port `3101→3000` `publishMode: host`. |
| Build succeeds, site still serves old `publicationId` | Swarm kept old task (`docker.getContainers` image digest unchanged). Set `updateConfigSwarm.Order` to `stop-first` and publish again. |
| `application.saveGitProdiver` 404 | Typo path on v0.29.12. Use `saveGitProvider`. |
| `sshKey.create` 400 `organizationId` | Required. Take it from `project.all`. |

### Stale / contradictory / incomplete (DEPLOYMENT)
- **Contradiction (media):** says deleting the asset is "the only way" to stop a URL working, but ASSET_RETENTION.md says assets referenced by any publication snapshot, revision, draft or archive are NOT deletable. So a file already in a live or historical publication cannot be retracted by any documented route. Needs an explicit answer.
- **Possibly stale UI location:** "Go-live tray at the bottom of the sidebar". The user's auto-memory records a later redesign (top navbar + site switcher). Verify against the current UI before publishing.
- Go-live section: the 15-minute maximum deploy wait (OPERATIONS) and the 60s lease (here) are not cross-referenced.
- `ALLOW_PRIVATE_HEALTH_CHECKS` is referenced but absent from OPERATIONS env table and compose.yml. [code] It exists in `env.ts` as `z.enum(['true','false']).optional()`.
- Step-up list omits `saveAiSettingsFn` (step-up when API key set/removed, per AUTHZ_MATRIX).
- "Deleting a client" is the UI term; API is `deleteOrganizationFn`. Terminology: client = organization.
- Windows-only firewall command in a doc otherwise used on macOS/Linux.
- Health URL example uses `http://` in §4 but the adjacent text says production must be HTTPS. Only valid for LAN; say so inline.
- Incomplete: no procedure given for "Settings › Developer" token display (see DECISIONS hashed-token question).

---

## 2. docs/OPERATIONS.md

**Purpose:** Runtime behaviour operators need: health endpoints, metrics, logs, DB deadlines, worker/scheduler behaviour, env vars.

**Audience:** Self-hosting operator. Points to `CONFIGURATION.md` (not read) for full env reference.

### Endpoints (verbatim table)
| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/health` | none | Cheap liveness. Always `200 {"ok":true,"service":"cms"}` while process serves requests. Touches no dependency. |
| `GET /api/health/ready` | none | Readiness. `200` or `503` with JSON; every check time-bounded. |
| `GET /api/metrics` | `Authorization: Bearer $METRICS_TOKEN` | Prometheus text. `404` when `METRICS_TOKEN` unset, `401` for wrong/missing token. |

- `/api/health` for container liveness; `/api/health/ready` for LB/orchestrator readiness.
- Docker HEALTHCHECK: call `/api/health/ready` only if you want container unhealthy when Postgres or S3 is down. Plain restart won't fix those, so `/api/health` is the safer HEALTHCHECK target.
- [code] `apps/cms/Dockerfile` HEALTHCHECK calls `http://127.0.0.1:$PORT/api/health` every 30s, timeout 5s, start-period 60s, 3 retries. Consistent with the advice.

### Readiness response (verbatim example)
```json
{
  "ok": false,
  "checks": {
    "db":      { "ok": true,  "ms": 4 },
    "storage": { "ok": false, "ms": 3001, "reason": "CheckTimeout: timed out after 3000ms" },
    "redis":   { "ok": true,  "ms": 2, "degraded": true, "reason": "ECONNREFUSED" },
    "worker":  { "ok": true,  "ms": 0, "detail": { "enabled": true, "tickAgeSeconds": 1 } },
    "queue":   { "ok": true,  "ms": 5, "detail": { "queued": 0, "active": 1, "oldestQueuedAgeSeconds": null, "expiredLeases": 0, "schedulerAgeSeconds": 2 } }
  }
}
```
Checks:
- `db`: `select 1`.
- `storage`: S3 `HeadBucket` on `S3_BUCKET`.
- `redis`: `PING`. Rate limiting fails open; Redis outage → `degraded: true`, does NOT fail readiness.
- `worker`: only when `WORKER_ENABLED` on. Fails when loop has not ticked for `READINESS_MAX_TICK_AGE_SECONDS`. (Timer ticks during long deployments.)
- `queue`: fails when oldest queued build job older than `READINESS_MAX_QUEUE_AGE_SECONDS`; when an active job's lease expired longer than `READINESS_MAX_TICK_AGE_SECONDS` without recovery; or when scheduler has not ticked in that window.
- Responses carry only check names, ok/fail, timings, short redacted reason. Full errors in logs. Heartbeats are per process: with several replicas only those with `WORKER_ENABLED=true` report worker state.

### Metrics (verbatim table)
| Metric | Labels | Meaning |
| --- | --- | --- |
| `areca_build_jobs` | `status` | Build jobs per status |
| `areca_build_jobs_oldest_queued_age_seconds` | | Oldest queued job age (0 when empty) |
| `areca_build_jobs_active` | | building + validating + deploying |
| `areca_build_jobs_failed_total` | | Jobs in `failed` status (counter-like; falls if history is deleted) |
| `areca_publications` | `status` | Publications per status |
| `areca_scheduled_entries_overdue` | | Scheduled entries past time and not yet published |
| `areca_worker_enabled` | | 1 when worker loops run in this process |
| `areca_worker_last_tick_age_seconds` | | Only when worker enabled |
| `areca_scheduler_last_tick_age_seconds` | | Only when worker enabled |
| `areca_readiness_check_up` | `check` | 1 up, 0 down or degraded |
| `areca_ready` | | 1 when readiness would return 200 |
| `areca_process_uptime_seconds` | | |
| `areca_process_memory_bytes` | `kind` | rss, heap_used, heap_total, external |

- All gauges unless noted. Counts from DB at scrape time (correct across restarts and replicas).
- Scrape config (verbatim):
```yaml
scrape_configs:
  - job_name: areca-cms
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/areca-metrics-token
    static_configs:
      - targets: ['cms.example.com']
```
- Metrics built from several `count(*)` queries; keep scrape interval ≥15s.
- `/api/metrics` rate limited: **60 requests per minute per client IP**, one shared bucket unless `RATE_LIMIT_TRUST_PROXY` is set. `/api/health` and `/api/health/ready` never rate limited.

### Example alerts (verbatim)
```yaml
groups:
  - name: areca-cms
    rules:
      - alert: ArecaNotReady
        expr: areca_ready == 0
        for: 5m
        annotations:
          summary: "CMS readiness failing ({{ $labels.instance }})"
      - alert: ArecaDependencyDown
        expr: areca_readiness_check_up{check=~"db|storage|queue|worker"} == 0
        for: 5m
        annotations:
          summary: "CMS check {{ $labels.check }} is down"
      - alert: ArecaBuildQueueStuck
        expr: areca_build_jobs_oldest_queued_age_seconds > 900
        for: 5m
        annotations:
          summary: "A publish job has waited over 15 minutes"
      - alert: ArecaBuildJobsFailing
        expr: increase(areca_build_jobs_failed_total[1h]) > 3
        annotations:
          summary: "More than 3 build jobs failed in the last hour"
      - alert: ArecaSchedulerStalled
        expr: areca_scheduler_last_tick_age_seconds > 300
        annotations:
          summary: "Scheduler has not completed a tick in 5 minutes"
      - alert: ArecaScheduledEntriesOverdue
        expr: areca_scheduled_entries_overdue > 0
        for: 30m
        annotations:
          summary: "Scheduled entries are overdue by more than 30 minutes"
      - alert: ArecaRedisDegraded
        expr: areca_readiness_check_up{check="redis"} == 0
        for: 10m
        annotations:
          summary: "Redis unreachable; rate limiting is failing open"
```

### Logs
- One JSON object per line. Example (verbatim):
```json
{"level":"error","time":"2026-10-01T13:30:20.823Z","component":"worker","msg":"job failed","jobId":"...","err":{"name":"Error","message":"...","stack":"..."}}
```
- `info`/`debug` → stdout; `warn`/`error` → stderr.
- `LOG_LEVEL` = `debug|info|warn|error|silent` (default `info`). Reserved keys: `level`, `time`, `component`, `msg`; a field with reserved name is written as `field_<name>`.
- Redaction (best effort): env vars named `*SECRET*`, `*TOKEN*`, `*PASSWORD*`, `*API_KEY*`, `*ACCESS_KEY*`, `*ENCRYPTION_KEY*`...; passwords in `*_URL`; URL userinfo; `Authorization`/`Bearer`/`x-api-key`; sensitive `key=value` pairs; long base64/hex in `key=value`. Do not log secrets on purpose.
- Build logs (`build_job.logs`, shown in publish UI): redacted per line; each line cut at **8 KiB**; whole log capped at **256 KiB** (counted in characters, not bytes; multi-byte text can use up to ~1 MiB). Over cap: oldest content dropped, log starts with single `[truncated]` marker; tail kept. Job and audit error text also redacted.
- UI errors: server functions pass typed errors (not found, conflict, validation, asset validation, `MFA_REQUIRED`, `REAUTH_REQUIRED`, redirects, Response). Everything else → `Something went wrong (ref: <id>)`; full redacted error logged with same `ref` (`msg: "unhandled server function error"`). To expose a new error type: extend `AppError` (`src/server/http/app-error.ts`) or add code to `PASSTHROUGH_CODES` in `src/server/http/safe-error.ts`.

### Database deadlines (verbatim table)
| Variable | Default | Meaning |
| --- | --- | --- |
| `DB_CONNECT_TIMEOUT_MS` | `5000` | Time to get a pooled connection |
| `DB_STATEMENT_TIMEOUT_MS` | `15000` | Server-side `statement_timeout` for every statement |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | `30000` | `idle_in_transaction_session_timeout`; frees locks of abandoned transactions |

- `0` disables a timeout. Migrations run in separate process (`scripts/docker-entrypoint.mjs`) and are not subject to these limits. Code needing longer: open transaction and `SET LOCAL statement_timeout = '60s'` first. Pool-level errors on idle clients logged (`component: "db"`), not crash.

### Worker and scheduler
- Production publishing requires configured Dokploy app and publication-aware health URL; missing target = configuration error, not successful no-deploy release. Demo intentionally skips external deployment.
- Three independent timers, each with in-flight guard: job claiming, stale-lease recovery, scheduling of due entries.
- Claimed jobs run as tracked in-flight promises with global cap `WORKER_CONCURRENCY` (default 2); freed slot refilled immediately. A job waiting on a slow deployment (**up to 15 minutes**) delays neither scheduling, recovery, nor other sites' jobs. One job per site enforced by DB (claim SQL, partial unique indexes, leases).
- `SIGTERM`/`SIGINT`: stop claiming, wait up to `WORKER_DRAIN_TIMEOUT_MS` (default 8000) for in-flight jobs, exit (code 0 drained, 1 jobs still running; second signal exits at once).
- Keep drain value below container stop timeout (Docker default 10s; raise `stop_grace_period` for longer drains). Unfinished job keeps lease and is failed by stale-lease recovery after restart. Docker entrypoint forwards signal and waits.

### Environment variables (verbatim table, partial reference)
| Variable | Default | Meaning |
| --- | --- | --- |
| `METRICS_TOKEN` | unset | Bearer token (min 16 chars) for `/api/metrics`; unset means 404. Generate with `openssl rand -hex 32`. |
| `LOG_LEVEL` | `info` | Log threshold |
| `WORKER_CONCURRENCY` | `2` | Max build jobs processed at once by this process |
| `WORKER_DRAIN_TIMEOUT_MS` | `8000` | Shutdown wait for in-flight jobs |
| `DB_CONNECT_TIMEOUT_MS` | `5000` | See above |
| `DB_STATEMENT_TIMEOUT_MS` | `15000` | See above |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | `30000` | See above |
| `READINESS_TIMEOUT_MS` | `3000` | Per-check timeout for readiness |
| `READINESS_MAX_QUEUE_AGE_SECONDS` | `900` | Oldest queued job age that fails readiness |
| `READINESS_MAX_TICK_AGE_SECONDS` | `300` | Worker/scheduler tick age (and expired-lease age) that fails readiness |

[code] `env.ts` confirms: `WORKER_CONCURRENCY` default 2, `min(1).max(16)`; `WORKER_DRAIN_TIMEOUT_MS` default 8000; DB timeouts 5000/15000/30000; `METRICS_TOKEN` min 16; `WORKER_ENABLED` optional, transform `!== 'false'` (so **default on**).

### Stale / contradictory / incomplete (OPERATIONS)
- `WORKER_CONCURRENCY` max of 16 is in code and DECISIONS.md but not in this table.
- Missing from env table: `WORKER_ENABLED` (default true per code), `RATE_LIMIT_TRUST_PROXY`, `ALLOW_PRIVATE_HEALTH_CHECKS`, `ADMIN_MFA_REQUIRED`, `DOKPLOY_DEV_FALLBACK_ENABLED`, `DOKPLOY_ALLOW_INSECURE_HTTP`, `SETUP_TOKEN`, `APP_URL`, `S3_*`, `SMTP_*`. Defers to CONFIGURATION.md (not read).
- "Migrations run in a separate process (`scripts/docker-entrypoint.mjs`)": the entrypoint is the container CMD, which runs migrations then starts the server. "Separate" means separate from the server's DB timeouts, not a separate container. Clarify.
- Metric `areca_build_jobs_failed_total` ends in `_total` (counter convention) but is a gauge (the doc says so). Naming is confusing.
- Build log cap unit: "256 KiB (counted in characters, not bytes)" here vs "256 Ki characters" in CAPACITY.md. Pick one.
- The 15-minute deploy wait cap is stated only in passing; no env var or timeout is listed for it.
- Lease length (60s, renewed every 15s) lives in DEPLOYMENT.md; not repeated here.
- Redis: described only as rate limiting and readiness "PING". Compose uses `appendonly yes` and RECOVERY says to archive Redis to "preserve operational state". Whether Redis holds any state that matters is not clearly stated (see RECOVERY notes).
- No CPU/memory sizing guidance here (see CAPACITY).

---

## 3. docs/RECOVERY.md

**Purpose:** Overview of recovery paths. Says a database copy alone is NOT a complete backup: S3 objects and encryption keys are also needed.

**Audience:** Self-hosting operator.

### Key rule (verbatim intent)
- The repository does not schedule backups automatically. Keep protected copies off the CMS host and rehearse restores.

### Whole-instance recovery
- Docker Compose deployment: follow [docker/RECOVERY.md](../docker/RECOVERY.md). Backup stops the Compose project while capturing PostgreSQL, RustFS, Redis, env file, and pinned image details; plan for outage.
- Restore into a new project and empty volumes; verify data and assets; keep source archive unchanged until recovered instance accepted.
- Managed PostgreSQL / object storage: provider snapshots coordinated within one **no-writes window**: stop all CMS/worker writers, capture both services and matching configuration/encryption keys, restore together. Coordinate with provider for service-specific steps.
- Before migrations: use a coordinated backup and keep previous image reference. Never point older code at a DB already migrated by newer release (UPGRADES.md).

### Move one organization
- Versioned organization export/import, detailed in docker/RECOVERY.md.
- Runs from `apps/cms` with configured DB and S3 access; no Docker needed. Stop CMS and worker writes, set `ARECA_WRITES_STOPPED=1`, then `authoring-transfer.mjs export` and offline import. Import into isolated destination first.
- Bundle contains: org content and history, asset bytes, memberships, invitations, audit history, encrypted deployment credentials. Does NOT copy user accounts, passwords, sessions, or other orgs; provision matching destination users first. Imported sites in demo mode with rotated site credentials and no deployment targets. Does not replace full-instance backup.

### Retained media cleanup
- Assets protected while referenced by drafts, revisions, publication snapshots, deleted-content archives. Do not remove storage objects manually while referenced. See ASSET_RETENTION.md.

### Stale / contradictory / incomplete (RECOVERY, docs)
- No recommended backup cadence, retention, or encryption-at-rest guidance; repo explicitly leaves cadence to operator. Gap for a public ops guide.
- Managed-service path gives no concrete steps (acknowledged, "coordinate with provider").
- Bundle encryption key: "encrypted deployment credentials" is listed, but whether the key ships in the bundle is unclear (see docker/RECOVERY.md note).

---

## 4. docs/UPGRADES.md

**Purpose:** Explains forward-only migrations, upgrade rules, the upgrade procedure, rollback, and a staging checklist.

**Audience:** Self-hosting operator.

### Key statement (verbatim)
> Database migrations are **forward-only**. There is no down migration, so the way back from a bad upgrade is the pre-upgrade backup plus the previous image.

### How migrations run
Image starts through `apps/cms/scripts/docker-entrypoint.mjs`, which on every container start:
1. waits for PostgreSQL,
2. applies pending Drizzle migrations from `drizzle/` (recorded in `drizzle.__drizzle_migrations`),
3. creates the S3 bucket if missing,
4. starts the server (and, unless `WORKER_ENABLED=false`, the publish worker and scheduler in the same process).

- Migrations apply automatically the first time a new image starts. A failed migration stops the container before the server starts. Treat failed migration as requiring restore unless verified nothing applied.
- Migrations wrapped in PostgreSQL advisory lock (`scripts/lib/migration-lock.mjs`). Concurrent starts: one migrates, others wait **up to 10 minutes**, then find nothing. Lock protects migration step only; does NOT make rolling upgrades safe.

### Rules (verbatim commands/values)
- **One schema version at a time.** Stop every old replica and worker before starting new image; start a single new instance and wait until `/api/health` is healthy (migrations done) before scaling out. Extra replicas: start with `WORKER_ENABLED=false` so only one process runs publish worker.
- **Back up first, every time.** Coordinated backup per docker/RECOVERY.md#coordinated-full-instance-backup; keep until upgrade accepted.
- **Pin the image.** Production must not follow `latest`. Set `CMS_IMAGE` to `ghcr.io/<owner>/areca-cms:sha-<full-commit-sha>` or digest `...areca-cms@sha256:<digest>`. Record tag/digest before and after each upgrade (rollback target). Third-party images pinned: PostgreSQL 17, Redis 8, RustFS, Mailpit. Upgrade as separate deliberate changes. PostgreSQL major upgrade needs dump/restore, not image swap.
- **Keep secrets stable.** Do not change `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` or `BETTER_AUTH_SECRET` during upgrade. Keep `AI_SETTINGS_ENCRYPTION_KEY` stable if OpenRouter configured.
- **Read release migration notes** (e.g. HIGH_RISK_UPGRADE.md). Some migrations freeze schedules or fail interrupted jobs and ask for manual review.

### Data corrections in migrations
- `0012_was_live_correction` (rollback eligibility): old backfill in `0001_cheerful_tusk` marked every `superseded` release as was-live. After upgrade, a release loses rollback option only if NO evidence it was deployed: no `deployed_at`, status other than `live`, `rolled_back` or `demo`, not demo-mode, and no succeeded build job. Live and demo rows never touched. Releases with evidence keep `was_live` (some historic false positives may remain; a deployed release whose job history was pruned would lose rollback). Check rollback lists after upgrade. Data not deleted; safe to re-run.
- `0010`/`0011` additive (`audit_log.organization_id` becomes nullable for instance-level events; `invitation` gains delivery-tracking columns).
- `0016_ai_settings_and_site_prompt`: adds singleton AI settings table and optional per-site SEO prompt. No content rewrite. Retain `AI_SETTINGS_ENCRYPTION_KEY` with backups if provider key configured.

### Procedure (verbatim commands)
1. **Choose target.** Note current image (tag/digest) and target `sha-` tag. Confirm commit's CI run (typecheck, unit tests, secret scans) passed.
2. **Back up production:** `node docker/recovery.mjs backup ...` (stops stack while capturing PostgreSQL, S3, Redis; restart original instance; copy archive off host).
3. **Rehearse on restored copy:** `node docker/recovery.mjs restore ...` into new isolated project name (new volumes, other host ports, outbound deployments blocked, different `APP_URL` as described in RECOVERY.md). Point `CMS_IMAGE` at target image and start. Check:
   - container healthy and log shows `database migrations applied`,
   - sign in, open unpublished draft, a revision and a live snapshot,
   - serve an uploaded asset,
   - row counts for organizations, sites, entries, revisions, publications and jobs match source; no stuck job,
   - note migration duration (maintenance window).
   - Discard rehearsal only after: `docker compose -p <name> down --volumes`.
4. **Announce maintenance window**; stop production stack (or every CMS container and worker). Confirm nothing else writes to DB.
5. **Upgrade:** update `CMS_IMAGE`, then:
   ```
   docker compose pull && docker compose up -d --wait
   ```
   First container to start migrates; watch `docker compose logs -f cms`.
6. **Verify** with rehearsal checks. On isolated site, select Demo mode to verify snapshot publishing, or configure separate Dokploy app and health URL for Production. Re-enable additional replicas and workers last.
7. **Keep** backup and previous image reference until release has run through at least one normal publishing cycle.

### Rollback
1. Stop every CMS container and worker.
2. Restore pre-upgrade backup into **new** volumes (`node docker/recovery.mjs restore ...`), or original project after removing its volumes, using the **previous** image tag/digest recorded in backup's pinned-image override.
3. Start, verify, cut over.
4. Anything written after backup (edits, uploads, publications) is not in restored copy. Export first with org export (RECOVERY.md) and reapply, or fix forward.
- Never point older image at DB a newer image has migrated.
- If only the application misbehaves and migration was purely additive, release notes may say fix-forward is safe; otherwise restore.

### Staging checklist (verbatim)
- [ ] Target `sha-` tag or digest chosen and its CI run is green.
- [ ] Release notes and migration notes read (`drizzle/` diff, upgrade docs).
- [ ] Fresh backup taken, copied off host, restore command tested before.
- [ ] Rehearsal on restored copy with target image: migration time noted, checks passed, no stuck jobs.
- [ ] Maintenance window agreed; old replicas and workers stopped.
- [ ] Image pinned in compose file / environment (no `latest`).
- [ ] Exactly one new instance started first; migrations logged as applied.
- [ ] Health, sign-in, draft, asset, and a demo publish verified.
- [ ] Extra replicas started with `WORKER_ENABLED=false`; one worker only.
- [ ] Previous image reference and backup retained for rollback.

### Stale / contradictory / incomplete (UPGRADES)
- **Contradiction (replicas):** this doc treats extra replicas as a supported pattern (`WORKER_ENABLED=false`), while CAPACITY.md says the supported envelope is **one** replica and "do not scale the CMS horizontally without reviewing" in-memory state. OPERATIONS.md talks about per-process heartbeats "with several replicas". Needs a single supported statement.
- **Migration documentation is partial.** Only 0010, 0011, 0012, 0016 are described here; 0007 and 0008 in HIGH_RISK_UPGRADE.md. Migrations 0009, 0013, 0014, 0015 exist in `apps/cms/drizzle/` but are not described anywhere in my sources. [code] verified files exist.
- **`docker compose up -d --wait`** waits on health: the image HEALTHCHECK (`/api/health`, start-period 60s) makes this meaningful [code]. But the doc does not say so, and `compose.yml` itself has no `cms` healthcheck.
- Log string `database migrations applied` is quoted as the success signal. Not verified in my reads; check `scripts/docker-entrypoint.mjs`.
- Rehearsal step "outbound deployments blocked" has no mechanism described; RECOVERY.md does not explain how to block them.
- "A different `APP_URL` as described in RECOVERY.md": RECOVERY.md does not describe this as a rehearsal step for `APP_URL`; it covers `APP_URL` only in the authoring import context.
- PostgreSQL major version upgrade: "needs dump/restore" with no procedure.
- `CMS_IMAGE` default in compose is `ghcr.io/seirai-dev/areca-cms:latest` (compose.yml line 5). The "do not follow latest" rule is enforced only by the operator setting `CMS_IMAGE`. Consider calling this out.
- The `ghcr.io/<owner>/` placeholder vs the concrete `ghcr.io/seirai-dev/areca-cms` in docker/README.md and compose.yml.
- No version numbering or changelog location; releases are identified by `sha-` tags only.
- Migration numbering and rollback rules for pre-0007 installs are not described.

---

## 5. docs/HIGH_RISK_UPGRADE.md

**Purpose:** Release-specific upgrade notes for ten highest-risk audit findings, applied through migrations `0007` and `0008`, plus behaviour changes (approved-version model, token split, expected-version saves, asset retention, org export/import).

**Audience:** Operator of an existing pre-release Areca instance (upgrading into this release). Also contributor reading the validation record.

### Procedure (numbered, verbatim intent)
1. Take coordinated database/object/key backup per the recovery runbook. **Stop every CMS and publishing worker before applying migrations**; old workers cannot use new leases and approved-version model.
2. Apply migrations `0007` and `0008` "with the existing deployment migration command". `0007` backfills approved slugs from approved content, freezes legacy schedules, fails interrupted active jobs, coalesces duplicate queued jobs before installing queue uniqueness indexes. Review legacy scheduled drafts before enabling workers (migration can only freeze current stored draft). Previously leaked approved slugs recoverable only if approved content still contains its slug.
3. Production is default site mode. Configure Dokploy app and health endpoint returning the actual publication ID before publishing. Explicit demo sites create labeled demo publications. Retry releases interrupted by migration after verifying deployment state.
4. Existing build tokens remain valid for reading content and manifests, but cannot POST manifests. Rotate separate schema-write token in Developer settings; configure `ARECA_SCHEMA_TOKEN` only in schema integration. Collection and field keys must satisfy new identifier rules; rename invalid legacy identifiers deliberately before syncing or pulling.
5. Owners approve entire version including slug. Scheduling freezes that version and keeps previous approved content eligible until due. Later edits remain drafts; inspect approved scheduled version before rescheduling. Deployment completion promotes only matching scheduled identities captured by that publication.
6. Editors save with expected draft version. Stale save pauses with conflict; reload current version or explicitly reapply recovered draft. Browser-local buffers scoped to user/site/collection/entry. Save timeouts keep navigation blocked unless user explicitly leaves.
7. All retained revisions/publications and deleted-content archives protect referenced assets, including legacy rich-text image URLs. Explicit org deletion removes that org's retained history and queues its object cleanup. Retry storage cleanup per ASSET_RETENTION.md.
8. Exercise full restore and org export/import on isolated instance before relying on recovery. Org imports preserve authoring history and asset bytes, map permissions to provisioned destination users, begin as offline demo sites; original deployment/integration eligibility not replayed.

### Validation record (point in time, 2026-10-01)
- CMS: 40 test files / 209 tests passed; TypeScript check and production build passed.
- Site SDK: 94 tests passed; TypeScript and build passed.
- Authoring bundle validation: 6 tests passed; export/import preserved draft/approved/scheduled versions, revisions, deletion archives, mapped permissions, exact asset bytes.
- Recovery configuration: 3 tests passed; coordinated cold backup restored authoring tables, permissions, approved/scheduled versions, a real S3 object, and an encrypted credential decrypted with preserved key. Restore passed with conflicting ambient S3 credentials.
- Upgrade migration tested against legacy slug data and duplicated queued/active jobs.
- Authenticated sign-in and settings SSR HTTP 200; anonymous snapshot access HTTP 401. Interactive browser verification blocked by collaborative-preview navigation failures. **No real Dokploy deployment was triggered.**
- Targeted ESLint still reports `no-unnecessary-condition` findings around DB-row existence checks; no clean-lint claim made.

### Stale / contradictory / incomplete (HIGH_RISK)
- **Dangling reference:** cites `CMS_AUDIT.md` ("Highest-risk confirmed findings"). The file exists at repo root `CMS_AUDIT.md`, not `docs/CMS_AUDIT.md`. Also AUTHZ_MATRIX cites "audit 8.3". Decide whether the audit is public; it is an internal document.
- Step 2 says "the existing deployment migration command" but never names it. UPGRADES says migrations apply automatically on container start. Clarify whether a separate command is needed.
- Step 3: "Retry releases interrupted by migration after verifying deployment state": no command or UI path given.
- Step 4: "Collection and field keys must satisfy the new identifier rules": the rules are not stated in any in-scope file. Needs a link to CONTENT_SCHEMA.md or the SDK doc, or the rules themselves.
- Step 4: "rename invalid legacy identifiers deliberately": no procedure.
- Terminology: "approve" (this doc) vs "Mark as ready" (DECISIONS.md, UI) vs `publishEntryFn` (AUTHZ). Also DB columns `publishedSlug`/`publishedData` hold the approved version. Glossary needed.
- Validation record is dated 2026-10-01 and explicitly says real deployment verification is still required. Must not be presented as current status.
- "Stop every CMS and publishing worker" here vs UPGRADES "one schema version at a time" consistent; OK.
- Release-specific: no link to the release or tag this applies to.

---

## 6. docs/CAPACITY.md

**Purpose:** Supported envelope (sites, entries, assets, replicas, latency targets, upload size), benchmark method and results, known limits, scaling triggers.

**Audience:** Operator (sizing), contributor (benchmark).

### Targets (verbatim table)
| Dimension | Target |
| --- | --- |
| Sites | up to 50 |
| Entries per site | up to 2,000 |
| Assets per organization | up to 10,000 |
| CMS replicas | 1 |
| Release snapshot build (largest) | p95 < 10 s |
| Editor list/search endpoints | p95 < 500 ms |
| Upload size | 20 MiB per file (enforced in the route and service) |

- Sized for "a small agency running a **single CMS replica**." Normal content pages consume a published snapshot at build time; CMS traffic also includes SDK pulls, draft previews, operations checks, public asset requests.

### Benchmark methodology
- `apps/cms/scripts/benchmark.ts` seeds synthetic dataset via Drizzle; measures app code, not HTTP.
- Dataset scale 1: 5 orgs × 10 sites = 50 sites; each has collections `authors`, `articles`. Largest site: 2,000 entries (rich-text body with 2 embedded images, 2 image fields, author and related refs, select/boolean/datetime, ~10% drafts), 5 revisions per entry. Other sites: 100 entries, 2 revisions. Largest org: 10,000 assets; others 500. Each site 3 publications (largest 10).
- Scenarios: `buildSnapshot` (largest site), `listEntries` (first page, deep page, status filter, search), `listAssets` (first, deep, search), `buildPreviewEntry`, `assetUsage`.
- Statistics: one warm-up, N runs (default 7); p50, p95, max; peak RSS and heap growth. For memory numbers: seed with `--keep`, measure in second process with `--skip-seed`.

Safety: refuses to run unless BOTH `ARECA_BENCHMARK=1` AND database name contains `bench` or `test`. Never reads `.env.local`; DB must be passed with `--database-url` (or `DATABASE_URL`). Data lives in orgs with slug prefix `bench-`; removed before seeding and after run (unless `--keep`). Does not use S3, Redis or SMTP.

Commands (verbatim):
```sh
# a throwaway Postgres
docker run -d --name areca-bench-pg -e POSTGRES_USER=bench -e POSTGRES_PASSWORD=bench \
  -e POSTGRES_DB=areca_bench -p 55444:5432 postgres:17-alpine
export DATABASE_URL=postgres://bench:bench@localhost:55444/areca_bench
cd apps/cms
pnpm db:migrate                       # apply the schema to the throwaway DB
ARECA_BENCHMARK=1 pnpm bench --keep --json /tmp/bench.json   # seed + measure
ARECA_BENCHMARK=1 pnpm bench --skip-seed --keep              # re-measure, clean memory numbers
docker rm -f areca-bench-pg
```
Flags: `--scale <n>` (0.1 smoke), `--runs <n>`, `--json <file>`, `--keep`, `--skip-seed`. Output: markdown table on stdout.
- [code] `bench` and `db:migrate` scripts exist in `apps/cms/package.json`.

### Measured results
Machine: Apple M4 (10 cores, 16 GB), macOS, Node 24.21, PostgreSQL 17.11 in local Docker (DB latency ~0). Scale 1, 10 runs. Dataset: 6,900 entries, 19,800 revisions, 12,000 assets, 157 publications. Table sizes (incl. TOAST and indexes): entry 20 MB, entry_revision 31 MB, publication 66 MB, asset 4 MB. Largest site snapshot ~22 MB JSON.

Table (verbatim):
| Scenario | Before p50 / p95 (ms) | After p50 / p95 (ms) |
| --- | ---: | ---: |
| snapshot build (largest site) | 5,949 / 7,984 | 499 / 504 |
| entry list, page 1 (50) | 5 / 5 | 5 / 11 |
| entry list, deep page (offset 1,500) | 5 / 6 | 4 / 5 |
| entry list, status filter | 3 / 3 | 2 / 2 |
| entry search (slug and body text) | 158 / 168 | 145 / 149 |
| asset list, page 1 (50) | 2 / 2 | 2 / 2 |
| asset list, deep page | 5 / 5 | 5 / 5 |
| asset search | 7 / 7 | 7 / 7 |
| preview entry build | 5 / 6 | 4 / 6 |
| asset usage check (referenced asset) | 4,068 / 4,156 | 4,127 / 4,413 |

- Snapshot build heap growth ~175–205 MB; process peak RSS ~700–830 MB (largest site).
- Asset usage check heap growth dropped ~132 MB → 14–65 MB, no wall-time change.
- What changed: snapshot build now batches asset lookups (`loadAssetLookup`, `inArray`) rather than ~10,000 per-row round trips; asset usage check filters in SQL then walks candidates only.

### Known limits (verbatim intent)
- **Revision history unbounded**: `entry_revision` grows on every save; no pruning. Second largest table.
- **Publications keep full snapshots**: ~22 MB JSON for 2,000 entries (~6 MB compressed in TOAST); retention multiplies by number of retained releases; asset deletion scans all.
- **Snapshot built in memory** as one object (~200 MB heap for 2,000 entries with rich text). Keep Node heap "comfortably above 1 GB."
- **Search textual**: `ILIKE` over `draft_data::text`; sequential scan (~150 ms at 2,000 entries); no full-text index.
- **Asset usage is a scan**: no reference table; each delete/usage lookup O(all content in org), serialized by org-wide advisory lock.
- **Uploads buffered**: multipart body and original file held in memory (also passed to `sharp` and S3 client). 20 MiB per file, so a handful of concurrent uploads can use hundreds of MB. Assets served by streaming through CMS, not redirected to S3.
- **Single replica only**: publish serialization relies on DB uniqueness and leases (cross-process), but in-process worker/scheduler ticks, rate limiting and other in-memory state designed for one replica. Do not scale horizontally without review.
- **Build logs capped**: each line redacted and cut at 8 KiB; `build_job.logs` limited to 256 Ki characters (newest content kept behind `[truncated]`).

### Scaling beyond target (verbatim triggers → responses)
- Snapshot p95 approaching 10 s or memory pressure → reduce retained publications, increase Node heap, then stream snapshot to storage.
- Entry search p95 approaching 500 ms → generated `tsvector` (or trigram GIN) index.
- Asset usage check several seconds or asset libraries beyond ~10,000 → `asset_reference` table (asset id, owner type, owner id) maintained on writes.
- Revision table size → cap/prune per entry (e.g. keep newest 50 plus labeled), archive rest.
- Upload concurrency or larger files → presigned or multipart uploads.
- More than one replica → move scheduler/worker ticks to leased single runner or dedicated worker process; back rate limiting and caches with shared stores.
- Remote DB → measure with real latency.

### Stale / contradictory / incomplete (CAPACITY)
- **Contradiction (replicas)**: see UPGRADES.md section above.
- Heap sizing: "keep Node's heap comfortably above 1 GB" but no env var, `NODE_OPTIONS` or compose setting is documented. [code/compose] `compose.yml` sets no `NODE_OPTIONS`.
- Measurement date and commit are not recorded. Node 24.21 and PostgreSQL 17.11 are recorded; the app commit and date are not.
- Build log cap unit mismatch with OPERATIONS.md (see OPERATIONS section).
- "Editor list/search endpoints p95 < 500 ms" target has no measured number for an HTTP path; the benchmark measures code, not HTTP (stated).
- Benchmark "After" column says "no change in wall time" for asset usage check (4,127 vs 4,068 p50), which is slightly slower at p50 and p95. Reword if quoted.
- Sizing guidance (CPU, memory of the container, Postgres sizing) is absent beyond the heap note.

---

## 7. docs/ASSET_RETENTION.md

**Purpose:** Explains why assets stay protected, what archives preserve, what explicit org deletion does, and how to retry object cleanup.

**Audience:** Operator, agency admin.

### Rules (verbatim intent)
- Assets remain protected while any draft, approved or scheduled version, revision, publication snapshot, or deleted-content archive references them. Includes legacy rich-text images stored as `/api/assets/file/<storage-key>` URLs. Removing an image from latest draft does not make a historically used image deletable.
- Deleting an entry, collection, or site removes it from active authoring but preserves authoring versions and revisions in `deleted_content_archive`. Site archives preserve collection definitions, publications, and build history. Archives belong to the org, included in its versioned authoring export. **No automatic history expiration or archive purge.** Asset deletion remains blocked by references in these archives.
- Explicitly deleting an organization removes its archives and asset DB rows. Asset object keys first recorded in durable `storage_object_deletion` table, which survives org deletion. Storage failures leave records for retry. **Organization must have no active sites before deletion.**

### Cleanup command (verbatim)
```sh
cd apps/cms
node --env-file=.env.local scripts/cleanup-assets.mjs
```
- Processes up to **1,000 objects per invocation**; operator may schedule. Successful deletes clear records; failed deletes remain with diagnostic error.
- Uploads compensate failed DB inserts by deleting just-uploaded object, or recording its storage key for cleanup if that deletion fails and DB reachable.
- [code] `scripts/cleanup-assets.mjs` exists.

### Stale / contradictory / incomplete (ASSET_RETENTION)
- **Contradiction with DEPLOYMENT.md** on retracting public URLs (see DEPLOYMENT section). A referenced asset cannot be deleted, so "deleting the asset" is not a route to retract a publicly shared URL once it is in any publication, revision, draft or archive. Need a documented answer (e.g., remove from every version, then delete, or a "purge" procedure, or accept it as not retractable).
- Scheduling of cleanup: "operator can schedule" with no example (no cron/systemd/compose example).
- Org deletion requires no active sites: UI path not described.
- Cleanup runs against "the same storage and database configuration as the CMS" but the doc uses `--env-file=.env.local` which is a dev convention. For Docker deployments, the equivalent (`docker compose exec`, env) is not shown. docker/RECOVERY.md has the same command with the same issue.
- Not stated: whether an org deletion is reversible (it is not, from the text), and whether a `storage_object_deletion` record survives a full-instance restore (docker/RECOVERY says yes).

---

## 8. docs/AUTHZ_MATRIX.md

**Purpose:** Source-of-truth description of authorization: roles, actors, policies, every server function and HTTP route, error shapes, no-existence-oracle rule.

**Audience:** Contributor (primary), security reviewer, operator (role rules).

Source: `apps/cms/src/server/security/authz-matrix.ts` (data) executed by `authz-matrix.test.ts` and `authz-routes.test.ts` against real PostgreSQL, two tenants, bypassing UI. Adding a server function or `src/routes/api/**` file without matrix entry fails inventory tests.

### Role precedence
- agency admin > org owner > org editor.
- Agency admins must have two-factor (`MFA_REQUIRED` otherwise).
- Step-up actions need a session created or re-verified in the **last ten minutes** (`REAUTH_REQUIRED`).

### Actors (verbatim table)
| Actor | Meaning |
| --- | --- |
| anonymous | no session |
| editorX | editor of org X |
| ownerX | owner of org X |
| ownerY | owner of an unrelated org Y (cross-tenant caller; targets X data) |
| adminNoMfa | agency admin without two-factor |
| adminMfa | agency admin with two-factor, fresh session |
| adminStale | agency admin with two-factor, session 30 min old, no re-verification |

### Policies (verbatim table)
| Policy | anonymous | editorX | ownerX | ownerY | adminNoMfa | adminMfa | adminStale |
| --- | --- | --- | --- | --- | --- | --- | --- |
| public | allow | allow | allow | allow | allow | allow | allow |
| user | redirect /login | allow | allow | allow | allow | allow | allow |
| org-editor | redirect /login | allow | allow | 403 | MFA_REQUIRED | allow | allow |
| org-owner | redirect /login | 403 | allow | 403 | MFA_REQUIRED | allow | allow |
| agency | redirect /login | 403 | 403 | 403 | MFA_REQUIRED | allow | allow |
| agency-fresh | redirect /login | 403 | 403 | 403 | MFA_REQUIRED | allow | REAUTH_REQUIRED |

- Denied calls must (a) return no result and (b) leave target unchanged (side-effect probe per row).

### Server functions (verbatim table, all rows)
| Function | File | Policy | Who may call |
| --- | --- | --- | --- |
| `listOrganizationsFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `createOrganizationFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `updateOrganizationFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `deleteOrganizationFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `getDokployCredentialStatusFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `saveDokployCredentialsFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `verifyDokployCredentialsFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `removeDokployCredentialsFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `listSitesFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `getSiteFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `createSiteFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `updateSiteFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `rotateSiteTokenFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up); rotates build or schema token per `privilege` |
| `deleteSiteFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `listMembersFn` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `updateMemberRoleFn` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `removeMemberFn` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `inviteMemberFn` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `listInvitationsFn` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `revokeInvitationFn` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `resendInvitationFn` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `listAuditLogFn (organizationId)` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `listAuditLogFn (instance-wide)` | `admin.ts` | `agency` | agency admin (MFA) |
| `setAgencyAdminFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `listUsersFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `listCollectionsFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `listEntriesFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `getEntryFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `createEntryFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `updateDraftFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `publishEntryFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `unpublishEntryFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `archiveEntryFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `cancelScheduleFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `scheduleEntryFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `deleteEntryFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `listRevisionsFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `restoreRevisionFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `getPreviewUrlFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `upsertCollectionFn` | `content.ts` | `agency` | agency admin (MFA) |
| `deleteCollectionFn` | `content.ts` | `agency` | agency admin (MFA) |
| `listAssetsFn` | `assets.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `getAssetFn` | `assets.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `updateAssetFn` | `assets.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `deleteAssetFn` | `assets.ts` | `org-owner` | org owner, agency admin (MFA) |
| `requestPublicationFn` | `publishing.ts` | `org-owner` | org owner, agency admin (MFA) |
| `requestRollbackFn` | `publishing.ts` | `org-owner` | org owner, agency admin (MFA) |
| `listPublicationsFn` | `publishing.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `listBuildJobsFn` | `publishing.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `getBuildJobFn` | `publishing.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `cancelJobFn` | `publishing.ts` | `org-owner` | org owner, agency admin (MFA) |
| `reconcileDeploymentJobFn` | `publishing.ts` | `org-owner` | org owner, agency admin (MFA) |
| `resolveUncertainDeploymentJobFn` | `publishing.ts` | `agency` | agency admin (MFA); reason and upstream-stop confirmation required |
| `getSiteReleaseStatusFn` | `publishing.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `getBrandingFn` | `branding.ts` | `public` | anyone |
| `updateBrandingFn` | `branding.ts` | `agency` | agency admin (MFA) |
| `clearBrandingImageFn` | `branding.ts` | `agency` | agency admin (MFA) |
| `resetBrandingFn` | `branding.ts` | `agency` | agency admin (MFA) |
| `getAiSettingsFn` | `ai.ts` | `agency` | agency admin (MFA); never returns the API key |
| `saveAiSettingsFn` | `ai.ts` | `agency` | agency admin (MFA); `agency-fresh` when API key set or removed |
| `listAiModelsFn` | `ai.ts` | `agency` | agency admin (MFA) |
| `getAiAvailabilityFn` | `ai.ts` | `user` | any signed-in user (boolean only) |
| `generateEntrySeoFn` | `ai.ts` | `org-editor` | org member (editor/owner) or agency admin; NotFound outside org; 30/hour per user |
| `verifyStepUpFn` | `security.ts` | `user` | any signed-in user |
| `getAuthMethodsFn` | `auth-methods.ts` | `public` | anyone |
| `getSetupStatusFn` | `setup.ts` | `public` | anyone |
| `completeSetupFn` | `setup.ts` | `public` | anyone |
| `getMeFn` | `me.ts` | `public` | anyone |
| `getInvitationFn` | `me.ts` | `public` | anyone |
| `acceptInvitationFn` | `me.ts` | `user` | any signed-in user |
| `getSitesOverviewFn` | `overview.ts` | `user` | any signed-in user |
| `getHomeActivityFn` | `home.ts` | `user` | any signed-in user |

Per-row exceptions:
- `verifyStepUpFn` needs two-factor session (others get Forbidden; wrong codes refused).
- `completeSetupFn` open but refuses any caller without setup token.
- `getMeFn`, `getSitesOverviewFn`, `getHomeActivityFn` return only caller's own tenant data (asserted in cross-tenant tests).
- `getInvitationFn` and `acceptInvitationFn` authorized by unguessable, unexpired, unaccepted token (+ matching email for accept).

### HTTP routes (verbatim table)
| Route | Method | Credential | Expected |
| --- | --- | --- | --- |
| `/api/assets/upload` | POST | session | 401 anon; 403 other-org member; 403 `MFA_REQUIRED` admin without 2FA; editor/owner of target org and admins pass |
| `/api/admin/branding/upload` | POST | session | 401 anon; 403 editor/owner; 403 `MFA_REQUIRED`; admin passes |
| `/api/assets/file/$prefix/$filename` | GET, OPTIONS | none | public by design (see audit 8.3 on public assets) |
| `/api/auth/$` | GET, POST | Better Auth | delegated to Better Auth |
| `/api/health`, `/api/health/ready` | GET | none | public |
| `/api/metrics` | GET | `METRICS_TOKEN` bearer | 404 when unset; 401 wrong/missing |
| `/api/sites/manifest` | GET | site **build** token | 401 for none/garbage/schema token; only own site's schema |
| `/api/sites/manifest` | POST | site **schema** token | 401 for build token; writes only the token's own site |
| `/api/sites/snapshot/current` | GET | site build token | 401 for schema token; only own publication |
| `/api/sites/preview` | GET | HMAC preview token | 401 expired/tampered/foreign-secret/unknown site; 404 for another site's slug |

### Error shape
- Server functions behind `sanitizeErrorsMiddleware` (`src/start.ts`): typed `AppError`s, `Response`s, redirects, `MFA_REQUIRED`/`REAUTH_REQUIRED` pass through; everything else becomes `Something went wrong (ref: <id>)`.

### No existence oracle
- Rows addressed by site, entry, asset, build job or invitation id: authenticate first, then same NotFound for missing id and for other tenant's id (`requireOrgMemberOrNotFound` in `session.server.ts`).
- `getAssetFn` returns `null` in both cases.
- Member with too-low role (editor on owner action) still gets 403 (already knows object exists). In matrix these rows are `hidden: true`, so ownerY expects `not-found`.
- Org-id-addressed calls (`listAssetsFn`, member/invitation/audit functions) answer 403 for non-members, identically for existing and missing orgs.

### Notes
- Org owners cannot change their own collection schema (agency-only), by design.
- `deleteSiteFn` is step-up like deleting an org (UI uses `useStepUp().run`).
- Six rows still tolerate non-authz failure for allowed callers: three Dokploy credential calls (outbound network), `verifyStepUpFn` (wrong code), `getInvitationFn`/`acceptInvitationFn` (unknown token probe).

### Stale / contradictory / incomplete (AUTHZ)
- `updateSiteFn` is `agency` (no step-up) yet it sets deployment target (applicationId, health URL) and production URL. Confirm that is intended; DEPLOYMENT.md does not say.
- `saveAiSettingsFn` step-up only when API key set/removed; DEPLOYMENT.md step-up list omits this.
- `generateEntrySeoFn` lets **editors** send entry content and selected images to the external OpenRouter provider (DECISIONS.md). AUTHZ row does not mention the data disclosure. Public docs should.
- `/api/assets/file/...` public by design; the "audit 8.3" reference points to the internal `CMS_AUDIT.md`, which is not in docs/.
- Matrix describes `verifyStepUpFn` as `user` policy but requires a 2FA session; mismatch is intentional per the note, but it is a special case.
- `/api/sites/manifest` GET: build token "only own site's schema". Build token reads the schema as well as content; the HIGH_RISK note says so. Consistent.
- Test filenames cited (`authz-matrix.test.ts`, `authz-routes.test.ts`) were not verified in this pass.
- Matrix has no row for `/api/sites/snapshot/current` for an org editor or owner (only the site token). Fine, but state it explicitly in public docs (no human access to snapshot endpoint).

---

## 9. docs/DECISIONS.md

**Purpose:** Concrete architecture decisions "read before working": build-time CMS model, publishing flow, domain model, roles, site integration, SEO assist, Dokploy adapter.

**Audience:** Contributor. Partly useful for public "How it works" page.

### Principles (verbatim)
- KISS / YAGNI. No plugin system, no GraphQL, no visual builder, no multi-framework support.
- Adapters are plain internal TypeScript interfaces (`DeploymentAdapter`, `AssetStorageAdapter`). Core domain code must not import Dokploy or S3 clients directly.
- Single language content. Paraglide provides UI strings (en/nl/tr); authored content is not translated by the CMS.
- Always `pnpm`. "Windows dev machine (PowerShell): never chain with `&&` in scripts that run on Windows; use separate commands or `;`."

### Repository layout (verbatim)
```
apps/cms              TanStack Start app: CMS UI + API + in-process worker/scheduler
packages/site-sdk     @areca-cms/site-sdk: schema, manifest, snapshot pull/read, preview and SEO helpers
examples/demo-site    TanStack Start customer site using the SDK (articles), prerendered, deployed to Dokploy
docker/compose.yml    PostgreSQL, Redis, RustFS (S3-compatible), Mailpit
```

### Stack
TanStack Start (React 19, Vite 8, TypeScript 6), TanStack Router file routes, TanStack Query. Drizzle ORM + PostgreSQL (`pg`). better-auth (email/password, OAuth/SSO, sessions, 2FA). Radix + Tailwind v4 (`apps/cms/src/components/ui`). Tiptap rich text (ProseMirror JSON with allowlist). Zod v4. Vitest, Playwright. S3 API (`@aws-sdk/client-s3`) with RustFS locally; `sharp`. Paraglide. OpenRouter through TanStack AI for optional SEO. Email: nodemailer → Mailpit locally.

### Domain model (key facts)
- `organization` (agency clients). `dokploy_credential` (encrypted API key; server-only; cascade-deleted with org).
- `membership` roles: `owner|editor`. Agency staff: `user.isAgencyAdmin = true`; require 2FA for admin ops.
- `site`: includes hashed read token, separate hashed schema-write token, productionUrl, previewSecret, `publishingMode: production|demo`, deployment target JSON `{ provider: 'dokploy', applicationId, healthCheckUrl }`, lastManifest, optional site AI prompt.
- `collection`: synced from manifest (`POST /api/sites/manifest` with schema token). Agency-owned; customers cannot edit schemas.
- `entry`: draft slug + `draftData`; approved `publishedSlug` + `publishedData`; status; version counters; optional frozen `scheduledSlug`/`scheduledData`/`scheduledVersion`; scheduledAt/time zone/actor; publishedAt.
- `entry_revision`, `deleted_content_archive`, `asset`, `publication`, `build_job`, `publication_request`, `audit_log`, `branding`, `ai_settings`, `storage_object_deletion`, `scheduler_backoff`.
- Entry SEO stored in reserved `$seo` key; resolved to `entry.seo` in snapshots. Not a customer content-model field.
- Field types: `text | textarea | richtext | image | date | datetime | select | reference | slug | boolean | number | url`.
- `build_job` priority int (higher first; "urgent" = 100); status `queued|building|validating|deploying|succeeded|failed|cancelled`.

### Publishing flow (verbatim numbered list, condensed)
1. Owner or agency admin clicks **Mark as ready** (`publishEntryFn`): copies draft data and slug into approved fields and records a revision. **Schedule** freezes current data and slug in `scheduledData`/`scheduledSlug`; later edits stay in draft. When due, snapshot includes frozen version.
2. **Go live** (`requestPublicationFn`) builds immutable snapshot `{ publicationId, siteKey, createdAt, hash, collections: { [key]: SnapshotEntry[] } }`. Rich text exported as `{ json, markdown, document, html }`; image fields resolved to stable CMS asset URLs. SEO metadata with title/description/canonical/robots/social-image/JSON-LD fallbacks. Snapshot validated against collection fields; reject on errors.
3. Enqueue `build_job`. Queued (not started) jobs for same site are cancelled (coalescing) and their publications marked `superseded`.
4. Worker: one job per site at a time; total concurrency `WORKER_CONCURRENCY` (default 2, **maximum 16**). Production: persist dispatch intent, call `DeploymentAdapter`, poll deployment, verify health URL reports expected publication id; publication becomes `live`, former live superseded. Failure leaves previous live in place. Demo: skip deployment and health verification; mark `demo`, never `live`.
5. When a successful publication consumes a due scheduled version, worker copies frozen data/slug into approved fields and clears schedule. Failed publication does not consume.
6. Rollback selects a publication that previously went production-live (`wasLive`), creates new publication record containing saved snapshot with new id, queues priority-100 job. Old snapshot hash retained; failed rollback can be retried.

### Site integration
- Dokploy builds from git. Build env: `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` (read). `ARECA_SCHEMA_TOKEN` authorizes `POST /api/sites/manifest`; "the token pair is also surfaced in Settings › Developer."
- SDK `areca pull` / `pullContent()` calls `GET /api/sites/snapshot/current` (read token). Writes to `src/generated/content/*.json`. Build fails loudly if no publication.
- Preview: CMS signs HMAC token (`previewSecret`, 1h expiry, scoped site+collection+slug). Route `/__preview/$collection/$slug?token=` calls `GET /api/sites/preview?token=`; responds `X-Robots-Tag: noindex`.
- SDK: `createArecaClient().fetchSnapshot()`, `pullContent()`, `readContent()`; no `loadContent()`. `seoHead()` maps metadata to TanStack Router head entries.

### SEO assistance
- SEO optional per entry; fallbacks resolved into snapshot. Character targets are advice; server-side bounds protect stored values "without promising search ranking or indexing."
- AI suggestions: agency-configured OpenRouter provider and model; API key encrypted server-side; agency prompt defaults extendable per site. Editor reviews and selects suggestions; **AI never marks content ready or publishes**.
- Entry content and selected images may be sent to configured model. Agency config and provider terms govern.

### Dokploy adapter
- One Dokploy URL and encrypted API key per org. Key encrypted with `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY`, never returned to browser, can only be replaced.
- Worker resolves credentials when site job starts. Global `DOKPLOY_URL`/`DOKPLOY_API_KEY` only as explicit non-production fallback with `DOKPLOY_DEV_FALLBACK_ENABLED=true`.
- `POST /api/application.deploy` carries `applicationId`, stable job title, publication/hash description. Poll `GET /api/application.one?applicationId=` for tagged deployment ID/status; GET `healthCheckUrl` expecting 200 and publication ID. Lost deploy response is reconciled, never blindly redispatched.
- Publish/rollback requests retain UUID idempotency key across lost responses. Safe reads and identical env writes have bounded retries; uncertain dispatches block subsequent site work until reconciled or explicitly resolved.
- Local Dokploy defaults are examples in `apps/cms/.env.example`.

### Roles (verbatim summary)
- **Agency admin**: everything (clients, sites, content types, people, site settings, releases of all sites); 2FA required; sensitive actions may request a fresh code.
- **Org owner**: everything in their client's sites: create/edit drafts, Mark as ready, move back to draft, schedule/cancel schedule, archive, delete, restore revisions, Go live, roll back, cancel builds, delete Library files; manage members and invitations; read client's activity.
- **Org editor**: create entries, edit and save drafts, preview, upload and describe Library files. **Cannot** mark as ready, schedule, archive, delete, restore or go live; no People, Settings or Activity.

### Stale / contradictory / incomplete (DECISIONS)
- **Hashed token vs "surfaced in Settings › Developer"**: tokens are stored hashed (`hashed read token`), yet the doc says the pair is "surfaced" in Developer settings. Need to say when plaintext is shown (creation/rotation only?) and whether it can be re-read.
- **Windows-specific rule** (`&&` and PowerShell) is contributor guidance that may be stale for a macOS-based workflow. Keep it contributor-only or drop it.
- "Single language content" plus "Paraglide (en/nl/tr)" is consistent only if UI strings are the only translated thing. Memory notes say i18n was deferred in a UI pass. Verify before stating "en/nl/tr" as current.
- Terminology: `publishedSlug`/`publishedData` store the **approved** version; "publish" in function names (`publishEntryFn`, `publicationId`) means "mark as ready" in the UI, and "publication" means the Go-live snapshot. The glossary must disambiguate "publish", "approve", "mark as ready", "go live", "publication".
- Dokploy: "Lost deploy response reconciled" and "uncertain dispatches block subsequent site work" are important for operators but have no operator procedure beyond AUTHZ's `resolveUncertainDeploymentJobFn` (agency-only, reason + upstream-stop confirmation). Operator procedure missing.
- Worker concurrency "maximum 16" is only here and in code.
- Roles list: editor "Cannot ... restore" matches AUTHZ (`restoreRevisionFn` org-owner). Consistent.
- "Agency admin: everything ... releases of all sites" consistent with AUTHZ.
- `scheduler_backoff` table: described only here; no ops doc mentions per-site retry cooldown. Operators seeing delayed scheduling need this.
- `site` data model says `productionUrl`; deployment doc says it is set to `https://<site-host>`. Consistent.

---

## 10. docker/README.md

**Purpose:** Run the CMS locally with Docker (demo stack), build the image locally, understand GHCR tags and release workflows.

**Audience:** Self-hosting operator (quickstart), contributor (image build, CI).

### Quickstart (verbatim)
```sh
cp .env.example .env
# Edit .env: generate BETTER_AUTH_SECRET with openssl rand -hex 32
# and DOKPLOY_CREDENTIALS_ENCRYPTION_KEY with openssl rand -base64 32;
# replace the demo database and S3 credentials too.
docker compose up -d --wait
```
- Values in `.env.example` are for trying the demo. Replace before shared/public use.
- `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` must be stable and backed up with PostgreSQL; required even without Dokploy.
- AI enabled: also generate and retain `AI_SETTINGS_ENCRYPTION_KEY`.
- Open `http://localhost:3000/setup`. Setup token: set `SETUP_TOKEN` (16+ chars) in `.env`, or unset and read generated token from `docker compose logs cms` (printed once, first time CMS opened while no account exists). First admin then asked to turn on 2FA.
- Database starts empty; no demo accounts seeded. Startup applies migrations and creates the `areca` bucket.
- Mailpit: `http://localhost:8025`. RustFS console: `http://localhost:9001` (use S3 credentials from `.env`).
- Example binds CMS, RustFS console, Mailpit UI to localhost; DB, Redis, S3 API ports internal. Different CMS port: update both `CMS_PORT` and `CMS_URL`. Public hosting: reverse proxy, public `CMS_URL`, real SMTP, unique service credentials.
- Agency admins need TOTP by default. Do not commit `.env`.

Ops commands (verbatim):
```sh
docker compose logs -f cms
docker compose pull && docker compose up -d --wait
docker compose down
```
- Named volumes retain DB, Redis, uploads across restarts and `down`. `docker compose down --volumes` deletes all demo data.

### Build locally (verbatim)
```sh
docker build -f apps/cms/Dockerfile -t areca-cms:local .
cd docker
CMS_IMAGE=areca-cms:local docker compose up -d --wait
```
- Dockerfile pins Node 24.21.0 and pnpm 12.8.1 ("latest stable as of 2026-10-01"). Override with `--build-arg` `NODE_VERSION` / `PNPM_VERSION`.
- Frozen lockfile; only CMS files in build context. Runtime runs as `node`, contains Nitro traced output, migrations, bundled startup script.

### GitHub Actions and image tags
- Two workflows build natively on `ubuntu-24.04` (AMD64) and `ubuntu-24.04-arm` (ARM64), separate BuildKit caches.
- AMD64 release workflow runs on matching pushes to `main`. Calls CI workflow first (typecheck, unit tests, secret scan, client bundle scan). Only if passing: builds AMD64 and reusable ARM64 in parallel; publishes shared manifest only after both succeed, using exact digests.
- Matching paths: `apps/cms/**`, root dependency configuration, Docker workflows, `.dockerignore`, `docker/**`.
- Actions tab: **CMS Docker AMD64 and multi-platform release** (both arches, shared tags). **CMS Docker ARM64** (ARM64 only; does not change shared manifest).

Tags (verbatim table under `ghcr.io/seirai-dev/areca-cms`):
| Tag | Content |
| --- | --- |
| `latest` | Both architectures, updated only from `main` |
| `latest-amd64`, `latest-arm64` | Architecture-specific images from `main` |
| `sha-<full-commit-sha>` | Both architectures for that commit |
| `sha-<full-commit-sha>-amd64`, `sha-<full-commit-sha>-arm64` | A specific commit and architecture |

- Manual runs on other branches publish only commit tags. Use digest for registry-enforced immutability.
- Uses `GITHUB_TOKEN` with `packages: write`; links package via OCI source label. No extra registry secret.
- After first publish: Packages → Package settings → Change visibility → **Public** so visitors can pull without login (GitHub defaults container packages to private).
- `latest` for trying demo; for anything that matters set `CMS_IMAGE` to `sha-<full-commit-sha>` or digest.

### Stale / contradictory / incomplete (docker/README)
- Setup token: "printed once, the first time the CMS is opened" vs DEPLOYMENT.md "changes on every restart". Both can be true (new token per restart), but docs should say so explicitly.
- Compose binds the CMS to `127.0.0.1` only (`127.0.0.1:${CMS_PORT:-3000}:3000`). DEPLOYMENT.md requires the CMS to be reachable from the Dokploy host on LAN IP. These two are incompatible without a reverse proxy or a different binding. Say so in the self-hosting guide.
- `docker compose up -d --wait` uses the image HEALTHCHECK [code] (see UPGRADES). Document that.
- Pinned versions dated ("latest stable as of 2026-10-01"): will go stale.
- "Only CMS files enter the build context" vs `.dockerignore` (not read).
- Workflow paths and CI names are GitHub-specific; `.github/workflows/ci.yml` exists [code] but was not read.

---

## 11. docker/RECOVERY.md

**Purpose:** Detailed recovery runbook for the Compose stack: full-instance coordinated backup, isolated restore, versioned org authoring export/import, deferred storage cleanup.

**Audience:** Self-hosting operator. Contains credentials and personal data warnings.

### Principle (verbatim intent)
- Recovery unit = PostgreSQL + entire S3 object store + configuration and encryption keys. Retain every revision/publication and its assets.
- Repo does not schedule backups. Operator defines cadence and retention, backs up before migrations, copies archives encrypted to a separate host, limits access, regularly exercises restoration.
- Compose backup command stops all services in target project while capturing volumes.
- Archives and authoring bundles contain credentials, personal data and unpublished content: never commit or place in public storage.

### Coordinated full instance backup (verbatim)
```sh
node docker/recovery.mjs backup areca-demo docker/.env /secure/backups/areca-2026-10-01
```
Behaviour:
- Run from repo root against intended Compose project, using its original env file.
- Stops **all** project services first; captures PostgreSQL, RustFS, Redis volumes.
- Preserves `.env` (incl. `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY`, optional `AI_SETTINGS_ENCRYPTION_KEY`, auth secret, DB and S3 credentials); original and fully resolved compose config; exact container image IDs; SHA-256 checksums.
- Explicit env file takes precedence over unrelated shell variables. Checks existing DB/storage/CMS container credentials match; aborts on mismatch without printing secrets.
- Resolved compose config contains literal env values; `$` escaped for Compose.
- Failure leaves services stopped; incomplete directory must not be used.
- On success: copy archive off host, then explicitly restart original instance with existing compose command.
- Retain/export recorded images (`docker image save`) or pin registry digests before relying on different recovery host.
- Physical PostgreSQL/RustFS backups require same engine images and platform.
- Managed services: provider-coordinated snapshots instead.

### Isolated full restore (verbatim)
```sh
node docker/recovery.mjs restore areca-restore /secure/restore.env /secure/backups/areca-2026-10-01
```
Behaviour:
- Choose **new** project name; restore into empty volumes. CLI refuses existing destination volumes and corrupted archives.
- Writes pinned-image override alongside destination env file; source archive unchanged.
- Copy `instance.env` securely to desired environment path without changing key/password values.
- Keep all encryption keys. If an encryption key is intentionally unavailable: restore data, re-enter provider credential.

Start only infra (verbatim):
```
docker compose --project-name areca-restore --env-file /secure/restore.env -f /secure/backups/areca-2026-10-01/compose.yml -f /secure/areca-restore-images.yml up -d postgres rustfs redis
```
- Avoid host port collisions with additional override.
- Verify counts of organizations, permissions, entries, revisions, publications, jobs; retrieve several assets and compare checksums; decrypt a preserved deployment credential with original encryption key.
- Keep external deployments blocked during testing.
- Inspect/recover interrupted build leases before enabling workers.
- Start CMS with isolated URL/port after data verification; sign in, inspect unpublished draft, revision and live snapshot; serve an asset.
- Record commands/results/date in operator's restore log.
- Cut over only after checks; keep original backup unchanged; retain previous instance until accepted.
- Redis may be rebuilt if only cache; archive includes it to preserve current operational state.

### Versioned organization authoring export/import (verbatim commands)
From `apps/cms`, dependencies installed, all CMS/worker writes stopped:
```sh
ARECA_WRITES_STOPPED=1 node --env-file=.env.local scripts/authoring-transfer.mjs export ORGANIZATION_ID /secure/organization.json
ARECA_WRITES_STOPPED=1 node --env-file=.env.local scripts/authoring-transfer.mjs import --offline /secure/organization.json
```
Version 1 bundle includes: organization, sites and manifests, collections, draft/approved/scheduled data, complete entry revisions, asset metadata **and bytes with SHA-256 checksums**, membership roles, invitations, publications, build jobs, audit history, deleted-content archives, encrypted deployment credentials "with their encryption key" (**ambiguous, see below**). User references captured by email; accounts, passwords, other orgs excluded. Provision matching destination users first.

Import: maps historical actors/permissions to destination users; rejects missing/ambiguous identities; validates bundle, version, DB columns, org relationships, asset integrity; DB constraints reject ID/slug conflicts. Use exporter DB schema version; migrate destination before importing.

Import outcomes: creates new org preserving content IDs and references; forces imported sites into demo mode; removes deployment targets; rotates build/preview secrets; disables invitation tokens. Rotate build and schema-write tokens in settings when reconnecting integrations. Credential import requires preserved encryption key to match isolated destination. Full instance restore recovers auth and original integration tokens. Asset writes compensated if DB transaction fails; cleanup failures identify keys to remove before retry. Interrupted imports can leave orphan objects: remove only listed import keys in isolated destination. Offline import prevents races with asset deletion and object puts. Verify by re-exporting destination and comparing.

Imports into different `APP_URL`: recognized asset URLs in entry authoring data and revisions rebased to destination. Historical publication snapshots remain verbatim (public URLs may name source site). Publish a new demo release before using imported content at destination. External media URLs preserved.

Imported publications become historical `superseded` records with rollback eligibility and deployment timestamps cleared; source deployment status/timestamps and job states retained in `publication.import` audit events and original bundle. Queued source jobs cancelled during import. Destination must explicitly request new demo or production release before any imported snapshot is reported deployed.

### Retry deferred object cleanup (verbatim)
```sh
cd apps/cms
node --env-file=.env.local scripts/cleanup-assets.mjs
```
Run from `apps/cms` (same command as ASSET_RETENTION.md). Processes up to 1,000 keys; repeat until none pending. Failed keys remain with last error. Full backups preserve this queue. Never run cleanup against an org import destination during offline import.

### Stale / contradictory / incomplete (docker/RECOVERY)
- **Ambiguity:** bundle includes "encrypted deployment credentials ... with their encryption key" in one sentence, and "Credential imports require the preserved encryption key to match" in another. Clarify whether the key ships in the bundle (it should not).
- **Missing commands:** "Start CMS with isolated URL/port" (no compose command for CMS in restore project); "decrypt a preserved deployment credential" (no command); "Inspect/recover interrupted build leases" (no command or UI path); verifying counts (no query given).
- **Redis:** "Redis may be rebuilt if only cache; the archive includes it to preserve operational state". OPERATIONS.md says rate limiting fails open on Redis outage; the doc does not say whether any durable state lives in Redis. Clarify.
- `instance.env` filename is produced by the CLI; not confirmed by my read of `docker/recovery.mjs` (not read in this pass).
- Restore `-f /secure/areca-restore-images.yml` is written by the CLI; the doc names it. Fine but path should be explained.
- Import into a different APP_URL: "recognized asset URLs ... rebased"; "Publish a new demo release before using imported content". Good, but how to confirm the rebasing (no verification step).
- `cleanup-assets.mjs` uses `.env.local` in a Compose deployment; Compose has no `.env.local`. Show the container-appropriate invocation or say it is run on the host with the instance env file.
- Backup command example uses `docker/.env` while the README says `cp .env.example .env` (run from `docker/`). Consistent, but the docs should state the path relative to repo root.
- Physical backups require same engine images and platform; document the platform constraint (arm64 vs amd64).
- Backup restarts: "explicitly restart the original instance with its existing compose command" (no command given).

---

## 12. docker/compose.yml (skim)

**Purpose:** Reference Compose stack for the demo: `name: areca-demo`. Services: `cms`, `postgres`, `redis`, `rustfs`, `mailpit`. Volumes: `postgres_data`, `redis_data`, `rustfs_data`.

**Audience:** Self-hosting operator.

### Services and ports
| Service | Image | Host ports | Internal | Notes |
| --- | --- | --- | --- | --- |
| cms | `${CMS_IMAGE:-ghcr.io/seirai-dev/areca-cms:latest}` | `127.0.0.1:${CMS_PORT:-3000}:3000` | 3000 | `restart: unless-stopped`, `init: true` |
| postgres | `postgres:17-alpine` | none | 5432 | user/db `areca`; healthcheck `pg_isready -U areca -d areca` every 5s, 20 retries |
| redis | `redis:8-alpine` | none | 6379 | `redis-server --appendonly yes`; healthcheck `redis-cli ping`; no password |
| rustfs | `rustfs/rustfs:1.0.0` | `127.0.0.1:9001:9001` (console) | 9000 (S3 API) | command `/data`; healthcheck `curl -fsS http://127.0.0.1:9000/health` (start_period 20s) |
| mailpit | `axllent/mailpit:v1.31.3` | `127.0.0.1:8025:8025` | 1025 (SMTP) | no healthcheck; cms waits with `service_started` |

### cms environment (verbatim keys and sources)
- `DATABASE_URL`: `postgres://areca:${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}@postgres:5432/areca`
- `REDIS_URL`: `redis://redis:6379`
- `BETTER_AUTH_SECRET`: `${BETTER_AUTH_SECRET:?...}` (required)
- `BETTER_AUTH_URL`: `${CMS_URL:-http://localhost:3000}`
- `APP_URL`: `${CMS_URL:-http://localhost:3000}`
- `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY`: `${...:?...}` (required)
- `AI_SETTINGS_ENCRYPTION_KEY`: `${AI_SETTINGS_ENCRYPTION_KEY:-}` (optional)
- `SETUP_TOKEN`: `${SETUP_TOKEN:-}`
- `S3_ENDPOINT`: `http://rustfs:9000`; `S3_REGION`: `us-east-1`; `S3_BUCKET`: `areca`
- `S3_ACCESS_KEY`: `${S3_ACCESS_KEY:-areca-demo}` (default!)
- `S3_SECRET_KEY`: `${S3_SECRET_KEY:?...}` (required)
- `S3_FORCE_PATH_STYLE`: `"true"`
- `SMTP_HOST`: `mailpit`; `SMTP_PORT`: `"1025"`; `SMTP_FROM`: `cms@areca.local`
- Optional ops (empty = CMS default): `METRICS_TOKEN`, `DB_CONNECT_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_IN_TX_TIMEOUT_MS`, `READINESS_TIMEOUT_MS`, `READINESS_MAX_QUEUE_AGE_SECONDS`, `READINESS_MAX_TICK_AGE_SECONDS` (all `${VAR:-}`).

[code] Empty strings are treated as unset: `apps/cms/src/env.ts` sets `emptyStringAsUndefined: true`, so empty `SETUP_TOKEN=` and `METRICS_TOKEN=` do not fail min-length validation. Good.

### rustfs
- `RUSTFS_ACCESS_KEY: ${S3_ACCESS_KEY:-areca-demo}`; `RUSTFS_SECRET_KEY: ${S3_SECRET_KEY:?...}`.

### postgres
- `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}`; volume `postgres_data:/var/lib/postgresql/data`.

### Stale / contradictory / incomplete (compose)
- `S3_ACCESS_KEY` defaults to `areca-demo` (insecure default if `.env` omits it; the access key is not the secret but is still a credential identifier). Note that `S3_SECRET_KEY` is required, so the stack fails closed on the secret.
- `CMS_URL` is used for both `BETTER_AUTH_URL` and `APP_URL`. Operators need to know that behind a reverse proxy `CMS_URL` must be the public HTTPS URL.
- CMS port is bound to loopback only. Conflicts with DEPLOYMENT.md's LAN requirement for Dokploy (see docker/README notes).
- No `healthcheck` for `cms` in compose; image provides one (apps/cms/Dockerfile).
- No `stop_grace_period`; default 10s. Consistent with WORKER_DRAIN_TIMEOUT_MS 8000 default, so drains fit. Note if drain is raised.
- Not passed through compose (so unavailable to a Compose operator unless added): `WORKER_ENABLED`, `WORKER_CONCURRENCY`, `WORKER_DRAIN_TIMEOUT_MS`, `LOG_LEVEL`, `RATE_LIMIT_TRUST_PROXY`, `ADMIN_MFA_REQUIRED`, `ALLOW_PRIVATE_HEALTH_CHECKS`, `DOKPLOY_URL`/`DOKPLOY_API_KEY`, `DOKPLOY_DEV_FALLBACK_ENABLED`, `AUTH_EMAIL_PASSWORD_ENABLED`, SSO/OAuth vars, `SERVER_URL`, `NODE_OPTIONS`. Note the `.env` file is read by compose only for `${VAR}` interpolation; variables not listed under `environment:` do not reach the container, so setting `WORKER_CONCURRENCY` in `.env` has no effect on this stack. This is an important operator gotcha.
- Redis has no password and is unpublished; reachable only from the compose network.
- Mailpit is a dev mail catcher, used as the SMTP target by default. Real SMTP needed for public hosting (docker/README says so); compose does not make SMTP configurable.
- `rustfs` console is published on loopback 9001; the S3 API is internal only. Good.

---

## Cross-document inconsistencies (summary)

1. **Replicas:** UPGRADES/OPERATIONS describe extra replicas with `WORKER_ENABLED=false`; CAPACITY says single replica only. Pick one.
2. **Deleting an asset as the only retraction path:** DEPLOYMENT says so; ASSET_RETENTION and HIGH_RISK say referenced assets cannot be deleted. Contradiction for public URL retraction.
3. **CMS reachability:** compose binds `127.0.0.1` (docker/README, compose.yml); DEPLOYMENT requires LAN reachability from Dokploy host (`dev:lan`, `0.0.0.0`). Need the production answer (reverse proxy).
4. **Setup token lifecycle:** "printed once" (docker/README) vs "changes on every restart" (DEPLOYMENT).
5. **Log cap units:** "256 KiB counted in characters" (OPERATIONS) vs "256 Ki characters" (CAPACITY).
6. **Tokens:** "hashed" storage (DECISIONS) vs "surfaced in Settings › Developer" (DECISIONS) without explaining re-display.
7. **Migrations:** "applied automatically on container start" (UPGRADES) vs "apply 0007 and 0008 with the existing deployment migration command" (HIGH_RISK). Name the command or drop it.
8. **Migration coverage:** 0009, 0013, 0014, 0015 undocumented (verified present in `apps/cms/drizzle/`).
9. **Encryption key in export bundle:** "encrypted deployment credentials with their encryption key" (docker/RECOVERY) vs "require the preserved encryption key to match" (same doc). Clarify.
10. **Step-up scope:** DEPLOYMENT step-up list omits `saveAiSettingsFn`; `updateSiteFn` (sets deployment target) has no step-up in AUTHZ. Confirm intended.
11. **Dangling audit reference:** HIGH_RISK cites `CMS_AUDIT.md` (repo root, not `docs/`); AUTHZ cites "audit 8.3".
12. **Terminology:** approve / mark as ready / publish / go live / publication / release. Needs one glossary.

---

## Proposed docs-site pages

Grouped as requested: self-hosting, operations, security, reference. Also a short "Upgrades & recovery" group, since it is large.

### Self-hosting
| Section | Page title | Slug | Source material |
| --- | --- | --- | --- |
| Self-hosting | Overview and requirements | `/self-hosting` | docker/README intro; DECISIONS (stack, layout) |
| Self-hosting | Quickstart with Docker Compose | `/self-hosting/quickstart-docker` | docker/README quickstart; compose.yml |
| Self-hosting | Production Compose and reverse proxy | `/self-hosting/production-compose` | docker/README public-hosting notes; compose.yml; DEPLOYMENT secrets |
| Self-hosting | First-run setup and admin MFA | `/self-hosting/first-run-setup` | DEPLOYMENT "First-run setup"; docker/README setup |
| Self-hosting | Image tags and pinning | `/self-hosting/image-tags` | docker/README GitHub Actions and tags; UPGRADES pin rule |
| Self-hosting | Connecting Dokploy | `/self-hosting/dokploy` | DEPLOYMENT procedures 1 to 6, troubleshooting |
| Self-hosting | Sites, publishing and Go live | `/self-hosting/sites-and-publishing` | DECISIONS publishing flow; DEPLOYMENT Go live |
| Self-hosting | Media and CDN | `/self-hosting/media-and-cdn` | DEPLOYMENT media privacy; ASSET_RETENTION |
| Self-hosting | Configuration reference | `/self-hosting/configuration` | link to docs/CONFIGURATION.md (not read); env.ts |

### Operations
| Section | Page title | Slug | Source |
| --- | --- | --- | --- |
| Operations | Health and readiness | `/operations/health` | OPERATIONS endpoints, readiness response |
| Operations | Metrics and alerts | `/operations/metrics` | OPERATIONS metrics table, scrape, alerts |
| Operations | Logs and redaction | `/operations/logs` | OPERATIONS logs, build log caps, UI error refs |
| Operations | Worker, scheduler and shutdown | `/operations/worker-scheduler` | OPERATIONS worker section; DECISIONS publishing |
| Operations | Database timeouts | `/operations/database-timeouts` | OPERATIONS deadlines table |
| Operations | Capacity and limits | `/operations/capacity` | CAPACITY targets, limits, scaling triggers |
| Operations | Asset cleanup | `/operations/asset-cleanup` | ASSET_RETENTION; docker/RECOVERY cleanup |
| Operations | Troubleshooting | `/operations/troubleshooting` | DEPLOYMENT troubleshooting table |

### Upgrades and recovery
| Section | Page title | Slug | Source |
| --- | --- | --- | --- |
| Upgrades | How migrations run | `/upgrades/migrations` | UPGRADES how migrations run, rules |
| Upgrades | Upgrade procedure | `/upgrades/procedure` | UPGRADES procedure, checklist |
| Upgrades | Rollback | `/upgrades/rollback` | UPGRADES rollback |
| Upgrades | Release notes: migrations 0007 and 0008 | `/upgrades/release-0007-0008` | HIGH_RISK_UPGRADE (after fixing gaps) |
| Upgrades | Data corrections | `/upgrades/data-corrections` | UPGRADES 0010, 0011, 0012, 0016 |
| Recovery | Backup and recovery overview | `/recovery` | RECOVERY |
| Recovery | Full-instance backup | `/recovery/full-backup` | docker/RECOVERY backup |
| Recovery | Isolated restore | `/recovery/isolated-restore` | docker/RECOVERY restore |
| Recovery | Organization export and import | `/recovery/organization-transfer` | docker/RECOVERY authoring transfer; RECOVERY |

### Security
| Section | Page title | Slug | Source |
| --- | --- | --- | --- |
| Security | Roles and permissions | `/security/roles` | DECISIONS roles; AUTHZ actors and policies |
| Security | Authorization reference | `/security/authorization-matrix` | AUTHZ full tables (server functions, HTTP routes) |
| Security | Two-factor and step-up | `/security/mfa-and-step-up` | DEPLOYMENT first-run, step-up; AUTHZ REAUTH |
| Security | Tokens: build, schema, preview | `/security/tokens` | DECISIONS site integration; DEPLOYMENT rotation |
| Security | Secrets and rotation | `/security/secrets` | DEPLOYMENT secrets table, rotation |
| Security | Media privacy | `/security/media-privacy` | DEPLOYMENT media privacy; ASSET_RETENTION |
| Security | Error handling and no existence oracle | `/security/error-handling` | AUTHZ error shape, no-existence section; OPERATIONS UI errors |
| Security | AI SEO data flow | `/security/ai-seo-data` | DECISIONS SEO assistance; AUTHZ generateEntrySeoFn |

### Reference
| Section | Page title | Slug | Source |
| --- | --- | --- | --- |
| Reference | HTTP endpoints | `/reference/http-endpoints` | AUTHZ HTTP routes; OPERATIONS endpoints |
| Reference | Environment variables | `/reference/environment` | OPERATIONS env table + env.ts + compose env (link CONFIGURATION.md) |
| Reference | Metrics | `/reference/metrics` | OPERATIONS metrics table |
| Reference | Glossary | `/reference/glossary` | DECISIONS, HIGH_RISK, DEPLOYMENT terms |
| Reference | Architecture decisions | `/reference/architecture` | DECISIONS principles, stack, layout |
| Reference | Publishing states | `/reference/publication-states` | DECISIONS build_job and publication statuses; UPGRADES 0012 |
| Contributors | Building the image locally | `/contributing/build-image` | docker/README build locally |
| Contributors | Benchmarking | `/contributing/benchmark` | CAPACITY benchmark |
| Contributors | Authorization matrix maintenance | `/contributing/authz-matrix` | AUTHZ source-of-truth and inventory rule |

---

## Open questions / gaps

Priority order (most important first):

1. **Public asset retraction:** how does an operator stop a public URL that is referenced by a publication snapshot or revision (deletion is blocked)? DEPLOYMENT and ASSET_RETENTION disagree. Needs a decided procedure or an explicit "not retractable" statement.
2. **Replica policy:** is more than one CMS replica supported? CAPACITY says no; UPGRADES and OPERATIONS describe it.
3. **Production CMS reachability:** compose binds loopback only; DEPLOYMENT requires LAN reachability for Dokploy. What is the supported production topology (reverse proxy on same host? public `CMS_URL`?). Not documented end to end.
4. **Migration 0007/0008 command:** "the existing deployment migration command" is never named. Also 0009, 0013, 0014, 0015 are undocumented.
5. **Restore gaps:** missing commands for starting CMS in restore project, verifying encrypted credential decrypt, recovering interrupted build leases, retrying interrupted deployment releases (HIGH_RISK step 3), and the "outbound deployments blocked" mechanism.
6. **Operator procedure for uncertain deployment jobs:** `resolveUncertainDeploymentJobFn` (agency only) exists, but no runbook says when to use it, or what "upstream stop confirmation" means.
7. **Encryption key in org export bundle:** is the key ever in the bundle? The doc says both yes and no.
8. **Setup token lifecycle:** printed "once" vs "changes on every restart". Clarify.
9. **Token display:** tokens are stored hashed; when is the plaintext shown (create/rotate only?) and how does an operator recover a lost build token?
10. **Identifier rules:** HIGH_RISK requires "collection and field keys must satisfy the new identifier rules". The rules are not in these sources; they need a page (CONTENT_SCHEMA.md or SDK doc, not read) and a rename procedure.
11. **Worker config not in compose:** the demo compose does not pass `WORKER_*`, `LOG_LEVEL`, `ADMIN_MFA_REQUIRED`, `RATE_LIMIT_TRUST_PROXY`, `ALLOW_PRIVATE_HEALTH_CHECKS`, or Dokploy vars. Operators who set them in `.env` get no effect. Either add them or document this gotcha.
12. **Heap size:** "keep Node heap above 1 GB" with no setting shown (`NODE_OPTIONS` or other).
13. **Cleanup scheduling:** no cron/systemd/compose example for `cleanup-assets.mjs`; the `.env.local` invocation does not fit a Compose deployment.
14. **Backup cadence and retention:** repo defers entirely to the operator; no recommended policy, no encryption-at-rest guidance for archives.
15. **Redis durable state:** does Redis hold anything that must be restored (RECOVERY says "operational state")? OPERATIONS says rate limiting fails open.
16. **`updateSiteFn` without step-up:** it sets deployment target and production URL. Confirm intended, and whether DEPLOYMENT step-up list should mention it.
17. **AI data disclosure:** editors can send entry content and images to OpenRouter via `generateEntrySeoFn`. Public security page must state this and what the agency controls.
18. **Dated and point-in-time claims:** "latest stable as of 2026-10-01" (Node/pnpm), HIGH_RISK validation record (2026-10-01, no real Dokploy deploy triggered), CAPACITY benchmark (no commit or date recorded). Date these explicitly on the site.
19. **Stale UI location:** "Go-live tray at the bottom of the sidebar" may be outdated after the UI redesign noted in the user's auto-memory. Verify in the running app.
20. **Internal audit reference:** `CMS_AUDIT.md` (repo root) is cited as the source of the ten findings. Decide whether it is public; it is not in `docs/`.
21. **Terminology:** glossary needed for approve / mark as ready / publish / go live / publication / release / demo / production / rollback eligibility (`was_live`).
22. **Migration success signal:** the doc says the log shows `database migrations applied`. Verify this exact string in `scripts/docker-entrypoint.mjs` (not read in this pass).
23. **Unread but referenced:** `docs/CONFIGURATION.md` (env reference), `docs/INTEGRATIONS.md` (integration reliability), `apps/cms/src/adapters/deployment/dokploy-api-notes.md`, `.github/workflows/ci.yml`, `docker/recovery.mjs` (for `instance.env` and the restore override filename), `docker/.env.example`, `apps/cms/scripts/docker-entrypoint.mjs`. These need reading before the pages above are finalized.
24. **Windows-only guidance:** firewall PowerShell command and `&&` rule. Keep as contributor/dev notes, not operator steps, or mark the platform.
25. **Health URL scheme:** DEPLOYMENT shows both `https://` (host-published, production) and `http://` (LAN dev). Make the production form the default and label LAN HTTP as dev-only.
26. **No version/changelog:** releases are identified only by `sha-` tags. A public docs site needs a release notes location and a version policy.
27. **Compose `latest` default:** `CMS_IMAGE` defaults to `:latest` in `compose.yml`. Consider a required variable or a warning.
28. **Measured numbers:** "no change in wall time" for asset usage check vs measured 4,068 to 4,127 ms p50 (slightly slower). Reword on the public page.
