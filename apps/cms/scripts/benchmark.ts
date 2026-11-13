/**
 * Capacity benchmark for the "small agency" target (see https://docs.arecacms.com/docs/self-hosting/capacity).
 *
 * It SEEDS a synthetic dataset directly via Drizzle and measures the hot paths:
 * release snapshot build, editor entry list/search, asset library listing,
 * preview entry build and the asset usage check.
 *
 *   pnpm run paraglide:scripts   # once
 *   ARECA_BENCHMARK=1 pnpm bench --database-url postgres://u:p@localhost:55444/areca_bench
 *
 * Safety: the script refuses to run unless ARECA_BENCHMARK=1 is set AND the
 * database name contains "bench" or "test". It never reads `.env.local`: the
 * database must be given with --database-url or DATABASE_URL. Everything it
 * creates lives in organizations whose slug starts with `bench-`; those are
 * deleted before seeding and (unless --keep) after the run.
 *
 * Flags:
 *   --database-url <url>   target database (or DATABASE_URL)
 *   --scale <n>            multiply the dataset (default 1 = full target scale)
 *   --runs <n>             measured runs per scenario (default 7, plus 1 warm-up)
 *   --json <file>          also write the results as JSON
 *   --keep                 keep the seeded data afterwards
 *   --skip-seed            reuse data left by a previous --keep run
 */
import { createHash, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import os from 'node:os'

// Must stay the first project import (safety gate, see the module).
import { args, benchDbName as dbName } from './lib/benchmark-guard.ts'

import { desc, eq, like, sql } from 'drizzle-orm'
import type { Field } from '#/lib/types'

// Dynamic imports: they must resolve after the guard has pinned the env and
// installed the paraglide hook.
const { db, pool } = await import('#/db')
const schema = await import('#/db/schema')
const { listEntries } = await import('#/server/content/entries.ts')
const { buildSnapshot } = await import('#/server/content/snapshot.ts')
const { buildPreviewEntry } =
  await import('#/server/content/snapshot-preview.ts')
const { listAssets, assetUsage } = await import('#/server/assets')

const scale = Number(args.scale)
const runs = Number(args.runs)
const n = (base: number) => Math.max(1, Math.round(base * scale))

// ------------------------------------------------------------- dataset shape
const ORGS = 5
const SITES_PER_ORG = 10 // 50 sites total
const LARGE_SITE_ENTRIES = n(2000)
const SMALL_SITE_ENTRIES = n(100)
const LARGE_ORG_ASSETS = n(10000)
const SMALL_ORG_ASSETS = n(500)
const REVISIONS_PER_ENTRY_LARGE = 5
const REVISIONS_PER_ENTRY_SMALL = 2
const PUBLICATIONS_LARGE_SITE = 10
const PUBLICATIONS_SMALL_SITE = 3
const CHUNK = 500

const articleFields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
  { key: 'heroImage', label: 'Hero image', type: 'image' },
  { key: 'thumbnail', label: 'Thumbnail', type: 'image' },
  { key: 'author', label: 'Author', type: 'reference', collection: 'authors' },
  {
    key: 'related',
    label: 'Related',
    type: 'reference',
    collection: 'articles',
  },
  { key: 'publishedAt', label: 'Published at', type: 'datetime' },
  {
    key: 'category',
    label: 'Category',
    type: 'select',
    options: ['news', 'updates', 'guides'],
  },
  { key: 'featured', label: 'Featured', type: 'boolean' },
]
const authorFields: Field[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'bio', label: 'Bio', type: 'richtext' },
  { key: 'avatar', label: 'Avatar', type: 'image' },
]

const WORDS =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim minim veniam quis nostrud exercitation ullamco laboris nisi aliquip commodo consequat'.split(
    ' ',
  )
const sentence = (i: number, len = 14) =>
  Array.from(
    { length: len },
    (_, k) => WORDS[(i * 7 + k * 3) % WORDS.length],
  ).join(' ')

