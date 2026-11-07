import { eq, sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry, entryLink } from '#/db/schema'
import { setSiteLanguages } from '#/server/admin/site-languages'
import { assetAttachLock } from '#/server/assets/usage'

import { createEntry } from './entries.ts'
import { syncEntryLinkIndex } from './entry-link-index.ts'
import { createTestCollection, withTestSite } from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

/**
 * The index write of a save pauses here, while the save holds its entry row
 * lock. The pause runs only in transactions that set `areca.test_pause`, so
 * other tests are not affected.
 */
const PAUSE_TRIGGER = 'areca_test_pause_link_insert'

function bodyOf(text: string, targetId?: string) {
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
                        href: '/blog/target',
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

async function seed(ctx: {
  org: { id: string }
  site: { id: string }
  actor: { id: string }
}) {
  await createTestCollection(ctx.site.id, {
    key: 'articles',
    routePattern: '/blog/$slug',
  })
  const make = async (slug: string) =>
    (
      await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: slug, slug, body: bodyOf('Kop') },
        actorId: ctx.actor.id,
      })
    ).id
  return { a: await make('alpha'), b: await make('beta') }
}

async function installPauseTrigger() {
  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION ${PAUSE_TRIGGER}() RETURNS trigger AS $$
    BEGIN
      IF current_setting('areca.test_pause', true) = 'on' THEN
        PERFORM pg_sleep(1.5);
      END IF;
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql
  `),
  )
  await db.execute(
    sql.raw(`DROP TRIGGER IF EXISTS ${PAUSE_TRIGGER} ON entry_link`),
  )
  await db.execute(
    sql.raw(
      `CREATE TRIGGER ${PAUSE_TRIGGER} BEFORE INSERT ON entry_link FOR EACH ROW EXECUTE FUNCTION ${PAUSE_TRIGGER}()`,
    ),
  )
}

async function dropPauseTrigger() {
  await db.execute(
    sql.raw(`DROP TRIGGER IF EXISTS ${PAUSE_TRIGGER} ON entry_link`),
  )
  await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${PAUSE_TRIGGER}()`))
}

/**
 * A save as the content writes run it: the entry row is updated, the asset
 * lock is taken, and the index rows follow in the same transaction. The
 * lock timeout turns a lock wait into an error instead of a hang.
 */
async function saveWithLink(
  organizationId: string,
  entryId: string,
  targetId: string,
) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '3s'`)
    await tx.execute(sql`SELECT set_config('areca.test_pause', 'on', true)`)
    await assetAttachLock(tx, organizationId)
    await tx
      .update(entry)
      .set({
        draftData: {
          title: 'Saved',
          slug: 'saved',
          body: bodyOf('Lees', targetId),
        },
        draftVersion: sql`${entry.draftVersion} + 1`,
        contentVersion: sql`${entry.contentVersion} + 1`,
      })
      .where(eq(entry.id, entryId))
    await syncEntryLinkIndex(tx, entryId)
  })
}

/** The driver's message, or the database error under it (a deadlock is 40P01). */
function errorText(error: unknown) {
  const cause = (error as { cause?: unknown }).cause
  return String(cause ?? error)
}

async function linkTargets(sourceEntryId: string) {
  const rows = await db
    .select({ targetEntryId: entryLink.targetEntryId })
    .from(entryLink)
    .where(eq(entryLink.sourceEntryId, sourceEntryId))
  return rows.map((row) => row.targetEntryId).sort()
}

/** Waits until `count` index inserts are paused, so their entry rows are locked. */
async function waitForPausedInserts(count: number) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const found = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event = 'PgSleep'
        and query ilike '%entry_link%'
    `)
    if (Number(found.rows[0].n) >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('no save reached its index insert')
}

describe.skipIf(!hasDb)('entry link index: locks do not deadlock', () => {
  afterEach(async () => {
    await dropPauseTrigger()
  })

  it('lets two saves that link to each other both finish', async () => {
    await withTestSite(async (ctx) => {
      const { a, b } = await seed(ctx)
      await installPauseTrigger()
      // Both saves hold their own entry row before either inserts its link,
      // so each insert needs the row the other save holds.
      const results = await Promise.allSettled([
        saveWithLink(ctx.org.id, a, b),
        saveWithLink(ctx.org.id, b, a),
      ])
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [errorText(result.reason)] : [],
      )
      expect(failures).toEqual([])
      expect(await linkTargets(a)).toEqual([b])
      expect(await linkTargets(b)).toEqual([a])
    })
  })

  it('lets a language change and a save that links to another entry both finish', async () => {
    await withTestSite(async (ctx) => {
      const { a, b } = await seed(ctx)
      await installPauseTrigger()
      // The save holds its entry row and pauses at its link insert. The
      // language change then takes the site row and waits for the entry row.
      // The save's insert needs the site row for its foreign key.
      const save = saveWithLink(ctx.org.id, a, b)
      await waitForPausedInserts(1)
      const language = setSiteLanguages(
        ctx.site.id,
        { main: 'en', all: ['en', 'nl'] },
        ctx.actor.id,
      )
      const [saved, changed] = await Promise.allSettled([save, language])
      expect(
        [saved, changed].flatMap((result) =>
          result.status === 'rejected' ? [errorText(result.reason)] : [],
        ),
      ).toEqual([])
      expect(await linkTargets(a)).toEqual([b])
    })
  })
})
