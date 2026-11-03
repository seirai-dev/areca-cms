# Concurrent CMS user benchmark

Historical results: [initial capacity run](results/2026-11-03-capacity.md), [first performance rerun](results/rerun-2026-11-03/report.md), and [latest rerun / Dokploy review](results/rerun-2026-11-03-1348/report.md). These describe their tested artifacts and hardware, not a universal capacity limit.

This suite drives the real deployed TanStack Start server functions and media HTTP routes with k6. Its users are deterministic programmatic state machines with independent random streams, identities, cookies, choices, and writable drafts. No LLM runs a simulated user.

**Profile: intensive, continuously active users.** There are no long idle periods. The recorded workload deliberately remains unchanged for repeat comparisons: it performs an extra entry read before every save and reloads collection metadata on editor opening instead of fully matching the UI cache. It also produces whole synthetic articles after short edit pauses and exercises frequent administrative/lifecycle reversals. Treat results as this stress profile's capacity, not the number of ordinary logged-in users. Correcting those behaviors or adding an everyday profile should be a separately named workload with new results. See the [journey diagram](results/user-journey.html).

## Target and fixtures

- Target URL and SSH host are required configuration; no server is selected by default. Use only a disposable deployment you control.
- The target is a Linux Docker host with Python 3, a single `postgres:18` container, Redis, RustFS, and an Areca CMS image exposing `.output/server/_ssr` artifacts. The monitor/report inventory expects CMS stack names starting with `areca-cms-` and the proxy named `dokploy-traefik`; adapt those selectors for a differently named topology. Swarm web/worker service names are configurable. The runner currently tests **one web replica**.
- Generator: Node 24+, pnpm dependencies (`pnpm install --frozen-lockfile` at repository root), OpenSSH, and k6 on Windows/Linux/macOS. Set `K6_BIN` to the binary path or `k6` when on PATH. k6 2.3.0 produced the archived results; match the version for comparisons. The binary is not committed. Windows generator CPU/memory sampling is automatic; on other operating systems monitor generator saturation separately.
- 2,000 accounts: 100 agency admins, 400 owners, 1,500 editors, interleaved so small tiers contain multiple roles.
- 40 clients, 2 sites/client, 3 collections/site: articles, news, pages.
- 13,200 initial entries: 7,200 shared browsing entries and 6,000 private writable drafts. Shared entries include drafts, published and archived states; rich text is several KiB.
- Up to 45 real JPEG assets per client, uploaded through the real application and stored in RustFS. The first and second 40-row library pages both have data.
- Site groups share organization locks and database tables. Each user edits their own drafts, avoiding contrived version conflicts. New entries have unique slugs. Random choices are reproducible with `BENCH_SEED`.

The original account remains intact. Fixture passwords, signed session cookies and generated assets live under ignored `.local/`; they are not committed. The auth secret stays inside the app container.

## What a user does

Each iteration makes one screen-dependent choice, then keeps that screen and its local state for the next iteration. Users wait 2–9 seconds between choices, spend another 5–20 seconds editing or 6–22 seconds composing, and can stay, search, paginate, edit, or navigate away. These are weighted choices rather than a fixed loop through every endpoint.

| Screen             | Available choices                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site navigation    | Fetch authenticated HTML on arrival and occasional hard reloads. Load current user/site permissions, collection metadata, three sidebar count requests, globals, then first collection page. Sidebar counts have a 60-second cache. |
| Collection         | Open an owned draft, search, filter status, load another 25-row page, compose/save a new article, switch collection, visit Library; admins can enter client management.                                                             |
| Editor             | Load entry/schema/preview URL; change several fields and autosave once; inspect revisions/inbound references; select a library image for a later save; return to collection.                                                        |
| Owner/admin editor | Also mark ready then return to draft; schedule tomorrow then cancel; archive; delete a disposable entry created by this VU. Version checks use a freshly fetched draft version.                                                     |
| Library            | Browse/search 40-row pages; select images; upload a real 1280×720 JPEG (about 435 KiB), update alt text, download it through the CMS, and sometimes delete the unreferenced upload.                                                 |
| Agency management  | List clients/sites; compose a client, create its site and define its first collection. At most two client/site creations per admin per tier.                                                                                        |

Ordinary editors cannot publish or delete. Destructive entry actions only target that VU's newly created entries. Client creation is bounded and occurs during the first eight scenario minutes, while the admin's session freshness still satisfies step-up requirements.

The resulting request mix is an outcome of these choices, persona proportions, and think times. Raw samples report the actual operation mix and requests/second; the suite does not claim a fixed 60/30/10 split.

## Sessions and scope

Preparation hashes a disposable password with the installed Better Auth implementation and provisions unique users, memberships and valid signed sessions. Admin sessions have synthetic local-MFA verification records. This deliberately measures **already authenticated CMS usage**, with normal session, authorization, CSRF, Redis rate-limit and database checks left enabled. It does not measure password hashing/MFA challenge throughput or a 2,000-person login surge. Preflight separately verifies a real password login and the seeded identity.

