import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { auditLog, entry, entryRevision } from '#/db/schema'
import { createEntry, publishEntry } from '#/server/content/entries'
import { ValidationError } from '#/server/content/errors'
import {
  cleanupTestSite,
  createTestCollection,
  createTestSite,
  sampleRichText,
} from '#/server/content/test-utils'

import {
  normalizeSiteLanguages,
  previewMainChange,
  setSiteLanguages,
} from './site-languages.ts'

describe('normalizeSiteLanguages', () => {
  it('canonicalises tags', () => {
    expect(
      normalizeSiteLanguages({ main: 'NL-be', all: ['NL-be', 'en'] }),
    ).toEqual({
      main: 'nl-BE',
      all: ['nl-BE', 'en'],
    })
  })

  it('rejects an invalid tag', () => {
    expect(() =>
      normalizeSiteLanguages({ main: 'nl', all: ['not a tag!!'] }),
    ).toThrow(ValidationError)
  })

  it('rejects duplicates, including ones that only differ by case', () => {
    expect(() =>
      normalizeSiteLanguages({ main: 'en', all: ['en', 'EN'] }),
    ).toThrow(ValidationError)
  })

  it('requires the main language to be one of the languages', () => {
    expect(() =>
      normalizeSiteLanguages({ main: 'fr', all: ['nl', 'en'] }),
    ).toThrow(ValidationError)
  })

  it('requires at least one language', () => {
    expect(() => normalizeSiteLanguages({ main: 'nl', all: [] })).toThrow(
      ValidationError,
    )
  })
})

const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('setSiteLanguages', () => {
  it('stores the languages and writes an audit entry', async () => {
    const ctx = await createTestSite()
    try {
      const result = await setSiteLanguages(
        ctx.site.id,
        { main: 'nl', all: ['nl', 'en'] },
        ctx.actor.id,
      )
      expect(result).toEqual({
        languages: { main: 'nl', all: ['nl', 'en'] },
        gaps: 0,
      })
      const [row] = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.siteId, ctx.site.id),
            eq(auditLog.action, 'site.languages_update'),
          ),
        )
      expect(row.action).toBe('site.languages_update')
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('previews and then counts the entries that lack the new main language', async () => {
    const ctx = await createTestSite({
      languages: { main: 'nl', all: ['nl', 'en'] },
    })
    try {
      await createTestCollection(ctx.site.id)
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
      await publishEntry(created.id, ctx.actor.id)

      expect(await previewMainChange(ctx.site.id, 'en')).toBe(1)
      expect(await previewMainChange(ctx.site.id, 'nl')).toBe(0)

      const result = await setSiteLanguages(
        ctx.site.id,
        { main: 'en', all: ['en', 'nl'] },
        ctx.actor.id,
      )
      expect(result.gaps).toBe(1)
      expect(result.languages.main).toBe('en')
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('stamps the old main language onto existing data when main changes', async () => {
    const ctx = await createTestSite({
      languages: { main: 'nl', all: ['nl', 'en'] },
    })
    try {
      await createTestCollection(ctx.site.id)
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
      await publishEntry(created.id, ctx.actor.id)

      await setSiteLanguages(
        ctx.site.id,
        { main: 'en', all: ['en', 'nl'] },
        ctx.actor.id,
      )

      const [row] = await db
        .select()
        .from(entry)
        .where(eq(entry.id, created.id))
      expect(row.draftData.$locale).toBe('nl')
      expect(row.publishedData?.$locale).toBe('nl')
      const revisions = await db
        .select()
        .from(entryRevision)
        .where(eq(entryRevision.entryId, created.id))
      expect(revisions.length).toBeGreaterThan(0)
      for (const revision of revisions) {
        expect(revision.data.$locale).toBe('nl')
      }
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('keeps removed languages out of the list but leaves their data alone', async () => {
    const ctx = await createTestSite({
      languages: { main: 'nl', all: ['nl', 'en', 'fr'] },
    })
    try {
      await createTestCollection(ctx.site.id)
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Backend ontwikkelaar',
          slug: `v-${ctx.suffix}`,
          body: sampleRichText,
          $i18n: { fr: { title: 'Développeur' } },
        },
        actorId: ctx.actor.id,
      })
      const result = await setSiteLanguages(
        ctx.site.id,
        { main: 'nl', all: ['nl', 'en'] },
        ctx.actor.id,
      )
      expect(result.languages.all).toEqual(['nl', 'en'])
      const [row] = await db
        .select()
        .from(entry)
        .where(eq(entry.id, created.id))
      expect(row.draftData.$i18n).toEqual({ fr: { title: 'Développeur' } })
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})
