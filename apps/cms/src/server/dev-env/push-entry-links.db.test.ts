import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { collection, entry } from '#/db/schema'
import type { Field } from '#/lib/types'
import {
  createEntry,
  getEntry,
  publishEntry,
  updateDraft,
} from '#/server/content/entries'
import { createTestCollection, withTestSite } from '#/server/content/test-utils'

import { forkDevEnvironment } from './fork'
import { loadPlan } from './load-plan'
import { pushDevEnvironment } from './push'

const hasDb = Boolean(process.env.DATABASE_URL)

const articleFields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
]

function body(text: string, targetId?: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text,
            ...(targetId
              ? {
                  marks: [
                    {
                      type: 'link',
                      attrs: {
                        href: '/placeholder',
                        entryId: targetId,
                        collection: 'articles',
                      },
                    },
                  ],
                }
              : {}),
          },
        ],
      },
    ],
  }
}

function firstLinkAttrs(data: Record<string, unknown>) {
  const doc = data.body as {
    content: { content: { marks?: { attrs: Record<string, unknown> }[] }[] }[]
  }
  return doc.content[0].content[0].marks![0].attrs
}

async function entryIdOf(siteId: string, slug: string) {
  const row = (
    await db
      .select({ id: entry.id })
      .from(entry)
      .innerJoin(collection, eq(collection.id, entry.collectionId))
      .where(
        and(
          eq(entry.siteId, siteId),
          eq(collection.key, 'articles'),
          eq(entry.slug, slug),
        ),
      )
      .limit(1)
  ).at(0)
  if (!row) throw new Error(`no entry ${slug}`)
  return row.id
}

describe.skipIf(!hasDb)(
  'development environment: entry links after a push',
  () => {
    it("recomputes a pushed link's path from production's target, not the dev slug", async () => {
      await withTestSite(async (ctx) => {
        const actorId = ctx.actor.id
        await createTestCollection(ctx.site.id, {
          key: 'articles',
          fields: articleFields,
          routePattern: '/blog/$slug',
        })
        const target = await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'articles',
          data: { title: 'Doel', slug: 'b-old', body: body('Kop') },
          actorId,
        })
        await publishEntry(target.id, actorId)
        const source = await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'articles',
          data: {
            title: 'Bron',
            slug: 'a',
            body: body('Lees', target.id),
          },
          actorId,
        })
        await publishEntry(source.id, actorId)

        const devId = (await forkDevEnvironment({ id: actorId }, ctx.site.id))
          .id
        // Rename the target in dev, then save and publish the source in dev, so
        // the source's link carries the dev slug.
        const devTarget = await entryIdOf(devId, 'b-old')
        const devTargetCurrent = await getEntry(devTarget)
        await updateDraft(
          devTarget,
          { title: 'Doel', slug: 'b-new', body: body('Kop') },
          actorId,
          devTargetCurrent!.draftVersion,
        )
        await publishEntry(devTarget, actorId)
        const devSource = await entryIdOf(devId, 'a')
        const devSourceCurrent = await getEntry(devSource)
        await updateDraft(
          devSource,
          { title: 'Bron v2', slug: 'a', body: body('Lees', devTarget) },
          actorId,
          devSourceCurrent!.draftVersion,
        )
        await publishEntry(devSource, actorId)
        expect(
          firstLinkAttrs((await getEntry(devSource))!.draftData),
        ).toMatchObject({ href: '/blog/b-new' })

        // Push only the source: production's target keeps its slug.
        const plan = await loadPlan(db, devId)
        await pushDevEnvironment(
          { id: actorId },
          {
            devSiteId: devId,
            planHash: plan.planHash,
            exclude: [`entry:${devTarget}`],
            apply: [],
            goLive: false,
          },
        )

        const pushed = await getEntry(source.id)
        expect(pushed!.draftData.title).toBe('Bron v2')
        expect(firstLinkAttrs(pushed!.draftData)).toMatchObject({
          entryId: target.id,
          href: '/blog/b-old',
          collection: 'articles',
        })
        expect(
          firstLinkAttrs(pushed!.publishedData as Record<string, unknown>),
        ).toMatchObject({ entryId: target.id, href: '/blog/b-old' })
      })
    })
  },
)
