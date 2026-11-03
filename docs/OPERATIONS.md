# Operations

Runtime behaviour operators need: health, metrics, logs, deadlines and what the
UI is allowed to see when something breaks. For service URLs and the complete
environment-variable reference, see [CMS configuration](CONFIGURATION.md).

## Endpoints

| Endpoint                | Auth                                   | Purpose                                                                                                            |
| ----------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /api/health`       | none                                   | Cheap liveness. Always `200 {"ok":true,"service":"cms"}` while the process serves requests. Touches no dependency. |
| `GET /api/health/ready` | none                                   | Readiness. `200` or `503` with JSON; every check is time-bounded so it never hangs.                                |
| `GET /api/metrics`      | `Authorization: Bearer $METRICS_TOKEN` | Prometheus text format. `404` when `METRICS_TOKEN` is unset, `401` for a wrong or missing token.                   |

Use `/api/health` for container liveness and `/api/health/ready` for
load-balancer or orchestrator readiness. A Docker `HEALTHCHECK` should call
`/api/health/ready` only if you want the container marked unhealthy when
Postgres or S3 is down; a plain restart will not fix those, so
`/api/health` is the safer `HEALTHCHECK` target.

### Readiness response

```json
{
  "ok": false,
  "checks": {
    "db": { "ok": true, "ms": 4 },
    "storage": {
      "ok": false,
      "ms": 3001,
      "reason": "CheckTimeout: timed out after 3000ms"
    },
    "redis": {
      "ok": true,
      "ms": 2,
      "degraded": true,
      "reason": "ECONNREFUSED"
    },
    "worker": {
      "ok": true,
      "ms": 0,
      "detail": { "enabled": true, "tickAgeSeconds": 1 }
    },
    "queue": {
      "ok": true,
      "ms": 5,
      "detail": {
        "queued": 0,
        "active": 1,
        "oldestQueuedAgeSeconds": null,
        "expiredLeases": 0,
        "schedulerAgeSeconds": 2
      }
    }
  }
}
```

- `db`: `select 1`.
- `storage`: S3 `HeadBucket` on `S3_BUCKET`.
- `redis`: `PING`. Rate limits fall back to in-memory counters, so a Redis outage is
  reported as `degraded: true` but does **not** fail readiness.
- `worker`: only meaningful when `WORKER_ENABLED` is on in this process. Fails
  when the worker loop has not ticked for `READINESS_MAX_TICK_AGE_SECONDS`.
  (The loop timer ticks even while a long deployment is running.)
- `queue`: fails when the oldest queued build job is older than
  `READINESS_MAX_QUEUE_AGE_SECONDS`, when an active job's lease has been
  expired for longer than `READINESS_MAX_TICK_AGE_SECONDS` without recovery, or
  when the scheduler has not completed a tick in that window.
- `mail`: never fails readiness. It is `degraded` when the oldest queued email
  has waited more than 15 minutes.
- `loops`: never fails readiness. It is `degraded` when a background loop has no
  successful run within five times its interval (worker 15 seconds, scheduler,
  recovery and cleanup 75 seconds, mail and notifications 25 seconds, and the
  hourly maintenance loop five hours). The reason names the loops.

The top level has two flags. `ok` is `false` only when a check fails outright.
`degraded` is `true` when any check is degraded, and readiness still returns
`200` in that case.

Responses carry only check names, ok/fail, timings and a short redacted reason.
Full errors go to the logs. Readiness heartbeats are per process: with several
replicas, only those running with `WORKER_ENABLED=true` report worker state.

## Metrics

All metrics are gauges unless noted. Counts come from the database at scrape
time, so they are correct across restarts and replicas.

| Metric                                       | Labels   | Meaning                                                                          |
| -------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `areca_build_jobs`                           | `status` | Build jobs per status                                                            |
| `areca_build_jobs_oldest_queued_age_seconds` |          | Oldest queued job age (0 when empty)                                             |
| `areca_build_jobs_active`                    |          | building + validating + deploying                                                |
| `areca_build_jobs_failed_total`              |          | Durable cumulative execution/recovery failures; retained after job/site deletion |
| `areca_build_jobs_failed_backlog`            |          | Gauge of jobs currently in `failed` status                                       |
| `areca_publications`                         | `status` | Publications per status                                                          |
| `areca_scheduled_entries_overdue`            |          | Scheduled entries past their time and not yet published                          |
| `areca_worker_enabled`                       |          | 1 when worker loops run in this process                                          |
| `areca_worker_last_tick_age_seconds`         |          | Only when the worker is enabled                                                  |
| `areca_scheduler_last_tick_age_seconds`      |          | Only when the worker is enabled                                                  |
| `areca_readiness_check_up`                   | `check`  | 1 up, 0 down or degraded                                                         |
| `areca_mail_pending`                         |          | Emails queued and waiting to send                                                |
| `areca_mail_oldest_pending_age_seconds`      |          | Age of the oldest queued email, 0 when none                                      |
| `areca_mail_expired_leases`                  |          | Emails whose sender lease lapsed and that no replica has reclaimed yet           |
| `areca_notification_events_pending`          |          | Release notices waiting to be delivered                                          |
| `areca_notification_events_oldest_pending_age_seconds` |  | Age of the oldest pending release notice, 0 when none                    |
| `areca_storage_deletions_paused`             |          | Object deletions paused after four failed attempts                               |
| `areca_schedules_exhausted`                  |          | Scheduled publications stopped after four failed attempts                        |
| `areca_loop_success_age_seconds`             | `loop`   | Seconds since each background loop last finished a run without error             |
| `areca_ready`                                |          | 1 when readiness would return 200                                                |
| `areca_process_uptime_seconds`               |          |                                                                                  |
| `areca_process_memory_bytes`                 | `kind`   | rss, heap_used, heap_total, external                                             |
| `areca_db_pool_connections`                  | `pool`, `state` | `state` is total or idle; pools are `main`, `mcp`, `factor_lock`          |
| `areca_db_pool_waiting`                      | `pool`   | Requests waiting for a pooled connection; sustained values above 0 mean the pool is too small or queries are slow |
| `areca_db_pool_max_connections`              | `pool`   | Configured maximum (`DB_POOL_MAX` for `main`)                                    |
| `areca_event_loop_utilization`               |          | Share of time the event loop was busy since the previous scrape, 0 to 1          |
| `areca_event_loop_delay_seconds`             | `stat`   | Event loop delay since the previous scrape: `p50`, `p99` or `max` (sampled every 20ms) |

Pool and event-loop gauges read in-process counters, so they cost no database
query. Each scrape resets the event-loop window; with a 15s interval, the
numbers describe that interval.

Scrape config:

```yaml
scrape_configs:
  - job_name: areca-cms
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/areca-metrics-token
    static_configs:
      - targets: ["cms.example.com"]