These are HTTP simulations of SPA workflows. They exercise the requests caused by navigation, editing and media use; they do not run 2,000 Chromium instances or measure React rendering, editor typing FPS, browser memory, or repeated cold JavaScript/CSS downloads. Sidebar count requests are sequential per VU in this version, although the UI can issue them concurrently. Active release/build polling, actual site builds/deployments, AI calls, email flows, development-environment forks and multi-user editing conflicts are outside this first profile. No external services or real site builds are triggered. Schedule/cancel and private preview-token generation are included.

## Tiers and acceptance

Run separate processes at **10, 25, 50, 100, 200, 500, 1,000, 1,500, 2,000 concurrent users**.

Each tier has a 60-second ramp, 60-second settling period, then **10 minutes measured at the target concurrency**, followed by up to 30 seconds for in-flight actions. Ramp/settle/shutdown samples are excluded from the custom acceptance metrics. A baseline DB restore, app restart, health recovery and 60-second cooldown happen before every tier. Redis budgets expire during cooldown. Expect roughly two hours for all tiers if they pass.

The database baseline snapshot includes the original account and synthetic fixtures. Restoring it replaces the disposable CMS database contents before each tier; it does not touch other Docker services or databases. The app is briefly stopped during restore. Snapshot and fixture credentials remain private on their respective machines. Uploaded S3 objects from previous tiers remain on disk after DB restore, so object storage disk consumption is cumulative; disk headroom is monitored and reported. Do not use this restore mechanism against a production database.

All three requested limits must hold in each tier's measured window:

- p95 request latency **< 500 ms**.
- p99 request latency **< 1,000 ms**.
- Request failures **< 1%**, including non-200 responses, timeouts, redirects, serialized application errors and invalid response shapes.

Latency uses k6 HTTP duration (sending + waiting + receiving). A separate wall-clock metric includes connection/TLS/client waiting overhead. Think time is excluded. Media upload/download requests participate in the main limits. Whole-minute and operation-level distributions are available in `report.json`, so aggregate reads cannot hide slow writes. At least 1,000 measured requests are required; a smaller sample is inconclusive. Failed logical actions must also remain below 1% to catch script exceptions. These thresholds are defined with [k6 thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/).

The runner stops escalation at the first failed/inconclusive tier. Higher tiers are labeled untested. After reviewing the failure, rerun that tier or bracket between the last passing and first failing tiers. A passing tier is evidence for this workload and data shape, not a promise about every usage pattern.

## Resource monitoring and stop conditions

The runner samples VPS resources about every 5 seconds over a separate SSH connection:

- Host CPU utilization, load, available RAM, swap, disk free, raw disk I/O counters and I/O pressure.
- Per-container CPU, memory, network/block I/O, process count, restart counters, OOM/stopped state.
- Every third sample: PostgreSQL connections, active transactions, lock waits, idle transactions, commits/rollbacks, deadlocks, temporary bytes and block cache counters.
- Every third sample: Redis memory, connections, blocked/rejected clients, evictions, errors, commands and CPU counters; internal CMS liveness and RustFS readiness latency/status. Transaction age and PostgreSQL wait events help distinguish query/lock pressure from application CPU pressure. Probe credentials remain inside the app container.
- Slow/failed request samples include operation, timestamp, status and duration. Per-tier service logs are captured after the measurement window. Attribution must distinguish measured correlation from a confirmed cause; CPU utilization alone does not prove a component defect.
- Generator CPU, working set, thread count and free host memory. Generator saturation makes a result suspect and must be reviewed before declaring a server capacity ceiling.

Stop immediately for an OOM, container restart/stoppage, missing required container, <2 GiB disk free, <200 MiB available RAM for three samples, three consecutive monitor errors, or no resource sample for 20 seconds. CPU saturation alone is recorded rather than treated as a dangerous condition. Threshold failure stops the next tier. Ctrl+C stops the current load. Samples are operational data only; container environment variables and SSH secrets are never logged.

## Commands

Run from the repository root. The examples use PowerShell; on Linux/macOS use `export NAME=value` for the same variables. Configure a new target explicitly:

```powershell
$env:BENCH_URL='https://cms-benchmark.example.com'
$env:BENCH_SSH='user@your-disposable-docker-host'
$env:BENCH_SERVICE='areca-cms-app-your-id' # Swarm web service
$env:BENCH_WORKER_SERVICE='areca-cms-worker-your-id' # if a separate worker exists
# For Compose instead, unset BENCH_SERVICE and set BENCH_CONTAINER.
$env:K6_BIN='k6' # or an absolute executable path
```

The SSH key/agent must already work, and that user needs Docker access. No Dokploy API key is needed to run the suite. All fixture passwords and signed cookies are generated during setup; the original account's credentials are not needed.

On a **new disposable target**, seed and validate before load:

```powershell
node apps/cms/benchmarks/build.mjs
$env:ARECA_BENCHMARK='1'
node apps/cms/benchmarks/prepare.mjs
node apps/cms/benchmarks/preflight.mjs
node apps/cms/benchmarks/seed-media.mjs
node apps/cms/benchmarks/snapshot.mjs
node --test apps/cms/benchmarks/workload.test.mjs
```

