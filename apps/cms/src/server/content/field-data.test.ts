import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry } from '#/db/schema'
import type { Field } from '#/lib/types'

import { upsertCollection } from './collections.ts'
import { createEntry, updateDraft } from './entries.ts'
import { ValidationError } from './errors.ts'
import { droppedFieldKeys, fieldDataUsageForCollection } from './field-data.ts'
import { upsertGlobal } from './globals.ts'
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

async function storedEntry(id: string) {
  return (await db.select().from(entry).where(eq(entry.id, id)).limit(1)).at(0)
}

async function createArticle(
  siteId: string,
  actorId: string,
  suffix: string,
  extra: Record<string, unknown> = {},
) {
  return createEntry({
    siteId,
    collectionKey: 'articles',
    data: {
      title: `Article ${suffix}`,
      slug: `article-${suffix}`,
      body: sampleRichText,
      ...extra,
    },
    actorId,
  })
}

function articleSave(fields: Field[], confirmDropFields?: string[]) {
  return {
    key: 'articles',
    label: 'Articles',
    routePattern: '/blog/$slug',
    fields,
    confirmDropFields,
  }
}

describe('droppedFieldKeys', () => {
  it('lists keys the new list no longer declares', () => {
    expect(
      droppedFieldKeys(
        [{ key: 'a', label: 'A', type: 'text' }, subtitle],
        [{ key: 'a', label: 'A', type: 'text' }],
      ),
    ).toEqual(['subtitle'])
  })
})

describe.skipIf(!hasDb)('field content locks', () => {
  it('counts entries holding content for a key, including translations only', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, {
        fields: [...articleFields(), subtitle],
      })
      const withText = await createArticle(
        ctx.site.id,
        ctx.actor.id,
        `a-${ctx.suffix}`,
        { subtitle: 'Hello' },
      )
      const blank = await createArticle(
        ctx.site.id,
        ctx.actor.id,
        `b-${ctx.suffix}`,
        { subtitle: '   ' },
      )
      // A Dutch-only subtitle lives under $i18n, not in the top-level data.
      await db
        .update(entry)
        .set({
          draftData: sql`${entry.draftData} || '{"$i18n":{"nl":{"subtitle":"Hoi"}}}'::jsonb`,
        })
        .where(eq(entry.id, blank.id))

      const usage = await fieldDataUsageForCollection(ctx.site.id, 'articles')
      // The English subtitle on one entry, the Dutch one on the blank entry.
      expect(usage.subtitle).toBe(2)
      expect(usage.excerpt).toBeUndefined()
      expect((await storedEntry(withText.id))?.draftData).toMatchObject({
        subtitle: 'Hello',
      })
    })
  })

  it('refuses to drop a field that still has content, and names it', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, {
        fields: [...articleFields(), subtitle],
      })
      const article = await createArticle(
        ctx.site.id,
        ctx.actor.id,
        ctx.suffix,
        { subtitle: 'Kept until confirmed' },
      )

      const attempt = upsertCollection(
        ctx.site.id,
        articleSave(articleFields()),
        ctx.actor.id,
      )
      await expect(attempt).rejects.toBeInstanceOf(ValidationError)
      await expect(attempt).rejects.toThrow(/subtitle/)
      expect((await storedEntry(article.id))?.draftData).toMatchObject({
        subtitle: 'Kept until confirmed',
      })
    })
  })

  it('deletes the content of a confirmed drop from every stored version', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, {
        fields: [...articleFields(), subtitle],
      })
      const article = await createArticle(
        ctx.site.id,
        ctx.actor.id,
        ctx.suffix,
        { subtitle: 'Going away' },
      )
      await db
        .update(entry)
        .set({
          publishedData: sql`${entry.draftData}`,
          scheduledData: sql`${entry.draftData}`,
        })
        .where(eq(entry.id, article.id))

      await upsertCollection(
        ctx.site.id,
        articleSave(articleFields(), ['subtitle']),
        ctx.actor.id,
      )

      const row = await storedEntry(article.id)
      expect(row?.draftData).not.toHaveProperty('subtitle')
      expect(row?.publishedData).not.toHaveProperty('subtitle')
      expect(row?.scheduledData).not.toHaveProperty('subtitle')
      expect(
        (await fieldDataUsageForCollection(ctx.site.id, 'articles')).subtitle,
      ).toBeUndefined()
    })
  })

  it('drops an unused field and adds a new one without confirmation', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, {
        fields: [...articleFields(), subtitle],
      })
      await createArticle(ctx.site.id, ctx.actor.id, ctx.suffix)

      await upsertCollection(
        ctx.site.id,
        articleSave([
          ...articleFields(),
          { key: 'summary', label: 'Summary', type: 'textarea' },
        ]),
        ctx.actor.id,
      )
      expect(
        (await fieldDataUsageForCollection(ctx.site.id, 'articles')).subtitle,
      ).toBeUndefined()
    })
  })

  it('locks a section field with content the same way', async () => {
    await withTestSite(async (ctx) => {
      const { entry: sectionEntry } = await createTestGlobal(ctx.site.id, {
        fields: globalFields(),
      })
      await db
        .update(entry)
        .set({ draftData: { email: 'hello@example.test', phone: '+31 20' } })
        .where(eq(entry.id, sectionEntry.id))

      const emailOnly = {
        key: 'companyInfo',
        label: 'Company info',
        fields: globalFields().filter((field) => field.key === 'email'),
      }
      const attempt = upsertGlobal(ctx.site.id, emailOnly, ctx.actor.id)
      await expect(attempt).rejects.toBeInstanceOf(ValidationError)
      await expect(attempt).rejects.toThrow(/phone/)

      await upsertGlobal(
        ctx.site.id,
        { ...emailOnly, confirmDropFields: ['phone'] },
        ctx.actor.id,
      )
      expect((await storedEntry(sectionEntry.id))?.draftData).toEqual({
        email: 'hello@example.test',
      })
    })
  })

  it('moves the draft version when a purge changes it, so a stale editor conflicts', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, {
        fields: [...articleFields(), subtitle],
      })
      const created = await createArticle(
        ctx.site.id,
        ctx.actor.id,
        ctx.suffix,
        { subtitle: 'v1' },
      )
      const edited = await updateDraft(
        created.id,
        { ...created.draftData, subtitle: 'v2' },
        ctx.actor.id,
        created.draftVersion,
      )
      await upsertCollection(
        ctx.site.id,
        articleSave(articleFields(), ['subtitle']),
        ctx.actor.id,
      )
      expect((await storedEntry(created.id))?.draftVersion).toBe(
        edited.draftVersion + 1,
      )
    })
  })
})
