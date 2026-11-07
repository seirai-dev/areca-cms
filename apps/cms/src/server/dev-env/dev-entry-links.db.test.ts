import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { collection, entry, entryLink } from '#/db/schema'
import type { Field } from '#/lib/types'
import {
  createEntry,
  getEntry,
  publishEntry,
  updateDraft,
} from '#/server/content/entries'
import { ValidationError } from '#/server/content/errors'
import { listInboundLinks } from '#/server/content/entry-link-index'
import { buildPreviewEntry } from '#/server/content/snapshot'
import {
  cleanupTestSite,
  createTestCollection,
  createTestSite,
  withTestSite,
} from '#/server/content/test-utils'

import { forkDevEnvironment } from './fork'
import { loadPlan } from './load-plan'
import { pushDevEnvironment } from './push'

const hasDb = Boolean(process.env.DATABASE_URL)

const articleFields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
]

/** A body with one paragraph, whose text links to `targetId` when given. */
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

/** The attributes of the first link mark in an entry's draft body. */
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

/**
 * Production: `concept` is a draft only (never ready, so the fork does not copy
 * it); `bron` is ready and links to `concept`.
 */
async function seedWithDraftTarget(ctx: {
  site: { id: string }
  actor: { id: string }
}) {
  const actorId = ctx.actor.id
  await createTestCollection(ctx.site.id, {
    key: 'articles',
    fields: articleFields,
    routePattern: '/blog/$slug',
  })
  const concept = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: { title: 'Concept', slug: 'concept', body: body('Kop') },
    actorId,
  })
  const bron = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: {
      title: 'Bron',
      slug: 'bron',
      body: body('Lees', concept.id),
    },
    actorId,
  })
  await publishEntry(bron.id, actorId)
  return { concept: concept.id, bron: bron.id }
}

describe.skipIf(!hasDb)(
  'development environment: entry links to production',
  () => {
    it('lets the dev environment save an entry that links to a production entry it did not copy', async () => {
      await withTestSite(async (ctx) => {
        const actorId = ctx.actor.id
        const { concept } = await seedWithDraftTarget(ctx)
        const devId = (await forkDevEnvironment({ id: actorId }, ctx.site.id))
          .id
        const devBron = await entryIdOf(devId, 'bron')
        const current = await getEntry(devBron)
        await updateDraft(
          devBron,
          { title: 'Bron v2', slug: 'bron', body: body('Lees', concept) },
          actorId,
          current!.draftVersion,
        )

        // The link keeps the production id, and the path of that production entry.
        const saved = await getEntry(devBron)
        expect(firstLinkAttrs(saved!.draftData)).toMatchObject({
          entryId: concept,
          href: '/blog/concept',
          collection: 'articles',
        })
      })
    })

    it('refuses a link from a dev environment to an entry of another site', async () => {
      await withTestSite(async (ctx) => {
        const actorId = ctx.actor.id
        await seedWithDraftTarget(ctx)
        const other = await createTestSite()
        try {
          await createTestCollection(other.site.id, {
            key: 'articles',
            fields: articleFields,
            routePattern: '/blog/$slug',
          })
          const foreign = await createEntry({
            siteId: other.site.id,
            collectionKey: 'articles',
            data: { title: 'Ander', slug: 'ander', body: body('Kop') },
            actorId: other.actor.id,
          })
          await publishEntry(foreign.id, other.actor.id)

          const devId = (await forkDevEnvironment({ id: actorId }, ctx.site.id))
            .id
          const devBron = await entryIdOf(devId, 'bron')
          const current = await getEntry(devBron)
          await expect(
            updateDraft(
              devBron,
              {
                title: 'Bron v2',
                slug: 'bron',
                body: body('Lees', foreign.id),
              },
              actorId,
              current!.draftVersion,
            ),
          ).rejects.toThrow(ValidationError)
        } finally {
          await cleanupTestSite(other)
        }
      })
    })

    it('previews and indexes a forked link to a production entry at its production path', async () => {
      await withTestSite(async (ctx) => {
        const { concept, bron: bronId } = await seedWithDraftTarget(ctx)
        const devId = (
          await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)
        ).id

        const preview = await buildPreviewEntry(devId, 'articles', 'bron')
        const html = (preview!.data.body as { html: string }).html
        expect(html).toContain(
          `href="/blog/concept" data-areca-entry="${concept}"`,
        )

        const indexed = await db
          .select({ id: entryLink.id })
          .from(entryLink)
          .where(
            and(
              eq(entryLink.siteId, devId),
              eq(entryLink.targetEntryId, concept),
            ),
          )
        expect(indexed).toHaveLength(1)

        // Production's "linked from" lists production's own links, not the dev one.
        const inbound = await listInboundLinks(concept)
        expect(inbound.map((link) => link.id)).toEqual([bronId])
      })
    })

    it('keeps the production id of a link when the dev entry is pushed', async () => {
      await withTestSite(async (ctx) => {
        const actorId = ctx.actor.id
        const { concept, bron } = await seedWithDraftTarget(ctx)
        const devId = (await forkDevEnvironment({ id: actorId }, ctx.site.id))
          .id
        const devBron = await entryIdOf(devId, 'bron')
        const current = await getEntry(devBron)
        await updateDraft(
          devBron,
          { title: 'Bron v2', slug: 'bron', body: body('Lees', concept) },
          actorId,
          current!.draftVersion,
        )
        await publishEntry(devBron, actorId)

        const plan = await loadPlan(db, devId)
        await pushDevEnvironment(
          { id: actorId },
          {
            devSiteId: devId,
            planHash: plan.planHash,
            exclude: [],
            apply: [],
            goLive: false,
          },
        )

        const pushed = await getEntry(bron)
        expect(pushed!.draftData.title).toBe('Bron v2')
        expect(firstLinkAttrs(pushed!.draftData)).toMatchObject({
          entryId: concept,
          href: '/blog/concept',
        })
        const ready = pushed!.publishedData as Record<string, unknown>
        expect(firstLinkAttrs(ready)).toMatchObject({ entryId: concept })
      })
    })
  },
)
