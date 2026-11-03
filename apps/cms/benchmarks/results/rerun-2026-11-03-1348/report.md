# 500-user rerun and Dokploy review — November 3, 2026

**500 users still fails both latency limits.** The complete ten-minute measured window produced **59,773 requests**, p95 **1,487 ms**, p99 **2,158 ms**, and **zero failed requests**. The 750- and 1,000-user tiers were not run because escalation stops at the first failed tier.

| Metric at 500 users | Original | Previous rerun |     This run | Requirement      |
| ------------------- | -------: | -------------: | -----------: | ---------------- |
| p95                 | 5,900 ms |       1,825 ms | **1,487 ms** | <500 ms — FAIL   |
| p99                 | 7,301 ms |       2,512 ms | **2,158 ms** | <1,000 ms — FAIL |
| Request failures    |       0% |        0.0017% |       **0%** | <1% — PASS       |
| Requests/sec        |    62.69 |          97.18 |    **99.62** | Informational    |

Versus the previous rerun, p95 improved **18.5%**, p99 **14.1%**, and throughput **2.5%**. The sampled database commit delta fell about **53%** (352,800 → 165,173). This is not an exact per-request SQL count, but supports that the new code substantially reduced database round trips. Throughput improving only slightly despite this reduction is consistent with the remaining CMS CPU constraint.

## When it failed

Measurement ran **13:51:48–14:01:48 CET** (12:51:48–13:01:48 UTC), after a 60-second ramp and 60-second settling period. The first measured draft save already took 1,306 ms. Every minute bucket failed both latency limits. There were no HTTP, semantic or journey failures and no resource-guard aborts.

Examples of measured operation tails:

| Operation    | Requests |      p95 |      p99 |
| ------------ | -------: | -------: | -------: |
| Open entry   |   13,323 |   733 ms | 1,179 ms |
| List entries |   12,168 | 1,243 ms | 1,666 ms |
| Save draft   |    8,623 | 1,817 ms | 2,121 ms |
| Create entry |    1,244 | 2,496 ms | 2,953 ms |
| Upload media |    1,014 | 2,665 ms | 3,009 ms |

Reads improved markedly; writes and uploads remain especially slow. An upload's end-to-end latency includes CMS authorization, parsing, database and storage work, so it cannot be assigned to RustFS alone.

## What is limiting it?

**The strongest evidence is the current single-process CMS plus the shared two-vCPU CPU budget.** There is no observed artificial CPU cap on the web CMS. This does not prove that all software optimization is exhausted, or that a particular larger VPS will pass; a controlled hardware/process comparison is needed for that conclusion.

| Component  | Evidence during measurement                                                                                                                                                   | Assessment                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| CMS        | Event-loop utilization averaged **97.91%**, peaked at 100%; CPU averaged **107.1% of one core**. Main pool max 16, waiting **0–105**, mean **33.15**, across 40 scrapes.      | Leading observed constraint: busy event loop and application-side queueing.              |
| PostgreSQL | CPU average **39.1% of one core**; at most 3 active queries sampled; oldest sampled active query 64.6 ms; zero sampled lock waiters, deadlocks, rollbacks or temp-file bytes. | Engine/disk/locking did not show sustained saturation. Short waits can escape sampling.  |
| Worker     | Average **1.23% of one core**, peak 38.4%.                                                                                                                                    | The worker split is present; background work is not the principal load in this workload. |
| Redis      | Average CPU 0.50%; zero new errors, rejected connections or evictions.                                                                                                        | No observed capacity failure or recurrence of the old scrape-related ERR.                |
| RustFS     | Average CPU 7.66%, peak 46.7%; readiness probes successful.                                                                                                                   | No demonstrated storage-service saturation.                                              |
| Traefik    | Average CPU 15.47%; no request failures.                                                                                                                                      | Not the leading observed constraint. No recurrence of the earlier 502 in this run.       |
| VPS        | Host CPU average **89.38%**, peak **96.18%**; average I/O wait 0.20%, steal 0.022%; minimum available RAM **1,827.5 MiB**, disk free **27.01 GiB**.                           | CPU pressure with substantial RAM/disk headroom. No OOM or service restart.              |

