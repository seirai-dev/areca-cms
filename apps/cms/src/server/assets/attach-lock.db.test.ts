import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { asset, entry } from '#/db/schema'
import type { Field } from '#/lib/types'
import { createEntry, updateDraft } from '#/server/content/entries'
import {
  createTestCollection,
  holdEntryLock,
  observe,
  waitForAdvisoryWaiter,
  withTestSite,
} from '#/server/content/test-utils'

import { AssetInUseError, deleteAsset } from './index'

const basic: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(!process.env.DATABASE_URL)(
  'asset attach lock (shared) versus asset delete (exclusive)',
  () => {
    it('lets draft saves in one organization run while another attach holds the lock', async () => {
      await withTestSite(async (ctx) => {
        await createTestCollection(ctx.site.id, { fields: basic })
        const first = await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'articles',
          data: { title: 'First', slug: 'first' },
          actorId: ctx.actor.id,
        })
        const second = await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'articles',
          data: { title: 'Second', slug: 'second' },
          actorId: ctx.actor.id,
        })

        // Another attacher (an ordinary save in progress) holds the shared lock
        // on this organization's asset key until released.
        const attach = await holdEntryLock(ctx.site.organizationId)
        try {
          const saves = Promise.all([
            updateDraft(
              first.id,
              { title: 'First v2', slug: 'first' },
              ctx.actor.id,
              first.draftVersion,
            ),
            updateDraft(
              second.id,
              { title: 'Second v2', slug: 'second' },
              ctx.actor.id,
              second.draftVersion,
            ),
          ])
          const finished = await Promise.race([
            saves.then(() => true as const),
            sleep(5_000).then(() => false as const),
          ])
          expect(finished).toBe(true)
          const [a, b] = await saves
          expect(a.draftVersion).toBe(first.draftVersion + 1)
          expect(b.draftVersion).toBe(second.draftVersion + 1)
        } finally {
          attach.release()
          await attach.done
        }
      })
    })

    it('lets exactly one of two concurrent creates claim the same slug', async () => {
      await withTestSite(async (ctx) => {
        await createTestCollection(ctx.site.id, { fields: basic })
        const results = await Promise.allSettled(
          ['one', 'two'].map((title) =>
            createEntry({
              siteId: ctx.site.id,
              collectionKey: 'articles',
              data: { title, slug: 'same-slug' },
              actorId: ctx.actor.id,
            }),
          ),
        )
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
        expect(
          await db.select().from(entry).where(eq(entry.slug, 'same-slug')),
        ).toHaveLength(1)
      })
    })

    it('makes an asset delete wait for an in-flight attach, then see the new reference', async () => {
      await withTestSite(async (ctx) => {
        const col = await createTestCollection(ctx.site.id, { fields: basic })
        const [image] = await db
          .insert(asset)
          .values({
            organizationId: ctx.org.id,
            storageKey: `${ctx.org.id}/attach-race.png`,
            originalFilename: 'attach-race.png',
            mimeType: 'image/png',
            size: 4,
          })
          .returning()

        // The attacher commits nothing until released: its reference to the
        // asset exists only inside its open transaction.
        const attach = await holdEntryLock(
          ctx.site.organizationId,
          async (tx) => {
            await tx.insert(entry).values({
              siteId: ctx.site.id,
              collectionId: col.id,
              slug: 'attached',
              draftData: {
                title: 'Attached',
                slug: 'attached',
                heroImage: image.id,
              },
            })
          },
        )
        try {
          const deletion = observe(deleteAsset(image.id, ctx.org.id))
          await waitForAdvisoryWaiter(`assets:${ctx.org.id}`)
          expect(await deletion.settledAfterWait()).toBe(false)

          attach.release()
          await attach.done
          const outcome = await deletion.outcome
          expect(outcome.ok).toBe(false)
          if (!outcome.ok) {
            expect(outcome.error).toBeInstanceOf(AssetInUseError)
            expect((outcome.error as AssetInUseError).usage).toBe(1)
          }
          expect(
            await db.select().from(asset).where(eq(asset.id, image.id)),
          ).toHaveLength(1)
        } finally {
          attach.release()
          await attach.done.catch(() => undefined)
        }
      })
    })
  },
)
