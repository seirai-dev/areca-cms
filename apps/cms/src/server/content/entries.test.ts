import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { auditLog, entry, entryRevision } from '#/db/schema'

import {
  createEntry,
  listRevisions,
  publishEntry,
  restoreRevision,
  scheduleEntry,
  updateDraft,
} from './entries.ts'
import { ConflictError, ValidationError } from './errors.ts'
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
        created.draftVersion,
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
        updated.draftVersion,
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
      expect(scheduled.scheduledBy).toBe(ctx.actor.id)
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

  it('allows empty richtext on draft but not on publish', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const slug = `draft-${ctx.suffix}`
      const emptyBody = { type: 'doc', content: [{ type: 'paragraph' }] }

      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'Draft', slug, body: emptyBody },
        actorId: ctx.actor.id,
      })
      expect(created.status).toBe('draft')

      await expect(
        createEntry({
          siteId: ctx.site.id,
          collectionKey: 'articles',
          data: { title: '', slug: `${slug}-empty`, body: sampleRichText },
          actorId: ctx.actor.id,
        }),
      ).rejects.toBeInstanceOf(ValidationError)

      await expect(
        publishEntry(created.id, ctx.actor.id),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })
  it('rejects stale concurrent draft writes without replacing the saved draft', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Original',
          slug: `conflict-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      const first = await updateDraft(
        created.id,
        { ...created.draftData, title: 'First writer' },
        ctx.actor.id,
        created.draftVersion,
      )
      await expect(
        updateDraft(
          created.id,
          { ...created.draftData, title: 'Stale writer' },
          ctx.actor.id,
          created.draftVersion,
        ),
      ).rejects.toBeInstanceOf(ConflictError)
      expect(first.draftVersion).toBe(created.draftVersion + 1)
      const revisions = await listRevisions(created.id)
      expect(revisions.filter((row) => row.note === 'update')).toHaveLength(1)
    })
  })

  it('approves only the draft version the reviewer saw', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Reviewed',
          slug: `reviewed-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      const reviewed = await updateDraft(
        created.id,
        { ...created.draftData, title: 'Reviewed copy' },
        ctx.actor.id,
        created.draftVersion,
      )
      // Another editor saves after the reviewer opened the draft.
      await updateDraft(
        created.id,
        { ...created.draftData, title: 'Newer copy' },
        ctx.actor.id,
        reviewed.draftVersion,
      )

      await expect(
        publishEntry(created.id, ctx.actor.id, reviewed.draftVersion),
      ).rejects.toThrow(/DRAFT_CONFLICT/)
      await expect(
        scheduleEntry(
          created.id,
          new Date(Date.now() + 86_400_000).toISOString(),
          'UTC',
          ctx.actor.id,
          reviewed.draftVersion,
        ),
      ).rejects.toBeInstanceOf(ConflictError)
      const [unchanged] = await db
        .select()
        .from(entry)
        .where(eq(entry.id, created.id))
      expect(unchanged?.status).toBe('draft')
      expect(unchanged?.publishedData).toBeNull()

      const approved = await publishEntry(
        created.id,
        ctx.actor.id,
        reviewed.draftVersion + 1,
      )
      expect(approved.status).toBe('published')
    })
  })

  it('approves the loaded version when no expected version is sent', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Unversioned',
          slug: `unversioned-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      const approved = await publishEntry(created.id, ctx.actor.id)
      expect(approved.status).toBe('published')
    })
  })

  it('drops undeclared legacy keys when restoring a revision', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const slug = `legacy-${ctx.suffix}`
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'Now', slug, body: sampleRichText },
        actorId: ctx.actor.id,
      })
      const [revision] = await db
        .insert(entryRevision)
        .values({
          entryId: created.id,
          data: { title: 'Old', slug, removedField: 'stale' },
          createdBy: ctx.actor.id,
          note: 'legacy',
        })
        .returning()
      const restored = await restoreRevision(
        created.id,
        revision.id,
        ctx.actor.id,
        created.draftVersion,
      )
      expect(restored.draftData).toEqual({
        title: 'Old',
        slug,
        body: sampleRichText,
      })
      expect(restored.skippedFields).toContainEqual(
        expect.objectContaining({ key: 'removedField' }),
      )
      const latest = (await listRevisions(created.id)).find(
        (row) => row.note === 'restore',
      )
      expect(latest?.data).toEqual({ title: 'Old', slug, body: sampleRichText })
    })
  })
})
