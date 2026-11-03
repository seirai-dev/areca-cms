# Performance-fix rerun — November 3, 2026

**500 users still fails latency, despite a substantial improvement.** The full ten-minute measurement produced 58,306 requests, p95 **1,825 ms**, p99 **2,512 ms**, and **one failed request (0.0017%)**. Escalation stopped; 750, 1,000 and 1,500 users were not tested.

| Metric at 500 users   | Previous build | Current deployment |      Requirement |
| --------------------- | -------------: | -----------------: | ---------------: |
| p95                   |       5,900 ms |           1,825 ms |   <500 ms — FAIL |
| p99                   |       7,301 ms |           2,512 ms | <1,000 ms — FAIL |
| Failed requests       |             0% | 0.0017% (1/58,306) |       <1% — PASS |
| Measured requests/sec |          62.69 |              97.18 |    Informational |
| Measured requests     |         37,611 |             58,306 |   At least 1,000 |

p95 improved **69.1%**, p99 **65.6%**, and request throughput **55.0%**. This is a comparison of realistic old/new UI request mixes: the new build batches sidebar counts and returns entry summaries. It is not an identical-endpoint microbenchmark. Browser rendering and the changed UI's exact autosave timing were not measured; the logical users retain the approved randomized actions and think times.

## When it failed

The measured window was **12:37:51–12:47:51 CET** (11:37:51–11:47:51 UTC), after a 60-second ramp and 60-second settling period. The first partial minute already failed p95 (821 ms). Every full measured minute failed both latency limits. The worst minute, 12:40 CET, had p95 2,788 ms and p99 3,627 ms.

The one failed request was `updateDraftFn`: **HTTP 502 at 12:40:29.442 CET**, returned in 92 ms. No container restart/OOM accompanied it. Captured CMS/service logs did not explain it, and Traefik had no retained log entries for the narrow incident window. Its cause remains **unresolved**; the evidence does not justify assigning it specifically to PostgreSQL or declaring a proxy defect. Journey failures were 0.00315%, below the suite's additional 1% limit.

## Bottleneck evidence

The strongest evidence remains **CMS CPU and application-side database queueing**, with host CPU pressure. PostgreSQL has more work than before, but its observed execution/locking does not explain the broad multi-second request delays on its own.

| Component  | Measured evidence                                                                                                                                                                       | Assessment                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| CMS        | CPU average 103.8%, peak 139.0% of one core; event-loop utilization average **97.74%**, peak 99.998%; main pool max 10 connections, waiting **0–179**, mean **59.95** across 40 scrapes | Leading observed constraint. Requests wait while the application loop and pool are busy.                                |
| PostgreSQL | CPU average 43.5%, peak 96.4% of one core; at most 4 active queries and one lock waiter sampled; oldest active query max 1.064 s; no rollbacks, deadlocks or temp-file bytes            | Some transient contention, but no evidence of sustained engine/lock/disk saturation. Sampling can miss short events.    |
| Redis      | CPU average 0.56%; no rejected connections or evictions; 39 extra ERR replies                                                                                                           | No demonstrated capacity failure. See the monitoring check below.                                                       |
| RustFS     | CPU average 7.31%; all 40 readiness probes successful, max 293 ms including fresh probe-client overhead                                                                                 | No observed service failure. Successful mixed-workload media operations are not a standalone storage capacity estimate. |
| Traefik    | CPU average 15.25%; no restart/OOM; one unexplained 502                                                                                                                                 | Not the leading CPU constraint; request-level failure attribution needs better logs.                                    |
| VPS        | Host CPU average 88.35%, peak 97.59%; minimum available RAM **1,915.5 MiB**; minimum free disk **27.86 GiB**; average I/O wait 0.216%, steal 0.024%                                     | CPU pressure; substantial memory/disk headroom.                                                                         |

Container CPU uses 100% = one core; host CPU uses 100% = both VPS cores. Resource samples were taken every five seconds, application metrics roughly every fifteen seconds. No resource guard fired. The separate Windows generator had ample CPU and memory headroom.

The busiest operations were `getEntryFn` (12,946 requests, p95 1,695 ms), `listEntriesFn` (11,901, p95 2,210 ms) and `updateDraftFn` (8,373, p95 2,008 ms). Their broad slowdown is consistent with a shared request/pool bottleneck.

### Separate CPU profile

A separate guarded 500-user diagnostic replay followed the formal run. Its 30.7-second CPU capture is **excluded from acceptance results**. Event-loop utilization was 99.10%; the ten-connection pool had 0–109 waiters, mean 44.6, across 31 samples. Approximately **23.9%** of sampled main-thread time was inside the bundled Drizzle/PostgreSQL client code, another **7.6%** in a native `writev` frame whose stack submits PostgreSQL queries, and **4.2%** in garbage collection. These are code-location sample shares, not proof that the ORM itself is defective or additive independent improvements.

### Redis monitoring check

