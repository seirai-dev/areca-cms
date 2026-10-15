import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry } from '#/db/schema'
import { eq } from 'drizzle-orm'

import { publishEntry, updateDraft } from './entries.ts'
import { sectionBlockers, sectionSeoIssue, upsertGlobal } from './globals.ts'
import {
  cleanupTestSite,
  createTestGlobal,
  createTestSite,
  globalFields,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)
const languages = { main: 'nl', all: ['nl', 'en'] }

describe('sectionSeoIssue with per-language SEO', () => {
  it('rejects $seo inside a language slot when the section has no SEO', () => {
    const issue = sectionSeoIssue(
      { label: 'Contact', seoEnabled: false },
      { $i18n: { en: { $seo: { title: 'x' } } } },
    )
    expect(issue).toContain('has no SEO')
  })

  it('allows language SEO when the section has SEO', () => {
    expect(
      sectionSeoIssue(
        { label: 'Contact', seoEnabled: true },
        { $i18n: { en: { $seo: { title: 'x' } } } },
      ),
    ).toBeNull()
  })
})

describe.skipIf(!hasDb)('section blockers with languages', () => {
  it('reports a required language that is missing a required field', async () => {
    const ctx = await createTestSite({ languages })
    try {
      const { collection: section, entry: row } = await createTestGlobal(
        ctx.site.id,
        { fields: globalFields(), requiredLanguages: [] },
      )
      await updateDraft(
        row.id,
        { email: 'info@example.com', phone: '+31' },
        ctx.actor.id,
        row.draftVersion,
      )
      await publishEntry(row.id, ctx.actor.id)
      expect(await sectionBlockers(ctx.site.id)).toEqual([])

      await upsertGlobal(ctx.site.id, {
        key: section.key,
        label: section.label,
        fields: globalFields(),
        requiredLanguages: ['en'],
      })
      expect(await sectionBlockers(ctx.site.id)).toEqual([
        'Site content "Company info": English is missing: Email',
      ])

      // Filling the language clears the blocker.
      const current = (
        await db.select().from(entry).where(eq(entry.id, row.id)).limit(1)
      )[0]
      await updateDraft(
        row.id,
        {
          email: 'info@example.com',
          phone: '+31',
          $i18n: { en: { email: 'info@example.com' } },
        },
        ctx.actor.id,
        current.draftVersion,
      )
      await publishEntry(row.id, ctx.actor.id)
      expect(await sectionBlockers(ctx.site.id)).toEqual([])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('stores required language codes in canonical form without duplicates', async () => {
    const ctx = await createTestSite({ languages })
    try {
      const { collection: section } = await createTestGlobal(ctx.site.id, {
        fields: globalFields(),
      })
      const row = await upsertGlobal(ctx.site.id, {
        key: section.key,
        label: section.label,
        fields: globalFields(),
        requiredLanguages: ['EN', 'en'],
      })
      expect(row.requiredLanguages).toEqual(['en'])
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})