`prepare.mjs` creates a new fixture namespace on every invocation. Reuse the existing ignored fixtures for reruns; don't repeatedly prepare unless you want another dataset. Media seeding is resumable by filename. `BENCH_USERS` defaults to 2,000; target URL/SSH/service or container must be supplied. Remote DB commands discover the single running `postgres:18` container and use its internal credentials. The discovery is intended for this isolated stack.

On another generator against the same target, privately transfer the matching `.local` fixture/config/manifest/media inputs, or prepare a new cohort. Git contains neither live credentials nor database dumps. Never reuse a fixture file against another database or copy historical build-specific RPC IDs into a new deployment.

For a Swarm deployment, set `BENCH_SERVICE` to its service name in every command that accesses the server. Task containers are discovered dynamically. On a redeployment, set `BENCH_URL`, run `refresh-deployment.mjs` to discover that build's RPC IDs, rebuild the workload, and run preflight. `snapshot.mjs` records a new timestamped baseline of the current schema; retain the old snapshot but do not restore it across migrations. The runner checks the image content ID at startup and after every reset.

For an existing cohort, refresh in this order (no new users):

```powershell
node apps/cms/benchmarks/refresh-deployment.mjs
node apps/cms/benchmarks/build.mjs
node apps/cms/benchmarks/refresh-sessions.mjs
node apps/cms/benchmarks/preflight.mjs
$env:ARECA_BENCHMARK='1'
node apps/cms/benchmarks/snapshot.mjs
```

An enabled `/api/metrics` is scraped inside the CMS container using its existing `METRICS_TOKEN`; the token is never included in resource output. `configure-metrics.mjs` can install a token from a private file for a Swarm service. Resource output includes application pool total/idle/waiting, event-loop utilization/delay, memory and worker metrics when exposed by the deployment.

Only **after the workload is approved**:

```powershell
$env:ARECA_RUN_LOAD='YES'
$env:BENCH_LEVELS='500,750,1000' # optional; defaults to the full tier list
node apps/cms/benchmarks/run.mjs
# To repeat selected tiers:
$env:BENCH_LEVELS='100,200'
node apps/cms/benchmarks/run.mjs
# Generate operation and minute summaries for a completed tier:
node apps/cms/benchmarks/report.mjs '<absolute path to tier directory>'
node apps/cms/benchmarks/render-results.mjs '<absolute path to formal run directory>'
# Preserve prior charts/results by choosing a separate output directory:
node apps/cms/benchmarks/render-results.mjs '<run directory>' 'apps/cms/benchmarks/results/rerun'
# After diagnostics, restore the private baseline (replaces the CMS DB):
$env:ARECA_BENCHMARK='1'
node apps/cms/benchmarks/restore-baseline.mjs
```

When `BENCH_WORKER_SERVICE` is set, baseline restores pause that worker and restore its prior replica count afterward. The web service is restarted at one replica. Do not use this runner unchanged for a multi-web-replica experiment. `inspect-deployment.mjs` saves a read-only, allowlisted runtime/PostgreSQL configuration inventory under ignored `.local/` by default.

`K6_BIN` can point at a different k6 executable; otherwise the runner searches `.local/tools`. The local binary used for this preparation is the [official k6 2.3.0 Windows release](https://github.com/grafana/k6/releases/tag/v2.3.0). Generator defaults preserve certificate validation and do not spoof source addresses or disable rate limiting.

Each results directory contains run metadata and per-tier k6 logs, compressed raw samples, acceptance summary, resource JSONL, and generator JSONL. `report.mjs` derives operation/minute distributions from measured raw samples. No benchmark result is asserted until an actual tier has run.

## Separate diagnostics

These checks must run separately from formal capacity measurements. CPU profiling changes timing and is excluded from acceptance results. The profile controller locates the CMS server child process, enables the inspector only on container loopback, reads the existing pool without changing its limit, and closes the inspector afterward.

```powershell
# During a separate guarded diagnostic replay:
$env:BENCH_CPU_PROFILE='YES'
node apps/cms/benchmarks/capture-profile.mjs '<output directory>'
node apps/cms/benchmarks/analyze-profile.mjs '<output directory>'
# After all load traffic has stopped; test objects are deleted:
$env:BENCH_STORAGE_CHECK='YES'
$env:BENCH_STORAGE_CONTAINER='areca-cms-s3-your-id-rustfs-1'
node apps/cms/benchmarks/storage-diagnostic.mjs
```

The storage check compares fresh/reused SDK clients and public/internal endpoints. It discovers a shared Docker network and keeps credentials inside the CMS container. `BENCH_STORAGE_CONTAINER` overrides the RustFS container name. Its small sequential sample is not a capacity estimate. If the deployed app changes, refresh the build-specific RPC mapping and verify the workload/fixtures before comparing a rerun; do not silently reuse RPC IDs from an old image.
