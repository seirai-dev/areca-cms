import { eq, sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry, entryLink } from '#/db/schema'

import { createEntry, publishEntry, unpublishEntry } from './entries.ts'
import {
  rebuildEntryLinkIndex,
  syncEntryLinkIndex,
} from './entry-link-index.ts'
import {
  cleanupTestSite,
  createTestCollection,
  createTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

function body(
  heading: string,
  paragraph: { text: string; link?: Record<string, unknown> },
) {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: heading }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: paragraph.text,
            ...(paragraph.link
              ? {
                  marks: [
                    {
                      type: 'link',
                      attrs: { href: '/placeholder', ...paragraph.link },
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

const TRIGGER = 'areca_test_fail_link_write'

/** Two published entries: `source` links to `target`; `other` is a second target. */
async function setup(suffix: string) {
  const ctx = await createTestSite()
  await createTestCollection(ctx.site.id, {
    key: 'articles',
    routePattern: '/blog/$slug',
  })
  const make = (slug: string, text: string) =>
    createEntry({
      siteId: ctx.site.id,
      collectionKey: 'articles',
      data: { title: slug, slug, body: body('Kop', { text }) },
      actorId: ctx.actor.id,
    })
  const target = await make(`target-${suffix}`, 'Doel')
  const other = await make(`other-${suffix}`, 'Ander')
  await publishEntry(target.id, ctx.actor.id)
  await publishEntry(other.id, ctx.actor.id)
  const source = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: {
      title: 'Bron',
      slug: `source-${suffix}`,
      body: body('Inleiding', {
        text: 'Lees',
        link: { entryId: target.id, collection: 'articles' },
      }),
    },
    actorId: ctx.actor.id,
  })
  await publishEntry(source.id, ctx.actor.id)
  return { ctx, target, other, source }
}

async function linkRows(sourceEntryId: string) {
  return db
    .select({
      locale: entryLink.locale,
      fieldKey: entryLink.fieldKey,
      targetEntryId: entryLink.targetEntryId,
      anchor: entryLink.anchor,
    })
    .from(entryLink)
    .where(eq(entryLink.sourceEntryId, sourceEntryId))
    .orderBy(entryLink.targetEntryId)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe.skipIf(!hasDb)(
  'entry link index: writes stay in step with content',
  () => {
    afterEach(async () => {
      await db.execute(
        sql.raw(`DROP TRIGGER IF EXISTS ${TRIGGER} ON entry_link`),
      )
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${TRIGGER}()`))
    })

    it('leaves the entry published and its index as it was when the index write fails during unpublish', async () => {
      const { ctx, source } = await setup('unpublish-fail')
      try {
        const before = await linkRows(source.id)
        expect(before).toHaveLength(1)
        // Fails only the link rows of this source, so other tests are not affected.
        await db.execute(
          sql.raw(`
          CREATE OR REPLACE FUNCTION ${TRIGGER}() RETURNS trigger AS $$
          BEGIN
            IF NEW.source_entry_id = '${source.id}' THEN
              RAISE EXCEPTION 'test: link write failed';
            END IF;
            RETURN NEW;
          END
          $$ LANGUAGE plpgsql
        `),
        )
        await db.execute(
          sql.raw(
            `CREATE TRIGGER ${TRIGGER} BEFORE INSERT ON entry_link FOR EACH ROW EXECUTE FUNCTION ${TRIGGER}()`,
          ),
        )

        await expect(unpublishEntry(source.id, ctx.actor.id)).rejects.toThrow(
          /entry_link/,
        )
        const [row] = await db
          .select({ status: entry.status })
          .from(entry)
          .where(eq(entry.id, source.id))
        expect(row.status).toBe('published')
        expect(await linkRows(source.id)).toEqual(before)
      } finally {
        await cleanupTestSite(ctx)
      }
    })

    it('rolls the index back when a rewrite fails midway, with the content write', async () => {
      const { ctx, target, source } = await setup('midway')
      try {
        const before = await linkRows(source.id)
        await expect(
          db.transaction(async (tx) => {
            await tx
              .update(entry)
              .set({
                draftData: {
                  title: 'Bron',
                  slug: `source-midway`,
                  body: body('Inleiding', {
                    text: 'Lees',
                    link: { entryId: target.id, collection: 'articles' },
                  }),
                },
              })
              .where(eq(entry.id, source.id))
            // The rewrite deletes the old rows, then fails inserting the new ones.
            const failingInserts = new Proxy(tx, {
              get(connection, property, receiver) {
                if (property === 'insert') {
                  return () => {
                    throw new Error('insert failed')
                  }
                }
                const value = Reflect.get(
                  connection,
                  property,
                  receiver,
                ) as unknown
                return typeof value === 'function'
                  ? (value as (...args: unknown[]) => unknown).bind(connection)
                  : value
              },
            })
            await syncEntryLinkIndex(failingInserts, source.id)
          }),
        ).rejects.toThrow('insert failed')

        expect(await linkRows(source.id)).toEqual(before)
      } finally {
        await cleanupTestSite(ctx)
      }
    })

    it('a rebuild waits for an open save and then indexes what the save committed', async () => {
      const { ctx, target, other, source } = await setup('rebuild-wait')
      try {
        let markStarted!: () => void
        const started = new Promise<void>((resolve) => (markStarted = resolve))
        let release!: () => void
        const gate = new Promise<void>((resolve) => (release = resolve))

        // A save that changes the draft to link to `other`, and holds its lock.
        const save = db.transaction(async (tx) => {
          await tx
            .update(entry)
            .set({
              draftData: {
                title: 'Bron',
                slug: `source-rebuild-wait`,
                body: body('Inleiding', {
                  text: 'Lees',
                  link: { entryId: other.id, collection: 'articles' },
                }),
              },
            })
            .where(eq(entry.id, source.id))
          await syncEntryLinkIndex(tx, source.id)
          markStarted()
          await gate
        })
        await started

        let rebuilt = false
        const rebuild = db
          .transaction((tx) => rebuildEntryLinkIndex(tx, ctx.site.id))
          .then(() => {
            rebuilt = true
          })
        await sleep(300)
        expect(rebuilt).toBe(false)

        release()
        await save
        await rebuild

        const targets = (await linkRows(source.id)).map(
          (row) => row.targetEntryId,
        )
        expect(targets).toContain(other.id)
        expect(targets).toContain(target.id)
      } finally {
        await cleanupTestSite(ctx)
      }
    })
  },
)