function richText(i: number, imageKeys: string[]) {
  const content: unknown[] = [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: sentence(i, 5) }],
    },
  ]
  for (let p = 0; p < 8; p++) {
    content.push({
      type: 'paragraph',
      content: [
        { type: 'text', text: sentence(i + p, 30) },
        {
          type: 'text',
          marks: [{ type: 'bold' }],
          text: ` ${sentence(i + p + 1, 4)}`,
        },
      ],
    })
  }
  for (const key of imageKeys) {
    content.push({
      type: 'image',
      attrs: {
        src: `/api/assets/file/${key}`,
        alt: sentence(i, 3),
        width: 1600,
        height: 900,
      },
    })
  }
  return { type: 'doc', content }
}

function chunks<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

type Seeded = {
  largeOrgId: string
  largeSiteId: string
  largeSiteSlug: string
  assetId: string
  articleSlugs: string[]
  counts: Record<string, number>
}

async function cleanup() {
  await db
    .delete(schema.organization)
    .where(like(schema.organization.slug, 'bench-%'))
}

async function seed(): Promise<Seeded> {
  await cleanup()
  // Reclaim space from earlier runs so table sizes and scans are comparable.
  for (const table of ['entry', 'entry_revision', 'publication', 'asset'])
    await db.execute(sql.raw(`vacuum full ${table}`))
  const counts: Record<string, number> = {
    organizations: 0,
    sites: 0,
    collections: 0,
    entries: 0,
    revisions: 0,
    assets: 0,
    publications: 0,
  }
  let largeOrgId = ''
  let largeSiteId = ''
  let largeSiteSlug = ''
  let assetId = ''
  let articleSlugs: string[] = []
  const tokenHash = () =>
    createHash('sha256').update(randomUUID()).digest('hex')

  for (let o = 0; o < ORGS; o++) {
    const isLargeOrg = o === 0
    const [org] = await db
      .insert(schema.organization)
      .values({ name: `Bench Org ${o}`, slug: `bench-org-${o}` })
      .returning()
    counts.organizations++

    // Assets for the organization.
    const assetCount = isLargeOrg ? LARGE_ORG_ASSETS : SMALL_ORG_ASSETS
    const assetRows = Array.from({ length: assetCount }, (_, i) => ({
      id: randomUUID(),
      organizationId: org.id,
      storageKey: `${org.id}/${randomUUID()}.jpg`,
      originalFilename: `photo-${i}-${WORDS[i % WORDS.length]}.jpg`,
      mimeType: 'image/jpeg',
      size: 200_000 + (i % 1000) * 1000,
      width: 1600,
      height: 900,
      altText: sentence(i, 6),
      createdAt: new Date(Date.now() - i * 60_000),
    }))
    for (const part of chunks(assetRows))
      await db.insert(schema.asset).values(part)
    counts.assets += assetRows.length
    if (isLargeOrg) assetId = assetRows[Math.floor(assetRows.length / 2)].id

    for (let s = 0; s < SITES_PER_ORG; s++) {
      const isLargeSite = isLargeOrg && s === 0
      const entryTotal = isLargeSite ? LARGE_SITE_ENTRIES : SMALL_SITE_ENTRIES
      const [st] = await db
        .insert(schema.site)
        .values({
          organizationId: org.id,
          name: `Bench Site ${o}-${s}`,
          slug: `bench-site-${o}-${s}`,
          tokenHash: tokenHash(),
          schemaTokenHash: tokenHash(),
          productionUrl: 'http://localhost:3999',
          previewSecret: randomUUID(),
        })
        .returning()
      counts.sites++
      const [authorsCol, articlesCol] = await db
        .insert(schema.collection)
        .values([
          {
            siteId: st.id,
            key: 'authors',
            label: 'Authors',
            routePattern: '/authors/$slug',
            fields: authorFields,
          },
          {
            siteId: st.id,
            key: 'articles',
            label: 'Articles',
            routePattern: '/blog/$slug',
            fields: articleFields,
          },
        ])
        .returning()
      counts.collections += 2

      const authorCount = Math.max(5, Math.round(entryTotal / 40))
      const articleCount = entryTotal - authorCount
      const candidates = assetRows
      const pick = (i: number) => candidates[(i * 31) % candidates.length]
      const now = Date.now()

      type EntryInsert = typeof schema.entry.$inferInsert
      const authors: EntryInsert[] = []
      for (let i = 0; i < authorCount; i++) {
        const data = {
          name: `Author ${i}`,
          slug: `author-${i}`,
          bio: richText(i, []),
          avatar: pick(i).id,
        }
        authors.push({
          id: randomUUID(),
          siteId: st.id,
          collectionId: authorsCol.id,
          slug: data.slug,
          status: 'published',
          draftData: data,
          publishedData: data,
          publishedSlug: data.slug,
          publishedAt: new Date(now - i * 3600_000),
        })
      }
      const articles: EntryInsert[] = []
      const slugs: string[] = []
      for (let i = 0; i < articleCount; i++) {
        const slug = `article-${i}`
        slugs.push(slug)
        const data = {
          title: `Article ${i}: ${sentence(i, 6)}`,
          slug,
          excerpt: sentence(i, 25),
          body: richText(i, [
            pick(i * 2).storageKey,
            pick(i * 2 + 1).storageKey,
          ]),
          heroImage: pick(i * 3).id,
          thumbnail: pick(i * 3 + 1).id,
          author: authors[i % authorCount].id,
          related: i > 0 ? undefined : null,
          publishedAt: new Date(now - i * 3600_000).toISOString(),
          category: ['news', 'updates', 'guides'][i % 3],
          featured: i % 10 === 0,
        }
        const isDraft = i % 10 === 9
        articles.push({
          id: randomUUID(),
          siteId: st.id,
          collectionId: articlesCol.id,
          slug,
          status: isDraft ? 'draft' : 'published',
          draftData: data,
          publishedData: isDraft ? null : data,
          publishedSlug: isDraft ? null : slug,
          publishedAt: isDraft ? null : new Date(now - i * 3600_000),
          updatedAt: new Date(now - i * 60_000),
        })
      }
      // Cross-references between published articles (id of the previous one).
      for (let i = 1; i < articles.length; i++) {
        const prev = articles[i - 1]
        if (prev.status !== 'published') continue
        for (const col of ['draftData', 'publishedData'] as const) {
          const d = articles[i][col] as Record<string, unknown> | null
          if (d) d.related = prev.id
        }
      }
      const all = [...authors, ...articles]
      for (const part of chunks(all)) await db.insert(schema.entry).values(part)
      counts.entries += all.length

      const revisionsEach = isLargeSite
        ? REVISIONS_PER_ENTRY_LARGE
        : REVISIONS_PER_ENTRY_SMALL
      const revisions = all.flatMap((e) =>
        Array.from({ length: revisionsEach }, (_, r) => ({
          entryId: e.id!,
          data: e.draftData as Record<string, unknown>,
          note: r === 0 ? 'Initial draft' : null,
          createdAt: new Date(now - r * 86_400_000),
        })),
      )
      for (const part of chunks(revisions))
        await db.insert(schema.entryRevision).values(part as never)
      counts.revisions += revisions.length

      if (isLargeSite) {
        largeOrgId = org.id
        largeSiteId = st.id
        largeSiteSlug = st.slug
        articleSlugs = slugs
      }
    }
  }

  // Publications: store real snapshots (built from the seeded data) so rows
  // have realistic size. Large site: its own snapshot x N; small sites: theirs.
  const sites = await db
    .select()
    .from(schema.site)
    .where(like(schema.site.slug, 'bench-site-%'))
  for (const st of sites) {
    const built = await buildSnapshot(st.id)
    if (!built.ok)
      throw new Error(
        `Seed snapshot failed for ${st.slug}: ${built.errors.slice(0, 3).join('; ')}`,
      )
    const count =
      st.id === largeSiteId ? PUBLICATIONS_LARGE_SITE : PUBLICATIONS_SMALL_SITE
    const rows = Array.from({ length: count }, (_, i) => ({
      siteId: st.id,
      snapshot: { ...built.snapshot, publicationId: `bench-${i}` },
      snapshotHash: built.hash,
      status: i === 0 ? ('live' as const) : ('superseded' as const),
      createdAt: new Date(Date.now() - i * 86_400_000),
    }))
    for (const part of chunks(rows, 5))
      await db.insert(schema.publication).values(part)
    counts.publications += rows.length
  }

  await db.execute(sql`vacuum analyze`)
  return {
    largeOrgId,
    largeSiteId,
    largeSiteSlug,
    assetId,
    articleSlugs,
    counts,
  }
}