```

Metrics are built from several `count(*)` queries; keep the scrape interval at
15s or more. `/api/metrics` is rate limited (60 requests per minute per client
IP, one shared bucket unless `RATE_LIMIT_TRUST_PROXY` is set) to blunt token
guessing. `/api/health` and `/api/health/ready` are never rate limited.

### Example alerts

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

## Logs

Operational logging (worker, scheduler, rate limiter, adapters, readiness,
server-function errors) is one JSON object per line:

```json
{
  "level": "error",
  "time": "2026-10-01T13:30:20.823Z",
  "component": "worker",
  "msg": "job failed",
  "jobId": "...",
  "err": { "name": "Error", "message": "...", "stack": "..." }
}
```

`info` and `debug` go to stdout, `warn` and `error` to stderr. `LOG_LEVEL` is
`debug|info|warn|error|silent` (default `info`). Reserved keys are `level`,
`time`, `component`, `msg`; a field with a reserved name is written as
`field_<name>`.

Everything is redacted before it is written: values of env vars whose name looks
secret (`*SECRET*`, `*TOKEN*`, `*PASSWORD*`, `*API_KEY*`, `*ACCESS_KEY*`,
`*ENCRYPTION_KEY*`, ...), passwords embedded in `*_URL` values, URL userinfo
(`scheme://user:pass@host`), `Authorization`/`Bearer`/`x-api-key`, sensitive
`key=value` pairs, and long base64/hex values in `key=value` position. Redaction
is best effort: do not log secrets on purpose.

### Build logs

Each build job log (`build_job.logs`, shown in the publish UI) is redacted per
line, each line is cut at 8 KiB, and the whole log is capped at 256 KiB (counted in
characters, not bytes, so multi-byte text can use up to about 1 MiB). When
the cap is exceeded the oldest content is dropped and the log starts with a
single `[truncated]` marker; the tail (the part that explains a failure) is kept.
Job and audit `error` text is redacted too.

### Errors shown in the UI