After load stopped, two consecutive read-only Redis INFO calls added **zero** errors; one authenticated `/api/metrics` scrape added **one ERR**, while returning HTTP 200. The direct probe's Redis authentication succeeded. This reproduces an error-counter side effect on the metrics/readiness path, which opens a new Redis client in `defaultCheckRedis()`. It explains why the observed count closely follows scrapes; it is not evidence of request-load saturation. The exact rejected command remains unidentified. Record its type and check Redis/client negotiation compatibility rather than treating the aggregate counter as an application request failure.

## Action points

1. **Measure and reduce remaining SQL/client work per RPC.** Add query count, pool-acquisition wait, SQL execution time, returned rows/bytes and response bytes by bounded operation name. Start with `getEntryFn`, `listEntriesFn` and `updateDraftFn`. Request-scoped session reuse is already implemented; preserve it. Inspect the remaining entry/site/membership reads in [access.ts](../../../src/server/content/access.ts:24), list/context/count reads in [entries.ts](../../../src/server/content/entries.ts:228), and editor reads in [content.ts](../../../src/server/fn/content.ts:218). Use measured query counts to choose joins or additional request-scoped reuse while preserving tenant/role/MFA checks.
2. **Avoid loading full content documents for list summaries.** [listEntrySummaries](../../../src/server/content/entries.ts:242) still fetches `draftData` and `publishedData` and computes title, cover, change state and language coverage for each row. Test maintained summary fields or narrower projections so lists avoid transferring/parsing whole documents. The new list indexes are present in the deployed database. Capture JSON bytes and CPU/allocations before choosing a design; this is a concrete candidate, not a measured function-level cause.
3. **Run controlled pool/process experiments.** `DB_POOL_MAX` is now configurable in [db/index.ts](../../../src/db/index.ts:24), but this run used 10. Compare 10/15/20 and one versus two CMS processes/replicas with the same workload and CPU budget. Watch pool wait, event-loop utilization, PostgreSQL CPU and tail latency. Do not assume more connections fix an already busy event loop. If both cores remain saturated, compare a larger VPS or move PostgreSQL/storage off the CMS host.
4. **Make the next 502 diagnosable.** Enable bounded structured Traefik access/error logs and correlate a request ID with CMS logs, status and duration. Preserve enough history around a run. Investigate the draft-save 502 once this evidence is available; it is not explained by this capture.
5. **Keep observability cheap and interpretable.** [collectMetrics](../../../src/server/ops/metrics.ts:289) performs SQL/backlog/readiness work on every scrape, and [defaultCheckRedis](../../../src/server/ops/health.ts:138) opens a client each time. Identify the reproducible Redis ERR and consider reusing the health client or caching expensive readiness/backlog snapshots. Current scrape frequency is low; no A/B test establishes a material capacity gain from this change.
6. **Retest 500 after fixes; only then advance.** Keep the same fixtures, randomized choices, think times, duration and thresholds. Use 250/300/400 if a tighter current ceiling is needed. This rerun does not establish a new maximum passing concurrency.

## Reproduction and final state

- VPS: 2 Haswell-class vCPUs, 3.73 GiB RAM, no swap; CMS, PostgreSQL 18, Redis 8, RustFS and Traefik share the host.
- Tested URL: `https://areca-cms-app-3vywdg-dd6bb0-159-173-131-30.sslip.io`.
- Tested image content ID: `sha256:648bcdb594c1c2a955a97aa0af7fb4e4d78929827d43a9bebf5353eac22b3570`. The mutable image tag was checked against this ID before and after baseline reset. The image has no OCI revision label; do not infer its exact Git commit from the tag.
- 2,000 unique seeded users/sessions, 40 clients, 80 sites, 240 collections, 13,200 initial entries and 1,800 JPEG fixtures. The current-schema baseline was saved before the run and restored afterward. Disposable uploaded S3 blobs remain on disk and were included in disk monitoring.
- Seed 12345; workload SHA-256 `08c019aea1b4afe8cba7a986c4ddabc2e29fe709d83822d057ad742e89474790`. Batched sidebar counts enabled. Authenticated HTTP/SPA users with normal authorization, CSRF and rate limits; no login/MFA surge, browser rendering, external builds, AI or email load.
- Preflight passed 33 checks; wire/state-machine tests passed, including 24,000 randomized choices. `/api/metrics` authentication was enabled without exposing its token. Server-function IDs came from the tested deployed artifacts.
- Raw formal run: ignored `.local/results-2026-11-03T11-34-09.062Z`; separate profile: `.local/cpu-diagnostic-rerun-500`. Private cookies, credentials and raw logs remain ignored.
- After all measurements/diagnostics, fetched and checked out **`perf/request-path-load` at `02ac1cc`**; `git pull --ff-only` reported up to date. Benchmark files/results were preserved. No application source was edited or redeployed during the measurements.
- The fresh baseline is restored, CMS health passes, and no k6 process remains.

[Sanitized results](capacity-results.json) · [Charts](capacity-summary.html) · [Suite instructions](../../README.md) · [Previous report](../2026-11-03-capacity.md)
