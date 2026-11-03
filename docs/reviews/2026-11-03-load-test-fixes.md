# Load test fixes (3 November 2026)

Follow-up to the 500-user k6 rerun on the benchmark VPS (p95 1,825 ms, p99
2,512 ms, one unexplained 502). That run showed the CMS process as the limit:
event loop at ~98%, a 10-connection pool with ~60 waiters, PostgreSQL at ~43%
of one core. This round cuts the work per request and tunes the deployment.
Nothing here was measured under load yet; the next k6 run at 500 users should.

## Code changes

### Fewer queries per request

| Server function                  | Before                                                                   | After (signed-in, session cached)                                        |
| -------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `getEntryFn`                     | session, entry, site, membership, user names                             | entry + collection + site + membership + names in one query              |
| `listEntriesFn`                  | session, site, membership, collection, site languages again, page, count | site + membership, collection, page with total                           |
| `updateDraftFn` (plain autosave) | 5 reads before the transaction, 8 statements inside                      | 2 reads before (session, guard), 7 inside plus up to 2 ownership lookups |

- `requireSiteAccess` and `requireEntryAccess` (`server/content/access.ts`)
  read the object and the caller's membership in one query (LEFT JOIN on the
  caller's id), then decide in memory in the same order as before: missing or
  hidden object, membership (agency admins: two-factor), dev-site visibility,
  role. `resolveOrgMembership` (`lib/session.server.ts`) holds that decision.
- `updateDraftFn` passes the rows the guard read to `updateDraft`, which no
  longer reads entry, collection and site again. The draft-version check in
  the UPDATE still catches concurrent saves.