Server functions pass through the application's typed errors (not found,
conflict, validation, asset validation, `MFA_REQUIRED`, `REAUTH_REQUIRED`,
redirects, `Response` values). Every other error (database, S3, internal bug)
is replaced with `Something went wrong (ref: <id>)`; the full redacted error is
logged under the same `ref` (`msg: "unhandled server function error"`). To
expose a new error type to the UI, extend `AppError`
(`src/server/http/app-error.ts`) or add its `code` to `PASSTHROUGH_CODES` in
`src/server/http/safe-error.ts`.

## Database deadlines

| Variable                   | Default | Meaning                                                                      |
| -------------------------- | ------- | ---------------------------------------------------------------------------- |
| `DB_CONNECT_TIMEOUT_MS`    | `5000`  | Time to get a pooled connection                                              |
| `DB_STATEMENT_TIMEOUT_MS`  | `15000` | Server-side `statement_timeout` for every statement                          |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | `30000` | `idle_in_transaction_session_timeout`; frees locks of abandoned transactions |
| `DB_POOL_MAX` | `10` | Max connections in the main pool. Size it against PostgreSQL's `max_connections` across all CMS replicas. |

`0` disables a timeout. Migrations run in a separate process
(`scripts/docker-entrypoint.mjs`) and are not subject to these limits. Code that
legitimately needs longer must open a transaction and run
`SET LOCAL statement_timeout = '60s'` first. Pool-level errors on idle clients
are logged (`component: "db"`) instead of crashing the process.

## Startup

The container entrypoint (`scripts/docker-entrypoint.mjs`) runs these steps in
order:

1. Waits for PostgreSQL. Each probe has a 5-second connection and query timeout.
2. Applies database migrations while holding a PostgreSQL advisory lock, so
   replicas never migrate at the same time. A replica that finds the lock taken
   waits for the other to finish, then finds nothing left to apply.
