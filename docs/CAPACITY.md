# Capacity and reliability targets

Areca CMS is sized for a small agency running a **single CMS replica**. The
numbers below are the supported envelope; the benchmark in
`apps/cms/scripts/benchmark.ts` checks them and should be re-run before raising
them.

## Targets

| Dimension                        | Target                                              |
| -------------------------------- | --------------------------------------------------- |
| Sites                            | up to 50                                            |
| Entries per site                 | up to 2,000                                         |
| Assets per organization          | up to 10,000                                        |
| CMS replicas                     | 1                                                   |
| Release snapshot build (largest) | p95 < 10 s                                          |
| Editor list/search endpoints     | p95 < 500 ms                                        |
| Upload size                      | 20 MiB per file (enforced in the route and service) |

Normal content pages consume a published snapshot at build time. CMS traffic
also includes SDK pulls, draft previews, operations checks, and public asset
requests; these should be included when sizing the CMS and storage.

## Benchmark methodology

`apps/cms/scripts/benchmark.ts` seeds a synthetic dataset directly through
Drizzle and measures the code the app runs (not HTTP):

- **Dataset (scale 1):** 5 organizations x 10 sites = 50 sites, two collections
  each (authors, articles). The largest site has 2,000 entries (rich-text body
  with two embedded images, two image fields, author and related references,
  select/boolean/datetime fields, ~10% drafts) and 5 revisions per entry; the
  other sites have 100 entries and 2 revisions. The largest organization has
  10,000 assets, the others 500. Each site gets 3 publications (the largest
  site 10) holding real snapshots built from the seeded content.
- **Scenarios:** `buildSnapshot` for the largest site (the function the
  publishing worker calls), `listEntries` (first page, deep page, status
  filter, search), `listAssets` (first page, deep page, search),
  `buildPreviewEntry`, and `assetUsage` (the check behind deleting an asset).
- **Statistics:** one warm-up run, then N measured runs (default 7); p50, p95
  and max wall-clock times, plus process peak RSS and heap growth during the
  scenario. Peak RSS includes the seeding phase when seeding and measuring in
  the same process, so for memory numbers seed with `--keep` and measure in a
  second process with `--skip-seed`.

### Running it safely

The benchmark writes and deletes data, so it refuses to run unless **both**:

1. `ARECA_BENCHMARK=1` is set, and
2. the database name contains `bench` or `test`.

It never reads `.env.local`; the database must be passed explicitly with
`--database-url` (or `DATABASE_URL`). Everything it creates lives in
organizations whose slug starts with `bench-` and is removed before seeding and
after the run (unless `--keep`). It does not use S3, Redis or SMTP.

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

Flags: `--scale <n>` (0.1 for a quick smoke run), `--runs <n>`, `--json <file>`,
`--keep`, `--skip-seed`. Output is a markdown table on stdout.

## Measured results

Machine: Apple M4 (10 cores, 16 GB), macOS, Node 24.21, PostgreSQL 17.11 in a
local Docker container (so database latency is ~0; add network round trips for
a remote database). Scale 1, 10 runs. Dataset: 6,900 entries, 19,800 revisions,
12,000 assets, 157 publications. Table sizes (including TOAST and indexes):
entry 20 MB, entry_revision 31 MB, publication 66 MB, asset 4 MB. The largest
site's snapshot is about 22 MB of JSON.

| Scenario                             | Before p50 / p95 (ms) | After p50 / p95 (ms) |
| ------------------------------------ | --------------------: | -------------------: |
| snapshot build (largest site)        |         5,949 / 7,984 |            499 / 504 |
| entry list, page 1 (50)              |                 5 / 5 |               5 / 11 |
| entry list, deep page (offset 1,500) |                 5 / 6 |                4 / 5 |
| entry list, status filter            |                 3 / 3 |                2 / 2 |
| entry search (slug and body text)    |             158 / 168 |            145 / 149 |
| asset list, page 1 (50)              |                 2 / 2 |                2 / 2 |
| asset list, deep page                |                 5 / 5 |                5 / 5 |
| asset search                         |                 7 / 7 |                7 / 7 |
| preview entry build                  |                 5 / 6 |                4 / 6 |
| asset usage check (referenced asset) |         4,068 / 4,156 |        4,127 / 4,413 |

