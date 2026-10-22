import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry } from '#/db/schema'
import { localeStatus } from '#/lib/content-locale'
import type { EntryData, Field } from '#/lib/types'

import { listEntries } from './entries.ts'
import {
  cleanupTestSite,
  createTestCollection,
  createTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

const languages = { main: 'nl', all: ['nl', 'en', 'fr'] }

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
  {
    key: 'sku',
    label: 'SKU',
    type: 'text',
    required: true,
    translatable: false,
  },
  { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
]

const text = (value: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
})
const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

/** Draft shapes that cover every rule `localeStatus` applies. */
const shapes: Record<string, EntryData> = {
  completeInBoth: {
    title: 'Titel',
    body: text('Tekst'),
    sku: 'A1',
    $i18n: { en: { title: 'Title', body: text('Text') } },
  },
  blankTitle: {
    title: 'Titel',
    body: text('Tekst'),
    sku: 'A2',
    $i18n: { en: { title: '   ', body: text('Text') } },
  },
  emptyRichPlain: {
    title: 'Titel',
    body: text('Tekst'),
    sku: 'A3',
    $i18n: { en: { title: 'Title', body: emptyDoc } },
  },
  emptyRichNoContent: {
    title: 'Titel',
    body: text('Tekst'),
    sku: 'A4',
    $i18n: { en: { title: 'Title', body: { type: 'doc' } } },
  },
  richWithText: {
    title: 'Titel',
    body: text('Tekst'),
    sku: 'A5',
    $i18n: { en: { title: 'Title', body: text('Something') } },
  },
  noTranslation: { title: 'Titel', body: text('Tekst'), sku: 'A6' },
  emptyTranslationValues: {
    title: 'Titel',
    body: text('Tekst'),
    sku: 'A7',
    $i18n: { en: { title: '', body: null } },
  },
  baseIsEnglish: {
    $locale: 'en',
    title: 'Title',
    body: text('Text'),
    sku: 'A8',
    $i18n: { nl: { title: 'Titel', body: text('Tekst') } },
  },
  missingSharedRequired: {
    title: 'Titel',
    body: text('Tekst'),
    $i18n: { en: { title: 'Title', body: text('Text') } },
  },
  emptyObjectRich: {
    title: 'Titel',
    body: text('Tekst'),
    sku: 'A9',
    $i18n: { en: { title: 'Title', body: {} } },
  },
}

describe.skipIf(!hasDb)('missing-language filter in SQL', () => {
  it('agrees with localeStatus for every shape and language', async () => {
    const ctx = await createTestSite({ languages })
    try {
      const col = await createTestCollection(ctx.site.id, {
        fields,
        requiredLanguages: ['en'],
      })
      const ids = new Map<string, string>()
      for (const [name, draft] of Object.entries(shapes)) {
        const row = (
          await db
            .insert(entry)
            .values({
              siteId: ctx.site.id,
              collectionId: col.id,
              slug: `${name}-${ctx.suffix}`,
              draftData: { ...draft, slug: `${name}-${ctx.suffix}` },
            })
            .returning({ id: entry.id })
        ).at(0)
        ids.set(name, row?.id ?? '')
      }
      const byId = new Map(
        [...ids].map(([name, id]) => [id, shapes[name] ?? {}] as const),
      )
      const reference = { main: languages.main, all: languages.all, fields }

      for (const locale of ['nl', 'en', 'fr']) {
        const expected = new Set(
          [...byId]
            .filter(
              ([, draft]) => !localeStatus(draft, locale, reference).complete,
            )
            .map(([id]) => id),
        )
        const result = await listEntries(ctx.site.id, 'articles', {
          missingLanguage: locale,
          limit: 100,
        })
        expect(new Set(result.items.map((row) => row.id))).toEqual(expected)
        expect(result.total).toBe(expected.size)
      }
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('pages the filtered list with exact totals and no overlap', async () => {
    const ctx = await createTestSite({ languages })
    try {
      const col = await createTestCollection(ctx.site.id, {
        fields,
        requiredLanguages: ['en'],
      })
      // Every third entry is complete in English; the rest are not.
      const incomplete = new Set<string>()
      for (let index = 0; index < 25; index += 1) {
        const complete = index % 3 === 0
        const row = (
          await db
            .insert(entry)
            .values({
              siteId: ctx.site.id,
              collectionId: col.id,
              slug: `page-${index}-${ctx.suffix}`,
              draftData: {
                title: 'Titel',
                body: text('Tekst'),
                sku: `S${index}`,
                slug: `page-${index}-${ctx.suffix}`,
                $i18n: complete
                  ? { en: { title: 'Title', body: text('Text') } }
                  : { en: { title: 'Title' } },
              },
            })
            .returning({ id: entry.id })
        ).at(0)
        if (!complete && row) incomplete.add(row.id)
      }

      const seen: string[] = []
      for (let offset = 0; offset < 25; offset += 4) {
        const page = await listEntries(ctx.site.id, 'articles', {
          missingLanguage: 'en',
          limit: 4,
          offset,
        })
        expect(page.total).toBe(incomplete.size)
        seen.push(...page.items.map((row) => row.id))
      }
      expect(seen).toHaveLength(incomplete.size)
      expect(new Set(seen)).toEqual(incomplete)
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})