- `listEntriesFn` passes the site's languages from the guard.
- The autosave revision write is one statement (update the newest revision if
  it is this person's autosave within 10 minutes, otherwise insert).
- `validateContentOwnership` collects every asset id, embedded image storage
  key and reference first, then checks them in at most two queries instead of
  one per image, image field and reference. It runs inside the save
  transaction, so this shortens how long each save holds a pool connection.

### Lighter entry lists

`listEntrySummaries` no longer reads both full documents per row. PostgreSQL
returns the first text field's value (title), the first image field's value
(cover) and the "edited since ready" flag (`draft_data is distinct from
published_data`, the same answer as the JS deep compare). The draft is only
sent on multilingual sites, for the coverage chips. The page and the total
come from one statement (`count(*) over ()` in a CTE). `summaryFromParts`
(`lib/content/entry-summary.ts`) builds the summary; `toEntrySummary` still
builds it from whole rows and the parity test compares both.

### Overview

The overview made one list request per collection for "Recently edited" and
another per collection for "Drafts waiting". Both are now one site-wide request
each (`listRecentEntriesFn`), under `['entries', siteId, ' overview', …]` so
saves and dev-env actions invalidate them. "Drafts waiting" now shows the exact
number of drafts last saved by someone else (it used to count only the newest
ten per collection).

### Session cookie cache (reads only)

Better Auth's cookie cache is on (`SESSION_COOKIE_CACHE_SECONDS`, default 60).
GET and HEAD requests trust the signed cookie and skip the session and user
reads. Every write, and everything outside a request, reads the session from
the database (`loadSession` passes `disableCookieCache`). Effect for users:
after signing out another device, a password reset, a block or an admin
change, a browser that already holds the cookie can keep **reading** for up to
60 seconds. It can never save, publish or change anything in that time. Tests
run with the cache off (`vitest.config.ts`); `access.db.test.ts` checks the
read/write split.

### Search

Migration `0042_entry_search_trgm` enables `pg_trgm` and adds trigram GIN
indexes on `entry.slug` and `entry.draft_data::text`, which is what list search
matches with `ILIKE`. Search results are unchanged; saves update one more
index.

### Smaller pages

The reference picker loads 25 entries per page instead of 50.

### Monitoring and the 502

- Redis clients send `maintNotifications: 'disabled'`. With the default the
  client sends `CLIENT MAINT_NOTIFICATIONS` (Redis Enterprise only) on every
  connect, which open-source Redis counts as an ERR. That was the one ERR per
  `/api/metrics` scrape.
- Readiness keeps one Redis connection instead of opening one per check, and
  `/api/health/ready` and `/api/metrics` share a readiness report for 5 s.
- Node's idle keep-alive timeout was 5 s; Traefik keeps idle upstream
  connections for 90 s and can reuse one the server is closing, which gives a
  fast 502 (the 92 ms `updateDraftFn` 502 fits). The container entrypoint now
  preloads a module that sets `keepAliveTimeout` to 120 s and `headersTimeout`
  to 121 s (`HTTP_KEEP_ALIVE_TIMEOUT_MS`), since Nitro creates the server
  without options.
- Every response has `X-Request-Id`, every log line during a request has
  `requestId`, and 5xx responses are logged with method, path, status and
  duration.

## Deployment changes (benchmark Dokploy, project "Areca CMS")

All on the "Fontaine VPS" (2 vCPU, 3.73 GiB RAM, no swap). Builds run on the
separate build server and push to ghcr, so they do not use VPS CPU.

### New `worker` application

Same GitHub source, branch (`perf/request-path-load`), Dockerfile
(`apps/cms/Dockerfile`, context `.`), build server and registry as `app`. No
domain. Same environment as `app` except `WORKER_ENABLED=true` and
`DB_POOL_MAX=4`. Limits: 0.75 CPU, 768 MiB (256 MiB reserved). Auto-deploy on
push, like `app`.

### `app` (web)

| Setting                        | Before        | After                                                   |
| ------------------------------ | ------------- | ------------------------------------------------------- |
| `WORKER_ENABLED`               | unset (true)  | `false`                                                 |
| `DB_POOL_MAX`                  | unset (10)    | `16`                                                    |
| `RATE_LIMIT_TRUST_PROXY`       | unset (false) | `true` (Traefik replaces untrusted forwarding headers)  |
| `SESSION_COOKIE_CACHE_SECONDS` | —             | `60`                                                    |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS`   | —             | `120000`                                                |
| `NODE_OPTIONS`                 | unset         | `--max-semi-space-size=32` (fewer young-generation GCs) |
| Memory                         | unlimited     | 1 GiB limit, 512 MiB reserved                           |
| CPU                            | unlimited     | unlimited (it is the bottleneck)                        |

### PostgreSQL 18 (`db`)

Container args (`postgres -c …`); defaults were stock (128 MB shared buffers).

| Setting                                         | Value                                                                | Why                                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `shared_buffers`                                | 768MB                                                                | The working set fits in memory.                                                                                                   |
| `effective_cache_size`                          | 2GB                                                                  | Planner hint for the OS cache.                                                                                                    |
| `work_mem` / `maintenance_work_mem`             | 8MB / 128MB                                                          | Sorts and index builds.                                                                                                           |
| `max_connections`                               | 60                                                                   | Web 16 + worker 4 + side pools + admin.                                                                                           |
| `random_page_cost` / `effective_io_concurrency` | 1.1 / 200                                                            | SSD storage.                                                                                                                      |
| `wal_buffers`, `max_wal_size`, `min_wal_size`   | 16MB, 2GB, 256MB                                                     | Fewer checkpoints under write load.                                                                                               |
| `jit`                                           | off                                                                  | JIT compile time costs more than it saves on short queries.                                                                       |
| `max_parallel_workers_per_gather`               | 0                                                                    | Two shared cores; parallel workers only steal CPU. Also avoids Docker's 64 MB `/dev/shm`.                                         |
| `shared_preload_libraries`                      | `pg_stat_statements` (`track=top`, `max=2000`), `track_io_timing=on` | Per-query timings for the next run. Run `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` in `app_db` before reading the view. |
| `log_min_duration_statement`                    | 1000                                                                 | Logs statements slower than 1 s.                                                                                                  |

Memory: 1.5 GiB limit, 1 GiB reserved.

### Redis 8 (`redis`)

256 MiB limit, 64 MiB reserved. Configuration unchanged.

### RustFS (`s3` compose)

`cpus: 1.0`, `mem_limit: 768m`, so upload bursts cannot starve the CMS and
PostgreSQL.

### Not changed

- Traefik (Dokploy-managed, shared by every app on the server). The keep-alive
  fix is on the CMS side. Access logs are still off; enable them in the
  Dokploy Traefik settings if the next run shows a 502 again.
- The Redis ERR counter: expect it to stay flat now.

## For the next run

- Same fixtures, seed, think times, duration and thresholds; 500 users first.
- Run `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` once, then read the
  top statements by `total_exec_time` after the run.
- `/api/metrics` on the web container now describes only the web process; the
  worker's loops are in the worker container.
