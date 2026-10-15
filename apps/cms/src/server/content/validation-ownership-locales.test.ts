import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { asset } from '#/db/schema'
import type { Field } from '#/lib/types'

import { createEntry } from './entries.ts'
import { validateContentOwnership } from './validation.ts'
import {
  cleanupTestSite,
  createTestCollection,
  createTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'cover', label: 'Cover', type: 'image', translatable: true },
  { key: 'related', label: 'Related', type: 'reference', collection: 'articles', translatable: true },
]

async function foreignAsset(orgId: string, suffix: string) {
  const [row] = await db
    .insert(asset)
    .values({
      organizationId: orgId,
      storageKey: `${orgId}/foreign-${suffix}.png`,
      originalFilename: 'foreign.png',
      mimeType: 'image/png',
      size: 1,
    })
    .returning()
  return row
}

describe.skipIf(!hasDb)('ownership of language slots', () => {
  it('rejects a foreign image, SEO image and reference inside a language slot', async () => {
    const first = await createTestSite()
    const second = await createTestSite()
    try {
      await createTestCollection(first.site.id, { fields })
      await createTestCollection(second.site.id, { fields })
      const foreignImage = await foreignAsset(second.org.id, `img-${second.suffix}`)
      const foreignOg = await foreignAsset(second.org.id, `og-${second.suffix}`)
      const foreignEntry = await createEntry({
        siteId: second.site.id,
        collectionKey: 'articles',
        data: { title: 'Other', slug: `other-${second.suffix}` },
        actorId: second.actor.id,
      })
      const foreignEntryId = foreignEntry.id

      const errors = await validateContentOwnership(
        first.site.id,
        first.org.id,
        fields,
        {
          title: 'Base',
          $i18n: {
            en: {
              cover: foreignImage.id,
              related: foreignEntryId,
              $seo: { ogImage: foreignOg.id },
            },
          },
        },
      )
      const paths = errors.map((error) => error.path)
      expect(paths).toContain('$i18n.en.cover')
      expect(paths).toContain('$i18n.en.related')
      expect(paths).toContain('$i18n.en.$seo.ogImage')
    } finally {
      await cleanupTestSite(first)
      await cleanupTestSite(second)
    }
  })

  it('accepts own-organization assets inside a language slot', async () => {
    const ctx = await createTestSite()
    try {
      await createTestCollection(ctx.site.id, { fields })
      const own = await foreignAsset(ctx.org.id, `own-${ctx.suffix}`)
      const errors = await validateContentOwnership(
        ctx.site.id,
        ctx.org.id,
        fields,
        { title: 'Base', $i18n: { fr: { cover: own.id, $seo: { ogImage: own.id } } } },
      )
      expect(errors).toEqual([])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('rejects a write whose language slot holds a foreign image', async () => {
    const first = await createTestSite()
    const second = await createTestSite()
    try {
      await createTestCollection(first.site.id, { fields })
      const foreignImage = await foreignAsset(second.org.id, `write-${second.suffix}`)
      await expect(
        createEntry({
          siteId: first.site.id,
          collectionKey: 'articles',
          data: {
            title: 'Base',
            slug: `write-${first.suffix}`,
            $i18n: { en: { cover: foreignImage.id } },
          },
          actorId: first.actor.id,
        }),
      ).rejects.toThrow()
    } finally {
      await cleanupTestSite(first)
      await cleanupTestSite(second)
    }
  })
})
