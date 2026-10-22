import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { collection, entry, site } from '#/db/schema'
import type { Field, SiteManifest } from '#/lib/types'
import { postSitesManifest } from '#/routes/api/sites/manifest'

import { syncManifest } from './collections.ts'
import { createEntry } from './entries.ts'
import { FieldDropsUnconfirmedError } from './field-data.ts'
import {
  articleFields,
  createTestCollection,
  createTestGlobal,
  globalFields,
  sampleRichText,
  withTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

const subtitle: Field = { key: 'subtitle', label: 'Subtitle', type: 'text' }
const phone = globalFields()[1]

/** The articles collection as a push declares it, without the subtitle field. */
function pushWithoutSubtitle(extra: Partial<SiteManifest> = {}): SiteManifest {
  return {
    collections: {
      articles: {
        route: '/blog/$slug',
        label: 'Articles',
        fields: articleFields(),
      },
    },
    ...extra,
  }
}

async function storedCollection(siteId: string, key: string) {
  return (
    await db.select().from(collection).where(eq(collection.siteId, siteId))
  ).find((row) => row.key === key)
}

async function storedDraft(id: string) {
  return (await db.select().from(entry).where(eq(entry.id, id)).limit(1)).at(0)
}

async function createArticleWithSubtitle(
  siteId: string,
  actorId: string,
  suffix: string,
) {
  await createTestCollection(siteId, { fields: [...articleFields(), subtitle] })
  return createEntry({
    siteId,
    collectionKey: 'articles',
    data: {
      title: `Article ${suffix}`,
      slug: `article-${suffix}`,
      body: sampleRichText,
      subtitle: 'Kept until confirmed',
    },
    actorId,
  })
}

describe.skipIf(!hasDb)('manifest push: field removals', () => {
  it('refuses a push that removes a field with content, lists it, and writes nothing', async () => {
    await withTestSite(async (ctx) => {
      const article = await createArticleWithSubtitle(
        ctx.site.id,
        ctx.actor.id,
        ctx.suffix,
      )

      const attempt = syncManifest(
        ctx.site.id,
        pushWithoutSubtitle({ languages: { main: 'nl', all: ['nl', 'en'] } }),
      )
      const error = await attempt.catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(FieldDropsUnconfirmedError)
      expect((error as FieldDropsUnconfirmedError).drops).toEqual([
        { kind: 'collection', key: 'articles', field: 'subtitle', entries: 1 },
      ])

      // Refused as a whole: the field, the content and the site languages are untouched.
      const stored = await storedCollection(ctx.site.id, 'articles')
      expect(stored?.fields.map((field) => field.key)).toContain('subtitle')
      expect((await storedDraft(article.id))?.draftData).toMatchObject({
        subtitle: 'Kept until confirmed',
      })
      expect(
        (
          await db.select().from(site).where(eq(site.id, ctx.site.id)).limit(1)
        )[0]?.languages,
      ).toBeNull()
    })
  })

  it('removes a confirmed field and deletes its content from the stored entries', async () => {
    await withTestSite(async (ctx) => {
      const article = await createArticleWithSubtitle(
        ctx.site.id,
        ctx.actor.id,
        ctx.suffix,
      )

      await syncManifest(ctx.site.id, pushWithoutSubtitle(), {
        confirmDropFields: ['articles.subtitle'],
      })

      const stored = await storedCollection(ctx.site.id, 'articles')
      expect(stored?.fields.map((field) => field.key)).not.toContain('subtitle')
      const draft = await storedDraft(article.id)
      expect(draft?.draftData).not.toHaveProperty('subtitle')
      expect(draft?.draftData).toMatchObject({ title: `Article ${ctx.suffix}` })
    })
  })

  it('removes a field that holds no content without confirmation', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, {
        fields: [...articleFields(), subtitle],
      })

      await syncManifest(ctx.site.id, pushWithoutSubtitle())

      const stored = await storedCollection(ctx.site.id, 'articles')
      expect(stored?.fields.map((field) => field.key)).not.toContain('subtitle')
    })
  })

  it('refuses a site content section field that holds content and names the section', async () => {
    await withTestSite(async (ctx) => {
      const section = await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
        fields: globalFields(),
      })
      await db
        .update(entry)
        .set({ draftData: { email: 'hi@acme.test', phone: '+31 20 000 0000' } })
        .where(eq(entry.id, section.entry.id))

      const error = await syncManifest(ctx.site.id, {
        collections: {},
        globals: {
          companyInfo: { label: 'Company info', fields: [globalFields()[0]] },
        },
      }).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(FieldDropsUnconfirmedError)
      expect((error as FieldDropsUnconfirmedError).drops).toEqual([
        { kind: 'global', key: 'companyInfo', field: phone.key, entries: 1 },
      ])
      expect((await storedDraft(section.entry.id))?.draftData).toMatchObject({
        phone: '+31 20 000 0000',
      })
    })
  })

  it('ignores confirmations for fields that are not removed', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, { fields: articleFields() })
      await expect(
        syncManifest(ctx.site.id, pushWithoutSubtitle(), {
          confirmDropFields: ['articles.subtitle'],
        }),
      ).resolves.toBeUndefined()
    })
  })
})

describe.skipIf(!hasDb)('manifest route: field removals', () => {
  function push(token: string, body: unknown) {
    return postSitesManifest(
      new Request('http://localhost/api/sites/manifest', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    )
  }

  it('answers 409 with the drops and applies nothing until they are confirmed', async () => {
    await withTestSite(async (ctx) => {
      await createArticleWithSubtitle(ctx.site.id, ctx.actor.id, ctx.suffix)
      const body = pushWithoutSubtitle()

      const refused = await push(ctx.schemaToken, body)
      expect(refused.status).toBe(409)
      expect(await refused.json()).toMatchObject({
        code: 'field_drops_unconfirmed',
        drops: [
          {
            kind: 'collection',
            key: 'articles',
            field: 'subtitle',
            entries: 1,
          },
        ],
      })
      expect(
        (await storedCollection(ctx.site.id, 'articles'))?.fields.map(
          (field) => field.key,
        ),
      ).toContain('subtitle')

      const accepted = await push(ctx.schemaToken, {
        ...body,
        confirmDropFields: ['articles.subtitle'],
      })
      expect(accepted.status).toBe(200)
      expect(
        (await storedCollection(ctx.site.id, 'articles'))?.fields.map(
          (field) => field.key,
        ),
      ).not.toContain('subtitle')
    })
  })

  it('rejects a malformed confirmation id', async () => {
    await withTestSite(async (ctx) => {
      const response = await push(ctx.schemaToken, {
        ...pushWithoutSubtitle(),
        confirmDropFields: ['articles'],
      })
      expect(response.status).toBe(400)
    })
  })
})