Snapshot build heap growth is about 175-205 MB and process peak RSS about
700-830 MB for the largest site. Asset usage check heap growth dropped from
about 132 MB to 14-65 MB (it depends on how many publications mention the
asset), with no change in wall time.

What changed:

- **Snapshot build** resolved every image field and every embedded rich-text
  image with its own query (about 10,000 round trips for the largest site).
  It now loads the referenced assets in a few batched `inArray` queries
  (`loadAssetLookup`) and resolves from memory. Behaviour is identical:
  organization scoping, error messages and output are unchanged. With a remote
  database the saving is larger than measured here.
- **Asset usage check** used to download every entry, revision, publication and
  archive row of the organization and walk them in JavaScript. It now filters
  rows in SQL (a conservative superset of the exact check) and walks only the
  candidates, and the in-memory walk skips URL parsing for strings that cannot
  match. Wall time is bound by Postgres converting the large publication
  snapshots to text (about 2 s of the 4 s).

All other scenarios are far inside the targets.

## Known limits

- **Revision history is unbounded.** `entry_revision` grows with every save and
  there is no pruning. At 5 revisions per entry it is the second largest table;
  every asset usage check and org-level scan touches it.
- **Publications keep full snapshots.** Each publication stores the complete
  site snapshot (about 22 MB of JSON for 2,000 entries, ~6 MB compressed in
  TOAST). Retention of old publications multiplies that size by the number of
  retained releases. Asset deletion checks scan all of them.
- **A snapshot is built in memory** as one object (about 200 MB heap for 2,000
  entries with rich text), then serialized and hashed. Memory scales linearly
  with entries x rich-text size. Keep Node's heap comfortably above 1 GB.
- **Search is textual.** Entry search runs `ILIKE` over `draft_data::text`, so
  it is a sequential scan of the site's entries (about 150 ms at 2,000 entries)
  and cost grows linearly. There is no full-text index.
- **Asset usage is a scan.** There is no reference table, so each delete or
  usage lookup costs O(all content in the organization), serialized by an
  organization-wide advisory lock.
- **Uploads are buffered.** The multipart body and the original file are held
  in memory (the file is then also passed to `sharp` and the S3 client). The
  per-file limit is 20 MiB, so a handful of concurrent uploads can use
  hundreds of MB. Assets are served by streaming through the CMS from the
  buffered object body, not redirected to S3.
- **Single replica only.** Serialization of publishing per site relies on
  database uniqueness (one queued and one active build job per site) and job
  leases, which work across processes, but the in-process worker and scheduler
  ticks, rate limiting and other in-memory state were designed for one
  replica. Do not scale the CMS horizontally without reviewing them.
- **Build logs are capped** per build job: each line is redacted and cut at
  8 KiB, and `build_job.logs` is limited to 256 Ki characters (not bytes; the
  newest content is kept behind a single `[truncated]` marker). Very chatty
  deployments cannot grow it without bound. See `docs/OPERATIONS.md`.

## Scaling beyond the target

Re-run the benchmark with `--scale` matching the new volume before changing the
numbers above. Typical triggers and responses:

- Snapshot p95 approaching 10 s, or snapshot memory pressure: reduce retained
  publications, increase the Node heap, then consider streaming the snapshot to
  storage instead of one in-memory object.
- Entry search p95 approaching 500 ms: add a generated `tsvector` (or trigram
  GIN) index over searchable draft text and query it instead of `ILIKE`.
- Asset usage check taking several seconds, or asset libraries beyond about
  10,000: maintain an `asset_reference` table (asset id, owner type, owner id)
  updated when entries, revisions and publications are written, and replace the
  scan.
- Revision table size: cap or prune revisions per entry (for example keep the
  newest 50 plus labeled ones) and archive the rest.
- Upload concurrency or larger files: stream uploads to storage with presigned
  or multipart uploads instead of buffering in the process.
- More than one replica: first move the scheduler/worker ticks to a leased
  single runner or a dedicated worker process, and back rate limiting and
  caches with shared stores.
- Remote database: measure with the real network latency. Anything that issues
  per-row queries will show up immediately; the snapshot path no longer does.
