import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry } from '#/db/schema'
import type { EntryData, Field } from '#/lib/types'

import {
  formatLanguageBlockers,
  languageBlockers,
  validateLocaleSlugs,
} from './locale-validation.ts'
import { ValidationError } from './errors.ts'
import {
  createTestCollection,
  createTestSite,
  withTestSite,
} from './test-utils.ts'

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'body', label: 'Body', type: 'textarea', required: true },
  { key: 'salary', label: 'Salary', type: 'number', required: true },
]
const languages = { main: 'nl', all: ['nl', 'en', 'fr'] }

describe('languageBlockers', () => {
  it('returns nothing on a single-language site', () => {
    expect(
      languageBlockers({
        data: {},
        fields,
        languages: null,
        requiredLanguages: ['en'],
      }),
    ).toEqual([])
  })

  it('reports the main language and each required language with gaps', () => {
    const blockers = languageBlockers({
      data: {
        title: 'Backend ontwikkelaar',
        body: 'Tekst',
        salary: 4000,
        $i18n: { en: { title: 'Backend developer' } },
      },
      fields,
      languages,
      requiredLanguages: ['en'],
    })
    expect(blockers.map((b) => b.locale)).toEqual(['en'])
    expect(blockers[0]?.missing.map((f) => f.key)).toEqual(['body'])
  })

  it('ignores optional languages and required codes the site does not have', () => {
    const blockers = languageBlockers({
      data: { title: 'T', body: 'B', salary: 1 },
      fields,
      languages,
      requiredLanguages: ['de'],
    })
    expect(blockers).toEqual([])
  })

  it('treats the main language as required even when no codes are listed', () => {
    const blockers = languageBlockers({
      data: { salary: 1 },
      fields,
      languages,
      requiredLanguages: [],
    })
    expect(blockers.map((b) => b.locale)).toEqual(['nl'])
    expect(blockers[0]?.missing.map((f) => f.key)).toEqual(['title', 'body'])
  })
})

describe('formatLanguageBlockers', () => {
  it('names the language and the missing fields', () => {
    const text = formatLanguageBlockers([
      { locale: 'en', missing: [fields[0]!, fields[1]!] },
    ])
    expect(text).toBe('English is missing: Title, Body')
  })

  it('uses the given names when provided', () => {
    const text = formatLanguageBlockers(
      [{ locale: 'nl-BE', missing: [fields[0]!] }],
      { 'nl-BE': 'Vlaams' },
    )
    expect(text).toBe('Vlaams is missing: Title')
  })

  it('falls back to the tag for an unknown language', () => {
    const text = formatLanguageBlockers([
      { locale: 'zz-ZZ-x-test', missing: [fields[0]!] },
    ])
    expect(text).toContain('is missing: Title')
  })
})

const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('validateLocaleSlugs', () => {
  async function insertEntry(
    siteId: string,
    collectionId: string,
    slug: string,
    draftData: EntryData = {},
  ) {
    const [row] = await db
      .insert(entry)
      .values({ siteId, collectionId, slug, draftData })
      .returning()
    if (!row) throw new Error('insert failed')
    return row
  }

  it('rejects a per-language slug in the wrong format', async () => {
    await withTestSite(async (ctx) => {
      const col = await createTestCollection(ctx.site.id)
      const errors = await validateLocaleSlugs({
        collectionId: col.id,
        data: { $i18n: { en: { $slug: 'Not A Slug' } } },
      })
      expect(errors.map((e) => e.path)).toEqual(['$i18n.en.$slug'])
    })
  })

  it('accepts a valid per-language slug that nothing else uses', async () => {
    await withTestSite(async (ctx) => {
      const col = await createTestCollection(ctx.site.id)
      const errors = await validateLocaleSlugs({
        collectionId: col.id,
        data: { $i18n: { en: { $slug: `free-${ctx.suffix}` } } },
      })
      expect(errors).toEqual([])
    })
  })

  it('rejects a per-language slug equal to another entry main slug', async () => {
    await withTestSite(async (ctx) => {
      const col = await createTestCollection(ctx.site.id)
      const slug = `main-${ctx.suffix}`
      await insertEntry(ctx.site.id, col.id, slug)
      const mine = await insertEntry(ctx.site.id, col.id, `mine-${ctx.suffix}`)
      const errors = await validateLocaleSlugs({
        collectionId: col.id,
        entryId: mine.id,
        data: { $i18n: { en: { $slug: slug } } },
      })
      expect(errors.map((e) => e.path)).toEqual(['$i18n.en.$slug'])
    })
  })

  it('rejects a per-language slug held by another entry in the same language', async () => {
    await withTestSite(async (ctx) => {
      const col = await createTestCollection(ctx.site.id)
      const shared = `shared-${ctx.suffix}`
      await insertEntry(ctx.site.id, col.id, `first-${ctx.suffix}`, {
        $i18n: { en: { $slug: shared } },
      })
      const mine = await insertEntry(
        ctx.site.id,
        col.id,
        `second-${ctx.suffix}`,
      )
      const other = await validateLocaleSlugs({
        collectionId: col.id,
        entryId: mine.id,
        data: { $i18n: { en: { $slug: shared } } },
      })
      expect(other.map((e) => e.path)).toEqual(['$i18n.en.$slug'])
      // The same slug in another language is a different slot and is fine.
      const otherLanguage = await validateLocaleSlugs({
        collectionId: col.id,
        entryId: mine.id,
        data: { $i18n: { fr: { $slug: shared } } },
      })
      expect(otherLanguage).toEqual([])
    })
  })

  it('does not count the entry itself or other collections', async () => {
    await withTestSite(async (ctx) => {
      const col = await createTestCollection(ctx.site.id)
      const elsewhere = await createTestCollection(ctx.site.id, { key: 'news' })
      const slug = `reuse-${ctx.suffix}`
      const mine = await insertEntry(ctx.site.id, col.id, `own-${ctx.suffix}`, {
        $i18n: { en: { $slug: slug } },
      })
      await insertEntry(ctx.site.id, elsewhere.id, slug)
      const errors = await validateLocaleSlugs({
        collectionId: col.id,
        entryId: mine.id,
        data: { $i18n: { en: { $slug: slug } } },
      })
      expect(errors).toEqual([])
    })
  })

  it('creates a site with languages when asked', async () => {
    const ctx = await createTestSite({ languages })
    expect(ctx.site.languages).toEqual(languages)
  })
})

void ValidationError