Container CPU uses 100% = one core; host CPU uses 100% = both cores. The generator had ample CPU/memory headroom. Monitoring overhead is included in the VPS load.

### Separate profile and SQL statistics

A separate guarded 500-user replay supplied a 30.7-second CPU profile, **excluded from acceptance results**. Event-loop utilization was 98.53%; the 16-connection pool had 0–86 waiters, mean 17.5. Approximately **18.6%** of sampled main-thread time was inside the Drizzle/PostgreSQL client bundle, down from 23.9% in the prior diagnostic; **5.0%** was garbage collection. Native query-submission/write stacks and HTTP/auth/serialization work also remain. These are sampled code locations, not proof that the ORM itself is defective.

`pg_stat_statements` was enabled for inspection using the already-preloaded module. Its counters cover **13:33:21 CET onward**, including migrations, preflight, the formal run and diagnostics; they are **not formal-window-only**. Leading examples:

| Statement family                     | Calls at inspection | Mean execution | Max execution |
| ------------------------------------ | ------------------: | -------------: | ------------: |
| Draft UPDATE with full-row RETURNING |              11,390 |        9.46 ms |        252 ms |
| Searched collection page             |               3,351 |        9.99 ms |         77 ms |
| Entry/access join                    |              35,774 |        0.61 ms |         59 ms |
| Unfiltered collection page           |               8,023 |        2.32 ms |         59 ms |

The draft UPDATE accounted for about 108 seconds of cumulative server execution. That makes write/index cost worth examining, but query execution times alone do not explain multi-second RPC tails. The new trigram and list indexes are present in the database.

## Dokploy configuration review

Read-only Dokploy API inspection was cross-checked against Docker Swarm, container cgroups, live environment values, PostgreSQL settings and generated routing. No API configuration was changed. The API key remained in a private file and is absent from reports/output.

| Setting          | Verified state                                                                                                                           | Implication                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Web replicas/CPU | One replica; no CPU limit or pinning; `cpu.max = max 100000`, `nr_throttled = 0` in the post-run task capture                            | No Dokploy CPU quota explains the web bottleneck. Only one web process serves requests.                        |
| Web memory       | 1 GiB limit, 512 MiB reserved; peak measured container memory 329.8 MiB; no memory-limit/OOM events                                      | Raising this limit is not supported as the current fix.                                                        |
| Worker           | Separate service, one replica, no public domain; `WORKER_ENABLED=true`, pool 4; 0.75 CPU and 768 MiB limits                              | Isolation is configured. Its lifetime throttle count is not evidence of a web quota or the formal-run failure. |
| Web runtime      | `WORKER_ENABLED=false`, pool 16, cookie cache 60 s, keep-alive 120 s, `NODE_OPTIONS=--max-semi-space-size=32`                            | Requested tuning reached the running containers.                                                               |
| Networking       | PostgreSQL/Redis use internal service DNS; S3 uses `http://rustfs:9000`; HTTPS application domain routes to the web service on port 3000 | No public S3 round trip or wrong application port found.                                                       |
| Builds           | Web/worker use `perf/request-path-load`, correct Dockerfile/context, a different build-server ID from the runtime server                 | Builds are configured away from this VPS; no build overlap was observed.                                       |
| PostgreSQL       | Pool ceiling 60 connections; 768 MiB shared buffers, 8 MiB work_mem, JIT off, parallel workers per gather 0, I/O timing on               | Observed connections peaked at 20; the server connection ceiling was not hit.                                  |
| Other limits     | Redis 256 MiB; PostgreSQL 1.5 GiB; RustFS 1 CPU/768 MiB                                                                                  | No corresponding resource failure observed in this run.                                                        |

**Capacity planning details:** current configured memory ceilings total roughly **4.25 GiB**, before Traefik/OS, on a 3.73 GiB host. These are ceilings rather than current allocations, and RAM did not limit this run. Budget memory explicitly before adding replicas. Also, two web replicas at main pool 16 plus the worker and all auxiliary pool maxima can consume the entire 60-connection PostgreSQL budget before operational headroom.

