import { describe, expect, it } from 'vitest'

import { archiveEntry, createEntry } from './entries.ts'
import { resolvePreviewOwners } from './preview-owners.ts'
import {
  cleanupTestSite,
  createTestCollection,
  createTestGlobal,
  createTestSite,
  sampleRichText,
  withTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

const editor = { isAgencyAdmin: false }
const agency = { isAgencyAdmin: true }

describe.skipIf(!hasDb)('resolvePreviewOwners', () => {
  it('verifies an entry with its title and collection label', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Hello there',
          slug: `hello-${ctx.suffix}`,
          excerpt: '',
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })

      const [resolved] = await resolvePreviewOwners(
        ctx.site.id,
        [{ entry: created.id }],
        editor,
      )
      expect(resolved).toEqual({
        kind: 'entry',
        entryId: created.id,
        collectionKey: 'articles',
        collectionLabel: 'Articles',
        label: 'Hello there',
      })
    })
  })

  it('resolves a global by its raw key and by its camelCase key', async () => {
    await withTestSite(async (ctx) => {
      const section = await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
        label: 'Company info',
      })

      const resolved = await resolvePreviewOwners(
        ctx.site.id,
        [{ global: 'companyInfo' }, { global: 'company_info' }],
        editor,
      )
      const expected = {
        kind: 'global',
        entryId: section.entry.id,
        globalKey: 'companyInfo',
        label: 'Company info',
      }
      expect(resolved).toEqual([expected, expected])
    })
  })

  it('matches a snake_case stored key by its camelCase marker', async () => {
    await withTestSite(async (ctx) => {
      const section = await createTestGlobal(ctx.site.id, {
        key: 'site_footer',
        label: 'Footer',
      })

      const [resolved] = await resolvePreviewOwners(
        ctx.site.id,
        [{ global: 'siteFooter' }],
        editor,
      )
      expect(resolved).toEqual({
        kind: 'global',
        entryId: section.entry.id,
        globalKey: 'site_footer',
        label: 'Footer',
      })
    })
  })

  it('returns null for an archived entry', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Old',
          slug: `old-${ctx.suffix}`,
          excerpt: '',
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      await archiveEntry(created.id, ctx.actor.id)

      const [resolved] = await resolvePreviewOwners(
        ctx.site.id,
        [{ entry: created.id }],
        editor,
      )
      expect(resolved).toBeNull()
    })
  })

  it('returns null for an entry of another site', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const other = await createTestSite()
      try {
        await createTestCollection(other.site.id)
        const foreign = await createEntry({
          siteId: other.site.id,
          collectionKey: 'articles',
          data: {
            title: 'Foreign',
            slug: `foreign-${other.suffix}`,
            excerpt: '',
            body: sampleRichText,
          },
          actorId: other.actor.id,
        })

        const [resolved] = await resolvePreviewOwners(
          ctx.site.id,
          [{ entry: foreign.id }],
          agency,
        )
        expect(resolved).toBeNull()
      } finally {
        await cleanupTestSite(other)
      }
    })
  })

  it('returns null for unknown ids and keys', async () => {
    await withTestSite(async (ctx) => {
      const resolved = await resolvePreviewOwners(
        ctx.site.id,
        [{ entry: crypto.randomUUID() }, { global: 'doesNotExist' }],
        agency,
      )
      expect(resolved).toEqual([null, null])
    })
  })

  it('hides a disabled section from editors and shows it to the agency', async () => {
    await withTestSite(async (ctx) => {
      const section = await createTestGlobal(ctx.site.id, {
        key: 'footer',
        label: 'Footer',
        enabled: false,
      })
      const owners = [{ global: 'footer' }, { entry: section.entry.id }]

      expect(await resolvePreviewOwners(ctx.site.id, owners, editor)).toEqual([
        null,
        null,
      ])

      const expected = {
        kind: 'global',
        entryId: section.entry.id,
        globalKey: 'footer',
        label: 'Footer',
      }
      expect(await resolvePreviewOwners(ctx.site.id, owners, agency)).toEqual([
        expected,
        expected,
      ])
    })
  })

  it('keeps input order, returns one result per input, and handles duplicates', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Ordered',
          slug: `ordered-${ctx.suffix}`,
          excerpt: '',
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      const section = await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
        label: 'Company info',
      })

      const resolved = await resolvePreviewOwners(
        ctx.site.id,
        [
          { global: 'companyInfo' },
          { entry: created.id },
          { global: 'companyInfo' },
          { entry: crypto.randomUUID() },
          { entry: created.id },
        ],
        editor,
      )
      expect(resolved).toHaveLength(5)
      expect(resolved[0]).toEqual({
        kind: 'global',
        entryId: section.entry.id,
        globalKey: 'companyInfo',
        label: 'Company info',
      })
      expect(resolved[1]).toMatchObject({ kind: 'entry', label: 'Ordered' })
      expect(resolved[2]).toEqual(resolved[0])
      expect(resolved[3]).toBeNull()
      expect(resolved[4]).toEqual(resolved[1])
    })
  })

  it('returns an empty list for no owners', async () => {
    await withTestSite(async (ctx) => {
      expect(await resolvePreviewOwners(ctx.site.id, [], editor)).toEqual([])
    })
  })
})
