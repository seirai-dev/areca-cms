import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { auditLog, entry, entryRevision } from '#/db/schema'
import { makeUser, removeUsers } from '#/server/notifications/test-utils'

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

      const { items: revisions } = await listRevisions(created.id)
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
      const { items: revisions } = await listRevisions(created.id)
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
      expect(unchanged.status).toBe('draft')
      expect(unchanged.publishedData).toBeNull()

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
      const { items } = await listRevisions(created.id)
      const latest = items.find((row) => row.note === 'restore')
      const [stored] = await db
        .select()
        .from(entryRevision)
        .where(eq(entryRevision.id, latest?.id ?? ''))
      expect(stored.data).toEqual({ title: 'Old', slug, body: sampleRichText })
    })
  })
})

describe.skipIf(!hasDb)('revision history', () => {
  it("coalesces one person's autosaves into their latest autosave revision", async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Start',
          slug: `coalesce-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      const first = await updateDraft(
        created.id,
        { ...created.draftData, title: 'One' },
        ctx.actor.id,
        created.draftVersion,
      )
      const second = await updateDraft(
        created.id,
        { ...first.draftData, title: 'Two' },
        ctx.actor.id,
        first.draftVersion,
      )

      const { items } = await listRevisions(created.id)
      expect(items.map((rev) => rev.note)).toEqual(['update', 'create'])
      expect(items[0]).toMatchObject({ kind: 'autosave' })
      const [latest] = await db
        .select()
        .from(entryRevision)
        .where(eq(entryRevision.id, items[0]?.id ?? ''))
      expect(latest.data).toMatchObject({ title: 'Two' })
      expect(second.draftVersion).toBe(created.draftVersion + 2)
    })
  })

  it("never merges milestones, another person's edits, or autosaves past the window", async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const other = await makeUser({ name: 'Second Editor' })
      try {
        const created = await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'articles',
          data: {
            title: 'Milestones',
            slug: `milestones-${ctx.suffix}`,
            body: sampleRichText,
          },
          actorId: ctx.actor.id,
        })
        const autosave = await updateDraft(
          created.id,
          { ...created.draftData, title: 'Mine' },
          ctx.actor.id,
          created.draftVersion,
        )
        const published = await publishEntry(created.id, ctx.actor.id)
        const afterPublish = await updateDraft(
          created.id,
          { ...published.draftData, title: 'After publish' },
          ctx.actor.id,
          published.draftVersion,
        )
        const byOther = await updateDraft(
          created.id,
          { ...afterPublish.draftData, title: 'Theirs' },
          other.id,
          afterPublish.draftVersion,
        )
        const { items } = await listRevisions(created.id)
        expect(items.map((rev) => rev.note)).toEqual([
          'update',
          'update',
          'publish',
          'update',
          'create',
        ])
        expect(byOther.draftVersion).toBe(afterPublish.draftVersion + 1)

        // The window is measured from the autosave's creation, not its last save.
        await db
          .update(entryRevision)
          .set({ createdAt: new Date(Date.now() - 11 * 60 * 1000) })
          .where(eq(entryRevision.id, items[0]?.id ?? ''))
        await updateDraft(
          created.id,
          { ...byOther.draftData, title: 'Late' },
          other.id,
          byOther.draftVersion,
        )
        const later = await listRevisions(created.id)
        expect(later.items.map((rev) => rev.note).slice(0, 2)).toEqual([
          'update',
          'update',
        ])
        expect(later.items.length).toBe(items.length + 1)
        expect(autosave.draftVersion).toBeGreaterThan(0)
      } finally {
        await removeUsers([other.id])
      }
    })
  })

  it('counts autosaves in one audit row per person and entry', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const other = await makeUser({ name: 'Second Editor' })
      try {
        const created = await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'articles',
          data: {
            title: 'Audited',
            slug: `audited-${ctx.suffix}`,
            body: sampleRichText,
          },
          actorId: ctx.actor.id,
        })
        let version = created.draftVersion
        const save = async (
          title: string,
          actorId: string,
          options: { explicit?: boolean } = {},
        ) => {
          const saved = await updateDraft(
            created.id,
            { ...created.draftData, title },
            actorId,
            version,
            undefined,
            options,
          )
          version = saved.draftVersion
        }
        const updates = () =>
          db
            .select()
            .from(auditLog)
            .where(
              and(
                eq(auditLog.targetId, created.id),
                eq(auditLog.action, 'entry.update'),
              ),
            )
            .orderBy(auditLog.createdAt)

        await save('One', ctx.actor.id)
        const [started] = await updates()
        await save('Two', ctx.actor.id)
        await save('Three', ctx.actor.id)
        const first = await updates()
        expect(first).toHaveLength(1)
        expect(first[0]?.actorId).toBe(ctx.actor.id)
        expect(first[0]?.meta).toMatchObject({ saves: 3 })
        expect(typeof first[0]?.meta?.firstSavedAt).toBe('string')
        // The row stays where its first save put it, so the log's order and
        // its offset pages do not shift; the newest save is in the meta.
        expect(first[0]?.createdAt).toEqual(started.createdAt)
        const lastSaved = first[0]?.meta?.lastSavedAt
        expect(typeof lastSaved).toBe('string')
        expect(new Date(String(lastSaved)).getTime()).toBeGreaterThanOrEqual(
          started.createdAt.getTime(),
        )

        // An explicit save, another person and a save after the window each
        // start their own row.
        await save('Explicit', ctx.actor.id, { explicit: true })
        await save('After explicit', ctx.actor.id)
        await save('Theirs', other.id)
        const rows = await updates()
        expect(rows.map((row) => row.meta?.saves ?? null)).toEqual([
          3,
          null,
          1,
          1,
        ])

        const theirs = rows.at(-1)!
        await db
          .update(auditLog)
          .set({ createdAt: new Date(Date.now() - 16 * 60 * 1000) })
          .where(eq(auditLog.id, theirs.id))
        await save('Late', other.id)
        expect(await updates()).toHaveLength(5)
      } finally {
        await removeUsers([other.id])
      }
    })
  })

  it('pages the history newest first, without revision data', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Paged',
          slug: `paged-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      const base = Date.now() - 100 * 60 * 1000
      await db.insert(entryRevision).values(
        Array.from({ length: 34 }, (_, index) => ({
          entryId: created.id,
          data: { title: `Older ${index}` },
          createdBy: ctx.actor.id,
          note: 'publish',
          kind: 'milestone' as const,
          createdAt: new Date(base + index * 1000),
        })),
      )

      const first = await listRevisions(created.id)
      expect(first.items).toHaveLength(30)
      expect(first.items[0]).not.toHaveProperty('data')
      expect(first.nextCursor).toBe(first.items.at(-1)?.id)

      const second = await listRevisions(created.id, {
        cursor: first.nextCursor,
      })
      expect(second.items).toHaveLength(5)
      expect(second.nextCursor).toBeNull()
      const ids = [...first.items, ...second.items].map((rev) => rev.id)
      expect(new Set(ids).size).toBe(35)
    })
  })
})