The k6 cookie jar was verified separately: it receives `__Secure-better-auth.session_data` on the first request, sends it subsequently, and the next reads return without refreshing the cookie. The new read-side cache was exercised. Normal write-side database session checks remained enabled.

## Recommended next steps

1. **Prioritize a controlled CPU/process capacity experiment.** Compare this baseline against two web replicas with more/faster CPU, for example a four-vCPU test environment with an explicit memory budget. Extra cores alone do not parallelize one Node event loop. Keep exactly one worker, share the existing auth/encryption configuration and Redis, and budget _all_ pools against PostgreSQL's connection ceiling. Try smaller per-replica main pools rather than automatically doubling connections. Repeat the same 500-user window before 750/1,000. This is the clearest way to separate the remaining software cost from this VPS's ceiling; passing is not guaranteed.
2. **Make write responses and database projections smaller.** [updateDraft](../../../src/server/content/entries.ts:562) still uses unrestricted `.returning()` and returns the full entry, including other content snapshots. Measure returned bytes and JSON parse/serialization CPU, then test a narrow save acknowledgement and only the fields the editor needs. Preserve version/conflict checks, fresh session authorization, audit/revision writes and ownership validation. The previous repeated-guard and full-list-document issues are already fixed; do not redo those recommendations.
3. **Measure the write cost of whole-document search indexing.** [Migration 0042](../../../drizzle/0042_entry_search_trgm.sql) indexes `draft_data::text` with GIN. Draft changes maintain it on every save; the UPDATE is the largest cumulative SQL execution family. Compare write/search behavior with targeted indexed fields or a maintained search document, using an isolated A/B test. The current capture does not quantify how much of the UPDATE cost comes from that index.
4. **Add operation-level cost breakdowns.** Record request CPU, pool-acquisition wait, SQL duration/count, returned bytes and S3 SDK duration, using bounded operation labels. Focus on saves, create-entry and media uploads. Existing pool/event-loop metrics identify pressure but cannot split time inside those multi-step operations. Keep security checks intact rather than extending read-only session caching to writes.
5. **Keep successful configuration changes; avoid unrelated tuning.** Retain internal storage routing, client reuse, worker separation, Redis negotiation/readiness fixes and keep-alive/request-ID work. There is no evidence that raising Redis memory, increasing timeouts, or adding more database connections alone solves this run. If increasing replicas, reconcile memory ceilings and connection budgets first.

No application or Dokploy performance configuration was modified for this investigation. The hardware/process A/B and index alternatives above remain proposals, not measured fixes.

## Reproduction and final state

- Tested image: `sha256:b607093df1b4264bcb396bccd5fc475476330331991416c5ea54bd16bde525aa`, checked at startup and after baseline reset. Same URL as the previous rerun.
- Same 2,000-user fixture cohort, randomized state machine, seed 12345 and workload SHA-256 `08c019aea1b4afe8cba7a986c4ddabc2e29fe709d83822d057ad742e89474790`. 500 VUs, 60 s ramp, 60 s settling, 600 s measured; signed-in HTTP/SPA activity, not browser rendering or a login/MFA surge.
- Preflight passed 33 checks; wire/state-machine tests passed. Fresh current-schema baseline was saved before the run. The worker remained enabled during load, and its resources were measured separately.
- Formal raw data: ignored `.local/results-2026-11-03T12-48-18.127Z`; separate diagnostic `.local/results-2026-11-03T13-03-10.124Z`; CPU profile `.local/cpu-diagnostic-latest-500`. Sanitized runtime/API/query inventories are also ignored locally; no API key or session cookie is included in these public artifacts.
- After formal failure, pulled **`perf/request-path-load` to `90b7615`** and reviewed that code. Source was not pulled during formal measurement. The tested image ID is the authoritative artifact identity; a Git branch name alone is not an immutable image identity.
- After diagnostics, paused the worker, restored the fresh baseline, and resumed it at one replica. Web health is healthy; all four Swarm services are 1/1. No load traffic remains. Uploaded disposable S3 blobs remain physically retained and were included in disk monitoring.

[Sanitized results](capacity-results.json) · [Charts](capacity-summary.html) · [Previous rerun](../rerun-2026-11-03/report.md) · [Suite](../../README.md)
