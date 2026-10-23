import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { buildJob, publication } from '#/db/schema'
import { withTestSite } from '#/server/content/test-utils'

const hasDb = Boolean(process.env.DATABASE_URL)

const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle/0012_was_live_correction.sql'),
  'utf8',
)

type Seed = {
  name: string
  status: (typeof publication.$inferInsert)['status']
  deployedAt?: Date | null
  mode?: 'production' | 'demo'
  job?: (typeof buildJob.$inferInsert)['status']
  /** Whether the correction should leave was_live true. */
  keeps: boolean
}

const seeds: Seed[] = [
  // The 0001 backfill's false positive: coalesced, never built or deployed.
  { name: 'superseded-never-built', status: 'superseded', keeps: false },
  {
    name: 'superseded-cancelled-job',
    status: 'superseded',
    job: 'cancelled',
    keeps: false,
  },
  { name: 'failed-no-evidence', status: 'failed', job: 'failed', keeps: false },
  // Evidence of a deployment, one signal at a time.
  {
    name: 'superseded-deployed',
    status: 'superseded',
    deployedAt: new Date(),
    keeps: true,
  },
  {
    name: 'superseded-succeeded-job',
    status: 'superseded',
    job: 'succeeded',
    keeps: true,
  },
  { name: 'rolled-back', status: 'rolled_back', keeps: true },
  // Never touched: the current release and demo-mode rows.
  { name: 'live', status: 'live', keeps: true },
  { name: 'demo-status', status: 'demo', mode: 'demo', keeps: true },
  { name: 'demo-superseded', status: 'superseded', mode: 'demo', keeps: true },
]

describe.skipIf(!hasDb)('0012 was_live correction', () => {
  it('clears was_live only where nothing shows a deployment', async () => {
    await withTestSite(async (ctx) => {
      const ids = new Map<string, string>()
      for (const seed of seeds) {
        const pub = (
          await db
            .insert(publication)
            .values({
              siteId: ctx.site.id,
              snapshot: { schemaVersion: 1 } as never,
              snapshotHash: seed.name,
              status: seed.status,
              publishingMode: seed.mode ?? 'production',
              wasLive: true,
              deployedAt: seed.deployedAt ?? null,
            })
            .returning()
        ).at(0)
        if (!pub) throw new Error('seed publication')
        ids.set(seed.name, pub.id)
        if (seed.job) {
          await db.insert(buildJob).values({
            siteId: ctx.site.id,
            publicationId: pub.id,
            status: seed.job,
          })
        }
      }
      // A row that was never marked stays untouched too.
      const [clean] = await db
        .insert(publication)
        .values({
          siteId: ctx.site.id,
          snapshot: { schemaVersion: 1 } as never,
          snapshotHash: 'already-false',
          status: 'superseded',
        })
        .returning()

      for (const statement of MIGRATION.split('--> statement-breakpoint')) {
        if (statement.trim()) await db.execute(sql.raw(statement))
      }
      // Idempotent: a second run changes nothing.
      for (const statement of MIGRATION.split('--> statement-breakpoint')) {
        if (statement.trim()) await db.execute(sql.raw(statement))
      }

      for (const seed of seeds) {
        const row = (
          await db
            .select({ wasLive: publication.wasLive })
            .from(publication)
            .where(eq(publication.id, ids.get(seed.name)!))
        ).at(0)
        expect(row?.wasLive, seed.name).toBe(seed.keeps)
      }
      const after = (
        await db
          .select({ wasLive: publication.wasLive })
          .from(publication)
          .where(eq(publication.id, clean.id))
      ).at(0)
      expect(after?.wasLive).toBe(false)
    })
  })
})
