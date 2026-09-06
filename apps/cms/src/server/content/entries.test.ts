import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { auditLog, entryRevision } from '#/db/schema'

import {
  createEntry,
  listRevisions,
  publishEntry,
  restoreRevision,
  scheduleEntry,
  updateDraft,
} from './entries.ts'
import { ValidationError } from './errors.ts'
import {
  createTestCollection,
  sampleRichText,
  withTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('entries', () => {
  it('creates, updates, publishes, records revisions, and schedules', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const slug = `hello-${ctx.suffix}`

      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Hello',
          slug,
          excerpt: '',
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })

      expect(created.status).toBe('draft')
      expect(created.slug).toBe(slug)
      expect(created.draftData.title).toBe('Hello')

      const updated = await updateDraft(
        created.id,
        {
          title: 'Hello world',
          slug,
          excerpt: 'An excerpt',
          body: sampleRichText,
          category: 'news',
        },
        ctx.actor.id,
      )
      expect(updated.draftData.title).toBe('Hello world')

      const published = await publishEntry(created.id, ctx.actor.id)
      expect(published.status).toBe('published')
      expect(published.publishedData).toEqual(updated.draftData)
      expect(published.publishedAt).toBeInstanceOf(Date)

      const revisions = await listRevisions(created.id)
      expect(revisions.map((rev) => rev.note)).toEqual(
        expect.arrayContaining(['create', 'update', 'publish']),
      )

      const createRevision = revisions.find((rev) => rev.note === 'create')
      expect(createRevision).toBeDefined()
      const restored = await restoreRevision(
        created.id,
        createRevision!.id,
        ctx.actor.id,
      )
      expect(restored.draftData.title).toBe('Hello')
      expect(restored.status).toBe('published')

      const scheduledAt = '2026-12-01T09:00:00+02:00'
      const scheduled = await scheduleEntry(
        created.id,
        scheduledAt,
        'Europe/Berlin',
        ctx.actor.id,
      )
      expect(scheduled.status).toBe('scheduled')
      expect(scheduled.scheduleTimezone).toBe('Europe/Berlin')
      expect(scheduled.scheduledAt?.toISOString()).toBe(
        new Date(scheduledAt).toISOString(),
      )

      const logs = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.siteId, ctx.site.id),
            eq(auditLog.targetType, 'entry'),
          ),
        )
      expect(logs.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          'entry.create',
          'entry.update',
          'entry.publish',
          'entry.restore',
          'entry.schedule',
        ]),
      )

      const revisionCount = await db
        .select()
        .from(entryRevision)
        .where(eq(entryRevision.entryId, created.id))
      expect(revisionCount.length).toBeGreaterThanOrEqual(5)
    })
  })

  it('allows empty required fields on draft update but not on publish', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const slug = `draft-${ctx.suffix}`

      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: '', slug, body: sampleRichText },
        actorId: ctx.actor.id,
      })
      expect(created.status).toBe('draft')

      const updated = await updateDraft(
        created.id,
        { title: '', slug, body: sampleRichText },
        ctx.actor.id,
      )
      expect(updated.draftData.title).toBe('')

      await expect(
        publishEntry(created.id, ctx.actor.id),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })
})