3. Makes sure the S3 bucket exists (see [Object storage](#object-storage)).
4. Starts the server and sends it one request to `/api/health`. The server
   loads its configuration on that first request, so a 500 there (for example
   when `REDIS_URL` is missing in production) stops the container with code 1,
   with the server's error in the log. Connection failures are retried until the
   deadline.

The waits share one deadline set by `STARTUP_DEADLINE_SECONDS` (default `60`).
Retries back off from 1 second to 5 seconds. Each retry logs the dependency, the
attempt and the time left, for example
`postgres not ready (attempt 3: connect ECONNREFUSED …); retrying in 2s, 4s left before the startup deadline`.
When the deadline passes, the entrypoint logs `startup failed, exiting: …` and
exits with code 1, so your orchestrator can restart it or show it as failed. A
migration that has already started runs to completion; the deadline does not
interrupt it. A replica waiting for the migration lock does count against the
deadline, so raise `STARTUP_DEADLINE_SECONDS` if a long migration makes the
others time out.

## Object storage

Asset reads stream from S3 to the browser, so the CMS does not hold a whole file
in memory to serve it. The S3 client has fixed time limits; they are not set by
an environment variable.

| Operation | Limit |
| --- | --- |
| Download (`GET`), response headers | 30 seconds |
| Download (`GET`), body | 30 seconds without any new bytes while the body is being read |
| Upload (`PUT`) | 60 seconds in total |
| Delete (`DELETE`) | 30 seconds in total |

A download that hits a limit fails its request, and the browser can retry it.
A failed delete goes back into the durable cleanup queue. After four failed
attempts the deletion pauses (`areca_storage_deletions_paused`) until it is
retried; see [recovery](RECOVERY.md#retained-media-cleanup).

**Bucket creation.** Startup and `pnpm s3:init` create `S3_BUCKET` only when S3
definitively reports that it does not exist (`404`, `NotFound` or
`NoSuchBucket`). Wrong credentials (`403`), server errors and network failures
are never read as "missing". Startup retries them until the deadline and then
exits, and nothing is created. Readiness checks the bucket with a read-only
`HeadBucket` and never creates one.

**Object scope.** Optional `S3_PREFIX` confines all object operations to the
normalized prefix plus `/`, including branding, cleanup and authoring scripts.
Unset or exactly empty uses root; invalid nonempty values fail before storage
operations with no fallback. Every writer must use the same prefix. `db:reset`
empties the entire subtree, including manually placed objects, or the whole
bucket in root mode. Bucket checks above do not probe prefix permissions, and
configuration does not restrict credential capabilities. See
[configuration](CONFIGURATION.md#storage-prefix) for validation and manual
migration/rollback.

## Redis

Production requires `REDIS_URL`. The CMS refuses to start without it, because
Redis holds the rate-limit counters that every instance shares.

If Redis cannot be reached while the CMS runs, each instance counts requests in
its own memory with the same budgets, and retries Redis every 5 seconds. The log
records the change once (`Redis unavailable; rate limits count in memory on this instance only`)
and records the recovery once. During an outage a client can use up to one budget
per replica. Readiness reports `redis` as `degraded` without failing.

## Content Security Policy

Every response carries a `Content-Security-Policy` with a fresh nonce for each
request. The framework stamps that nonce on the scripts and styles it writes.
The policy:

- `script-src 'self' 'nonce-…'`: same-origin scripts and nonce-marked scripts
  only. There is no `unsafe-inline` and no `unsafe-eval`.
- `style-src 'self' 'nonce-…'` plus Google Fonts (`https://fonts.googleapis.com`)
  for the branding preview, and one hashed stylesheet that the Sonner toast
  library writes.
- `style-src-attr 'unsafe-inline'`: React writes inline `style` attributes for
  layout and transitions. An inline style attribute cannot run script.
- `font-src 'self' data: https://fonts.gstatic.com`, `img-src 'self' data: blob:`,
  `connect-src 'self'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'` and `frame-ancestors 'none'`.

| Variable | Default | Effect |
| --- | --- | --- |
| `CSP_REPORT_ONLY` | `false` | `true` sends the same policy as `Content-Security-Policy-Report-Only`. Browsers log violations and block nothing. Use it to see what a change would break before enforcing it. |

What this means for operators:

- Images, scripts and styles must load from this origin. The CMS serves uploaded
  files at `/api/assets/file/…`, so they work. An external image URL pasted into
  rich text does not load in the editor until its file is in the library.
- The CMS UI cannot load third-party scripts or widgets.
- `vite dev` uses a relaxed development policy (inline scripts, `eval`, and a
  websocket for hot reload). Production builds never send it.
- To find a violation, open the browser console and look for
  `Content Security Policy` messages. They name the directive and the blocked
  source.

## Several instances

Run as many replicas as you need. The work they share is coordinated in
PostgreSQL:

- **Migrations** run under an advisory lock (see [Startup](#startup)).
- **Build jobs** are claimed with a 60-second lease that the running worker
  renews. Each claim is fenced: a worker whose lease has expired cannot write
  its result, and the job stays queued for the next tick. Stale-lease recovery
  fails the jobs left behind by a crashed process. One job per site runs at a
  time, and shared Dokploy application deployments are serialized.
- **Email** is leased per message for 60 seconds and renewed while it is sent.
  A lapsed lease is reclaimed by another replica. `areca_mail_expired_leases`
  counts the ones waiting for reclaim.
- **Storage cleanup** claims each object row (`FOR UPDATE SKIP LOCKED`) before
  deleting it, so two replicas never delete the same object.
- **Retention** deletes bounded batches. Overlapping runs remove different rows.

Two things stay per process. The rate-limit counters during a Redis outage
(see [Redis](#redis)) and each process's worker heartbeat. Readiness and the
`areca_worker_*` metrics describe the process that answered, so each replica
reports its own loops. Set `WORKER_ENABLED=false` on replicas that should only
serve pages.

## Separate worker process

On a small host, run the publishing loops in their own container so they do
not share the web process's event loop and connection pool:

- **Web** (has the domain): `WORKER_ENABLED=false`.
- **Worker** (same image, same environment, no domain): `WORKER_ENABLED=true`,
  a small pool such as `DB_POOL_MAX=4`, and a CPU limit so a large build cannot
  starve the web process.

Both containers run migrations at startup under the migration lock, so either
may start first. The worker container still serves HTTP on its port (its own
health checks use it); nothing routes traffic to it. Keep exactly one worker
container: jobs are claimed safely by several, but one is enough and keeps the
heartbeat in one place. Readiness on the web process skips the worker check
(`worker.enabled: false`); check the worker container's `/api/health/ready`
or its logs for the loops. Publishing, scheduled publishing, mail and cleanup
stop while the worker container is down.

## Request ids

Every response carries `X-Request-Id`. An id sent by the proxy in the same
header is kept, otherwise the server makes one. Every log line written while
handling the request carries it as `requestId`, and responses with status 500
or above are logged as `request failed` with method, path, status and
duration. A 502 that never reaches the server (a proxy-side failure) has no
app log line; look in the proxy's access log for that time and path.

## Worker and scheduler

Publication behavior follows each site's deployment mode. **Production**
publishing requires a configured Dokploy application and publication-aware
health URL; a missing target is a configuration error, not a successful
no-deploy release. **Demo** publications intentionally skip external deployment
and remain labeled demo, never counting as production live releases. See
[deployment](DEPLOYMENT.md) for setup and verification.

Four independent timers, each with its own in-flight guard: job claiming,
stale-lease recovery, scheduling of due entries, and durable storage cleanup.
Cleanup retries failed object deletions independently of long deployments. Claimed jobs run as
tracked in-flight promises with a global cap (`WORKER_CONCURRENCY`, default 2),
and a freed slot is refilled immediately. A job that waits on a slow deployment
(up to 15 minutes) therefore delays neither scheduling, recovery, nor jobs for
other sites. One job per site at a time is still enforced by the database (claim
SQL, partial unique indexes, leases). Shared Dokploy application deployments
are also serialized; this prevents concurrent build-environment changes.
Scheduled failures retry after 1, 5, and 15 minutes, then pause after the fourth
failed attempt. Manual release requests or a new scheduled approval restart the
retry budget.

On `SIGTERM`/`SIGINT` the process stops claiming, waits up to
`WORKER_DRAIN_TIMEOUT_MS` (default 8000) for in-flight jobs, then exits (code 0
when drained, 1 when jobs were still running; a second signal exits at once).
Keep the value below your container stop timeout (Docker's default is 10s; raise
`stop_grace_period` if you want longer drains). A job that does not finish keeps
its lease and is failed by stale-lease recovery after restart. The Docker
entrypoint forwards the signal to the server process and waits for it to exit.

## Environment variables

| Variable                          | Default | Meaning                                                                                                |
| --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `STARTUP_DEADLINE_SECONDS`        | `60`    | Total time startup may wait for PostgreSQL, the migration lock and S3 before exiting with code 1       |
| `CSP_REPORT_ONLY`                 | `false` | Send the Content-Security-Policy as Report-Only (see [Content Security Policy](#content-security-policy)) |
| `METRICS_TOKEN`                   | unset   | Bearer token (min 16 chars) for `/api/metrics`; unset means 404. Generate with `openssl rand -hex 32`. |
| `LOG_LEVEL`                       | `info`  | Log threshold                                                                                          |
| `WORKER_CONCURRENCY`              | `2`     | Max build jobs processed at once by this process                                                       |
| `WORKER_DRAIN_TIMEOUT_MS`         | `8000`  | Shutdown wait for in-flight jobs                                                                       |
| `DB_CONNECT_TIMEOUT_MS`           | `5000`  | See above                                                                                              |
| `DB_STATEMENT_TIMEOUT_MS`         | `15000` | See above                                                                                              |
| `DB_IDLE_IN_TX_TIMEOUT_MS`        | `30000` | See above                                                                                              |
| `DB_POOL_MAX`                     | `10`    | Max connections in the main PostgreSQL pool of this process                                            |
| `READINESS_TIMEOUT_MS`            | `3000`  | Per-check timeout for readiness                                                                        |
| `READINESS_MAX_QUEUE_AGE_SECONDS` | `900`   | Oldest queued job age that fails readiness                                                             |
| `READINESS_MAX_TICK_AGE_SECONDS`  | `300`   | Worker/scheduler tick age (and expired-lease age) that fails readiness                                 |

### Recover an administrator verification lockout

Five failed local factor attempts lock an administrator for 15 minutes across
sessions. Another agency administrator with a freshly verified local factor can
use **Agency → People → Reset verification lockout**. This resets the failure
counter only; the locked administrator must still verify their own TOTP or backup
code. Administrators cannot reset their own lockout in the browser.

If every administrator is locked out, an operator with access to the CMS host can
run the recovery command with the production environment loaded:

```sh
cd apps/cms
node scripts/reset-mfa-lockout.mjs --email admin@example.com --confirm
```

The command writes an audit event and removes only the named administrator's
failure counter. It preserves MFA enrollment, credentials, and session factor
proof requirements. It does not recover a lost authenticator or replace backup
codes. Wait for expiry if operator access is unavailable.
