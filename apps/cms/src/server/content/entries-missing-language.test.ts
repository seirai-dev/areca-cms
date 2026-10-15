import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry } from '#/db/schema'

import { createEntry, listEntries } from './entries.ts'
import {
  cleanupTestSite,
  createTestCollection,
  createTestSite,
  sampleRichText,
} from './test-utils.ts'

// Only runs against the throwaway test database, never the dev `areca` DB:
//   DATABASE_URL=postgres://…/areca_i18n_test pnpm --filter @areca/cms exec vitest run <this file>
const url = process.env.DATABASE_URL ?? ''
const onTestDb = /\/areca_i18n_test(\?|$)/.test(url)

const languages = { main: 'nl', all: ['nl', 'en', 'fr'] }

/** Sets the draft directly, so each fixture is exactly the shape under test. */
async function setDraft(id: string, data: Record<string, unknown>) {
  await db.update(entry).set({ draftData: data }).where(eq(entry.id, id))
}

describe.skipIf(!onTestDb)('listEntries missingLanguage', () => {
  it('returns only entries not complete in the language, with exact paging', async () => {
    const ctx = await createTestSite({ languages })
    try {
      await createTestCollection(ctx.site.id, { requiredLanguages: ['en'] })

      const make = async (name: string) =>
        (
          await createEntry({
            siteId: ctx.site.id,
            collectionKey: 'articles',
            data: {
              title: name,
              slug: `${name}-${ctx.suffix}`,
              excerpt: '',
              body: sampleRichText,
            },
            actorId: ctx.actor.id,
          })
        ).id

      // A: complete in nl and en.
      const a = await make('a')
      await setDraft(a, {
        title: 'Titel',
        slug: `a-${ctx.suffix}`,
        body: sampleRichText,
        $i18n: { en: { title: 'Title', body: sampleRichText } },
      })
      // B: en partial (no body).
      const b = await make('b')
      await setDraft(b, {
        title: 'Titel',
        slug: `b-${ctx.suffix}`,
        body: sampleRichText,
        $i18n: { en: { title: 'Title' } },
      })
      // C: en not started.
      const c = await make('c')
      await setDraft(c, {
        title: 'Titel',
        slug: `c-${ctx.suffix}`,
        body: sampleRichText,
      })
      // D: nl itself incomplete, en not started.
      const d = await make('d')
      await setDraft(d, { title: 'Titel', slug: `d-${ctx.suffix}` })

      const ids = async (options: Parameters<typeof listEntries>[2]) => {
        const result = await listEntries(ctx.site.id, 'articles', options)
        return { total: result.total, ids: result.items.map((row) => row.id) }
      }

      const english = await ids({ missingLanguage: 'en' })
      expect(english.total).toBe(3)
      expect(new Set(english.ids)).toEqual(new Set([b, c, d]))
      expect(english.ids).not.toContain(a)

      const french = await ids({ missingLanguage: 'fr' })
      expect(french.total).toBe(4)

      const unfiltered = await ids({})
      expect(unfiltered.total).toBe(4)

      // A language the site does not have is ignored, not an empty list.
      const stale = await ids({ missingLanguage: 'de' })
      expect(stale.total).toBe(4)

      // Paging: total stays exact and pages do not overlap.
      const first = await ids({ missingLanguage: 'en', limit: 2, offset: 0 })
      const second = await ids({ missingLanguage: 'en', limit: 2, offset: 2 })
      expect(first.total).toBe(3)
      expect(first.ids).toHaveLength(2)
      expect(second.ids).toHaveLength(1)
      expect(new Set([...first.ids, ...second.ids])).toEqual(new Set([b, c, d]))
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})
