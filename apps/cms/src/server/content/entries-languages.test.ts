import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry } from '#/db/schema'
import type { EntryData } from '#/lib/types'

import {
  createEntry,
  publishEntry,
  scheduleEntry,
  updateDraft,
} from './entries.ts'
import { ValidationError } from './errors.ts'
import { lockSlugClaims } from './locale-validation.ts'
import {
  createTestCollection,
  createTestSite,
  cleanupTestSite,
  holdEntryLock,
  observe,
  sampleRichText,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

const languages = { main: 'nl', all: ['nl', 'en', 'fr'] }

async function setup(requiredLanguages: string[] = ['en']) {
  const ctx = await createTestSite({ languages })
  await createTestCollection(ctx.site.id, { requiredLanguages })
  return ctx
}

describe.skipIf(!hasDb)('entry lifecycle with languages', () => {
  it('blocks ready when a required language misses a translatable field', async () => {
    const ctx = await setup(['en'])
    try {
      const slug = `vacancy-${ctx.suffix}`
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Backend ontwikkelaar',
          slug,
          body: sampleRichText,
          $i18n: { en: { title: 'Backend developer' } },
        },
        actorId: ctx.actor.id,
      })
      const error = await publishEntry(created.id, ctx.actor.id).catch(
        (e: unknown) => e,
      )
      expect(error).toBeInstanceOf(ValidationError)
      const err = error as ValidationError
      expect(err.message).toBe('English is missing: Body')
      expect(err.blockers).toEqual([{ locale: 'en', missing: ['body'] }])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('lets a site with languages go live when required languages are complete', async () => {
    const ctx = await setup(['en'])
    try {
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Backend ontwikkelaar',
          slug: `vacancy-${ctx.suffix}`,
          body: sampleRichText,
          $i18n: {
            en: { title: 'Backend developer', body: sampleRichText },
          },
        },
        actorId: ctx.actor.id,
      })
      const published = await publishEntry(created.id, ctx.actor.id)
      expect(published.status).toBe('published')
      expect(published.publishedData).toMatchObject({
        title: 'Backend ontwikkelaar',
        $i18n: { en: { title: 'Backend developer' } },
      })
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('does not block on an optional language that is incomplete', async () => {
    const ctx = await setup([])
    try {
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Backend ontwikkelaar',
          slug: `vacancy-${ctx.suffix}`,
          body: sampleRichText,
          $i18n: { fr: { title: 'Développeur' } },
        },
        actorId: ctx.actor.id,
      })
      const published = await publishEntry(created.id, ctx.actor.id)
      expect(published.status).toBe('published')
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('blocks schedule the same way as ready', async () => {
    const ctx = await setup(['en'])
    try {
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Backend ontwikkelaar',
          slug: `vacancy-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      const when = new Date(Date.now() + 3_600_000).toISOString()
      await expect(
        scheduleEntry(created.id, when, 'Europe/Amsterdam', ctx.actor.id),
      ).rejects.toThrow('English is missing: Title, Body')
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('normalises the base to the main language when a draft is saved', async () => {
    const ctx = await setup([])
    try {
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Backend ontwikkelaar',
          slug: `v-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      // Stored with the base in English (the main language used to be en).
      await db
        .update(entry)
        .set({
          draftData: {
            $locale: 'en',
            title: 'Backend developer',
            slug: `v-${ctx.suffix}`,
            body: sampleRichText,
            $i18n: { nl: { title: 'Backend ontwikkelaar' } },
          },
        })
        .where(eq(entry.id, created.id))
      const current = (
        await db.select().from(entry).where(eq(entry.id, created.id)).limit(1)
      )[0]
      const saved = await updateDraft(
        created.id,
        {
          ...current.draftData,
          title: 'Backend developer',
        },
        ctx.actor.id,
        current.draftVersion,
      )
      expect(saved.draftData.$locale).toBeUndefined()
      expect(saved.draftData.title).toBe('Backend ontwikkelaar')
      expect(saved.draftData.$i18n).toEqual({
        en: expect.objectContaining({ title: 'Backend developer' }),
      })
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('keeps translations for languages the site no longer has', async () => {
    const ctx = await setup([])
    try {
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Backend ontwikkelaar',
          slug: `v-${ctx.suffix}`,
          body: sampleRichText,
          $i18n: { de: { title: 'Backend-Entwickler' } },
        },
        actorId: ctx.actor.id,
      })
      const saved = await updateDraft(
        created.id,
        {
          title: 'Backend ontwikkelaar',
          slug: `v-${ctx.suffix}`,
          body: sampleRichText,
          $i18n: { de: { title: 'Backend-Entwickler' } },
        },
        ctx.actor.id,
        created.draftVersion,
      )
      expect(saved.draftData.$i18n).toEqual({
        de: { title: 'Backend-Entwickler' },
      })
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('rejects a per-language slug that another entry already uses', async () => {
    const ctx = await setup([])
    try {
      const col = await createTestCollection(ctx.site.id, { key: 'news' })
      void col
      const first = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'One',
          slug: `one-${ctx.suffix}`,
          body: sampleRichText,
          $i18n: { en: { $slug: `shared-${ctx.suffix}` } },
        },
        actorId: ctx.actor.id,
      })
      expect(first.status).toBe('draft')
      const second = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'Two', slug: `two-${ctx.suffix}`, body: sampleRichText },
        actorId: ctx.actor.id,
      })
      await expect(
        updateDraft(
          second.id,
          {
            title: 'Two',
            slug: `two-${ctx.suffix}`,
            body: sampleRichText,
            $i18n: { en: { $slug: `shared-${ctx.suffix}` } },
          },
          ctx.actor.id,
          second.draftVersion,
        ),
      ).rejects.toBeInstanceOf(ValidationError)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('rechecks a per-language slug under the save lock, so a URL taken while the save waited is refused', async () => {
    const ctx = await setup([])
    try {
      const first = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'One', slug: `one-${ctx.suffix}`, body: sampleRichText },
        actorId: ctx.actor.id,
      })
      const second = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'Two', slug: `two-${ctx.suffix}`, body: sampleRichText },
        actorId: ctx.actor.id,
      })
      const [owner] = await db
        .select({ collectionId: entry.collectionId })
        .from(entry)
        .where(eq(entry.id, first.id))
        .limit(1)
      const shared = `shared-${ctx.suffix}`

      // Another save (or a push) holds the attach lock and the slug claim, and takes the URL until it commits.
      const other = await holdEntryLock(ctx.site.organizationId, async (tx) => {
        await lockSlugClaims(tx, owner.collectionId, [shared])
        await tx.insert(entry).values({
          siteId: ctx.site.id,
          collectionId: owner.collectionId,
          slug: `other-${ctx.suffix}`,
          status: 'draft',
          draftData: {
            title: 'Other',
            slug: `other-${ctx.suffix}`,
            body: sampleRichText,
            $i18n: { en: { $slug: shared } },
          },
          createdBy: ctx.actor.id,
          updatedBy: ctx.actor.id,
        })
      })
      const save = observe(
        updateDraft(
          second.id,
          {
            title: 'Two',
            slug: `two-${ctx.suffix}`,
            body: sampleRichText,
            $i18n: { en: { $slug: shared } },
          },
          ctx.actor.id,
          second.draftVersion,
        ),
      )
      expect(await save.settledAfterWait()).toBe(false)
      other.release()
      await other.done

      const result = await save.outcome
      if (result.ok) throw new Error('the save should have been refused')
      expect(result.error).toBeInstanceOf(ValidationError)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('accepts a partial translation in a draft', async () => {
    const ctx = await setup(['en'])
    try {
      const data: EntryData = {
        title: 'Backend ontwikkelaar',
        slug: `v-${ctx.suffix}`,
        body: sampleRichText,
        $i18n: { en: { title: 'Backend developer' } },
      }
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data,
        actorId: ctx.actor.id,
      })
      expect(created.draftData.$i18n).toEqual({
        en: { title: 'Backend developer' },
      })
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})
