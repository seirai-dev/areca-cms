import { and, eq, sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import { auditLog, entry, entryRevision } from '#/db/schema'
import type { Field } from '#/lib/types'

import { archiveEntry, createEntry } from './entries'
import { createTestCollection, withTestSite } from './test-utils'

const hasDb = Boolean(process.env.DATABASE_URL)
const TRIGGER = 'test_fail_archive_revision'

const basic: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
]

describe.skipIf(!hasDb)('archiveEntry', () => {
  afterEach(async () => {
    await db.execute(
      sql.raw(`DROP TRIGGER IF EXISTS ${TRIGGER} ON entry_revision`),
    )
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${TRIGGER}()`))
  })

  it('writes the status, revision and audit row together', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, { fields: basic })
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'A', slug: 'a' },
        actorId: ctx.actor.id,
      })

      const archived = await archiveEntry(created.id, ctx.actor.id)

      expect(archived.status).toBe('archived')
      const revisions = await db
        .select({ note: entryRevision.note })
        .from(entryRevision)
        .where(eq(entryRevision.entryId, created.id))
      expect(revisions.map((row) => row.note)).toContain('archive')
      const audits = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.targetId, created.id),
            eq(auditLog.action, 'entry.archive'),
          ),
        )
      expect(audits).toHaveLength(1)
    })
  })

  it('leaves the entry as it was when the revision write fails', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, { fields: basic })
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'A', slug: 'a' },
        actorId: ctx.actor.id,
      })
      // Fails only this entry's revisions, so other tests are not affected.
      await db.execute(
        sql.raw(`
          CREATE OR REPLACE FUNCTION ${TRIGGER}() RETURNS trigger AS $$
          BEGIN
            IF NEW.entry_id = '${created.id}' AND NEW.note = 'archive' THEN
              RAISE EXCEPTION 'test: revision write failed';
            END IF;
            RETURN NEW;
          END
          $$ LANGUAGE plpgsql
        `),
      )
      await db.execute(
        sql.raw(
          `CREATE TRIGGER ${TRIGGER} BEFORE INSERT ON entry_revision FOR EACH ROW EXECUTE FUNCTION ${TRIGGER}()`,
        ),
      )

      await expect(archiveEntry(created.id, ctx.actor.id)).rejects.toThrow()

      const [row] = await db
        .select({ status: entry.status, contentVersion: entry.contentVersion })
        .from(entry)
        .where(eq(entry.id, created.id))
      expect(row).toEqual({
        status: created.status,
        contentVersion: created.contentVersion,
      })
      const audits = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.targetId, created.id),
            eq(auditLog.action, 'entry.archive'),
          ),
        )
      expect(audits).toHaveLength(0)
    })
  })
})