// -------------------------------------------------------------- measurement
type Result = {
  scenario: string
  runs: number
  p50: number
  p95: number
  max: number
  peakRssMb: number
  heapDeltaMb: number
  note?: string
}

function percentile(sorted: number[], p: number) {
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  )
  return sorted[Math.max(0, idx)]
}

async function measure(
  scenario: string,
  fn: (run: number) => Promise<unknown>,
  note?: string,
): Promise<Result> {
  await fn(-1) // warm-up (plans, JIT, connection)
  global.gc?.()
  const heapBefore = process.memoryUsage().heapUsed
  let peakRss = process.memoryUsage().rss
  let peakHeap = heapBefore
  const sampler = setInterval(() => {
    const m = process.memoryUsage()
    peakRss = Math.max(peakRss, m.rss)
    peakHeap = Math.max(peakHeap, m.heapUsed)
  }, 20)
  const times: number[] = []
  try {
    for (let i = 0; i < runs; i++) {
      const start = performance.now()
      await fn(i)
      times.push(performance.now() - start)
    }
  } finally {
    clearInterval(sampler)
  }
  times.sort((a, b) => a - b)
  const mb = (b: number) => Math.round((b / 1024 / 1024) * 10) / 10
  const result: Result = {
    scenario,
    runs,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    max: times[times.length - 1],
    peakRssMb: mb(peakRss),
    heapDeltaMb: mb(peakHeap - heapBefore),
    note,
  }
  console.error(
    `  ${scenario}: p50 ${result.p50.toFixed(0)} ms, p95 ${result.p95.toFixed(0)} ms`,
  )
  return result
}

