import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { collection, entry, entryLink } from '#/db/schema'
import {
  createEntry,
  getEntry,
  publishEntry,
  updateDraft,
} from '#/server/content/entries'
import { createTestCollection, withTestSite } from '#/server/content/test-utils'
import type { Field } from '#/lib/types'

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

async function linkRows(siteId: string) {
  return db
    .select({
      id: entryLink.id,
      sourceEntryId: entryLink.sourceEntryId,
      targetEntryId: entryLink.targetEntryId,
    })
    .from(entryLink)
    .where(eq(entryLink.siteId, siteId))
}

describe.skipIf(!hasDb)(
  'development environment: push and the link index',
  () => {
    it('a one-entry push rewrites only the link rows of that entry', async () => {
      await withTestSite(async (ctx) => {
        const actorId = ctx.actor.id
        await createTestCollection(ctx.site.id, {
          key: 'articles',
          fields: articleFields,
          routePattern: '/blog/$slug',
        })
        const make = async (slug: string, text: string, targetId?: string) => {
          const created = await createEntry({
            siteId: ctx.site.id,
            collectionKey: 'articles',
            data: { title: slug, slug, body: body(text, targetId) },
            actorId,
          })
          await publishEntry(created.id, actorId)
          return created.id
        }
        const target = await make('target', 'Doel')
        await make('source', 'Bron', target)
        await make('bystander', 'Omstander', target)

        const devId = (await forkDevEnvironment({ id: actorId }, ctx.site.id))
          .id
        const devSource = await entryIdOf(devId, 'source')
        const current = await getEntry(devSource)
        await updateDraft(
          devSource,
          {
            title: 'Bron v2',
            slug: 'source',
            body: body('Bron v2', await entryIdOf(devId, 'target')),
          },
          actorId,
          current!.draftVersion,
        )
        await publishEntry(devSource, actorId)

        const bystander = await entryIdOf(ctx.site.id, 'bystander')
        const bystanderRowsBefore = (await linkRows(ctx.site.id))
          .filter((row) => row.sourceEntryId === bystander)
          .map((row) => row.id)
        expect(bystanderRowsBefore).toHaveLength(1)

        const plan = await loadPlan(db, devId)
        const result = await pushDevEnvironment(
          { id: actorId },
          {
            devSiteId: devId,
            planHash: plan.planHash,
            exclude: [],
            apply: [],
            goLive: false,
          },
        )
        expect(result.counts.changed).toBe(1)

        const after = await linkRows(ctx.site.id)
        expect(
          after
            .filter((row) => row.sourceEntryId === bystander)
            .map((row) => row.id),
        ).toEqual(bystanderRowsBefore)
        // The pushed entry keeps its link too.
        const source = await entryIdOf(ctx.site.id, 'source')
        expect(
          after.some(
            (row) =>
              row.sourceEntryId === source && row.targetEntryId === target,
          ),
        ).toBe(true)
      })
    })
  },
)