async function main() {
  console.error(`Database: ${dbName}  scale=${scale}  runs=${runs}`)
  let seeded: Seeded
  if (args['skip-seed']) {
    const st = (
      await db
        .select()
        .from(schema.site)
        .where(eq(schema.site.slug, 'bench-site-0-0'))
    ).at(0)
    if (!st) throw new Error('No seeded data found; run without --skip-seed.')
    const [a] = await db
      .select()
      .from(schema.asset)
      .where(eq(schema.asset.organizationId, st.organizationId))
      .orderBy(desc(schema.asset.createdAt))
      .limit(1)
      .offset(Math.floor(LARGE_ORG_ASSETS / 2))
    const arts = await db
      .select({ slug: schema.entry.slug })
      .from(schema.entry)
      .where(eq(schema.entry.siteId, st.id))
      .limit(200)
    seeded = {
      largeOrgId: st.organizationId,
      largeSiteId: st.id,
      largeSiteSlug: st.slug,
      assetId: a.id,
      articleSlugs: arts.map((x) => x.slug),
      counts: {},
    }
  } else {
    console.error('Seeding...')
    const t0 = performance.now()
    seeded = await seed()
    console.error(`Seeded in ${((performance.now() - t0) / 1000).toFixed(1)} s`)
  }

  const sizes = await db.execute<{ table_name: string; bytes: string }>(sql`
    select c.relname as table_name, pg_total_relation_size(c.oid)::text as bytes
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('entry','entry_revision','publication','asset')
    order by 1`)

  console.error('Measuring...')
  const results: Result[] = []
  const slugs = seeded.articleSlugs
  const orgId = seeded.largeOrgId
  const siteId = seeded.largeSiteId

  results.push(
    await measure('snapshot build (largest site)', async () => {
      const out = await buildSnapshot(siteId)
      if (!out.ok) throw new Error(out.errors.slice(0, 3).join('; '))
    }),
  )
  results.push(
    await measure('entry list, page 1 (50)', () =>
      listEntries(siteId, 'articles', { limit: 50 }),
    ),
  )
  results.push(
    await measure('entry list, deep page (offset 1500)', () =>
      listEntries(siteId, 'articles', {
        limit: 50,
        offset: Math.min(1500, slugs.length - 50),
      }),
    ),
  )
  results.push(
    await measure('entry list, status filter', () =>
      listEntries(siteId, 'articles', { status: 'draft', limit: 50 }),
    ),
  )
  results.push(
    await measure(
      'entry search (slug/body text)',
      (i) =>
        listEntries(siteId, 'articles', {
          search: i % 2 ? 'article-12' : 'veniam quis',
          limit: 50,
        }),
      'ILIKE over draft_data::text',
    ),
  )
  results.push(
    await measure('asset list, page 1 (50)', () =>
      listAssets(orgId, { limit: 50, offset: 0 }),
    ),
  )
  results.push(
    await measure('asset list, deep page', () =>
      listAssets(orgId, {
        limit: 50,
        offset: Math.max(0, LARGE_ORG_ASSETS - 100),
      }),
    ),
  )
  results.push(
    await measure('asset search', (i) =>
      listAssets(orgId, {
        search: i % 2 ? 'photo-12' : 'dolor',
        limit: 50,
        offset: 0,
      }),
    ),
  )
  results.push(
    await measure('preview entry build', (i) =>
      buildPreviewEntry(
        siteId,
        'articles',
        slugs[((i + 1) * 37) % slugs.length],
      ),
    ),
  )
  results.push(
    await measure(
      'asset usage check',
      () => assetUsage(seeded.assetId, orgId),
      'scans entries, revisions, publications, archives of the org',
    ),
  )

  const machine = {
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    memGb: Math.round(os.totalmem() / 1024 ** 3),
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
  }
  const pgv = (
    await db.execute<{ v: string }>(sql`select version() as v`)
  ).rows.at(0)
  const dataset = {
    scale,
    ...seeded.counts,
    largeSiteEntries: LARGE_SITE_ENTRIES,
    largeOrgAssets: LARGE_ORG_ASSETS,
  }
  const tableSizes = Object.fromEntries(
    sizes.rows.map((r) => [
      r.table_name,
      Math.round(Number(r.bytes) / 1024 / 1024),
    ]),
  )

  const lines = [
    '| Scenario | runs | p50 ms | p95 ms | max ms | peak RSS MB | heap growth MB |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...results.map(
      (r) =>
        `| ${r.scenario} | ${r.runs} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.max.toFixed(0)} | ${r.peakRssMb} | ${r.heapDeltaMb} |`,
    ),
  ]
  console.log(lines.join('\n'))
  console.log(
    `\nMachine: ${machine.cpu} (${machine.cores} cores, ${machine.memGb} GB), ${machine.platform}, node ${machine.node}`,
  )
  console.log(`Postgres: ${pgv?.v}`)
  console.log(`Dataset: ${JSON.stringify(dataset)}`)
  console.log(
    `Table sizes (MB, incl. indexes/TOAST): ${JSON.stringify(tableSizes)}`,
  )

  if (args.json) {
    writeFileSync(
      args.json,
      JSON.stringify(
        { machine, postgres: pgv?.v, dataset, tableSizes, results },
        null,
        2,
      ),
    )
  }
  if (!args.keep) {
    console.error('Cleaning up seeded data...')
    await cleanup()
  }
}

try {
  await main()
} finally {
  await pool.end()
}
