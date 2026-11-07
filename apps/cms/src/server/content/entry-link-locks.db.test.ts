import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entryLink } from '#/db/schema'

import { syncManifest } from './collections.ts'
import { createEntry, getEntry, updateDraft } from './entries.ts'
import {
  articleFields,
  createTestCollection,
  withTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

/**
 * Entries whose link-index inserts pause. The trigger reads this table, so the
 * pause reaches saves that run in their own transactions (`updateDraft`,
 * `syncManifest`), which a test cannot tag with a session setting.
 */
const PAUSE_TABLE = 'areca_test_pause_entry'
const PAUSE_TRIGGER = 'areca_test_pause_link_insert'
const PAUSE_SECONDS = 2

/**
 * Keeps the failure fast if a lock cycle ever forms: a waiter that is not
 * resolved by deadlock detection gives up after `lock_timeout`. It is set in
 * the trigger because the write functions open their own transactions.
 */
const LOCK_TIMEOUT = '5s'

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

/** Installs the pause trigger (once per test run) and clears earlier pauses. */
async function installPauseTrigger() {
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS ${PAUSE_TABLE} (
      entry_id text PRIMARY KEY
    )`),
  )
  await db.execute(sql.raw(`DELETE FROM ${PAUSE_TABLE}`))
  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION ${PAUSE_TRIGGER}() RETURNS trigger AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM ${PAUSE_TABLE} p WHERE p.entry_id = NEW.source_entry_id) THEN
        PERFORM set_config('lock_timeout', '${LOCK_TIMEOUT}', true);
        PERFORM pg_sleep(${PAUSE_SECONDS});
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

/** Pauses the link-index inserts of these entries. */
async function pauseInsertsOf(entryIds: string[]) {
  for (const id of entryIds) {
    await db.execute(
      sql`INSERT INTO areca_test_pause_entry (entry_id) VALUES (${id}) ON CONFLICT DO NOTHING`,
    )
  }
}

async function clearPauses() {
  await db.execute(sql.raw(`DELETE FROM ${PAUSE_TABLE}`))
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

/** Waits until `count` link-index inserts are paused, so their entry rows are locked. */
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

const LANGUAGE_MANIFEST = {
  languages: { main: 'en', all: ['en', 'nl'] },
  collections: {
    articles: { route: '/blog/$slug', fields: articleFields() },
  },
}

describe.skipIf(!hasDb)('entry link index: locks do not deadlock', () => {
  beforeEach(async () => {
    await installPauseTrigger()
  })

  it('lets two saves that link to each other and both change their slug finish', async () => {
    await withTestSite(async (ctx) => {
      const { a, b } = await seed(ctx)
      // Both saves hold their own entry row (a slug change takes FOR UPDATE on
      // it) before either inserts its link, so each insert needs the row the
      // other save holds.
      await pauseInsertsOf([a, b])
      const versionA = (await getEntry(a))!.draftVersion
      const versionB = (await getEntry(b))!.draftVersion
      const results = await Promise.allSettled([
        updateDraft(
          a,
          { title: 'Alpha two', slug: 'alpha-two', body: bodyOf('Lees', b) },
          ctx.actor.id,
          versionA,
        ),
        updateDraft(
          b,
          { title: 'Beta two', slug: 'beta-two', body: bodyOf('Lees', a) },
          ctx.actor.id,
          versionB,
        ),
      ])
      await clearPauses()
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [errorText(result.reason)] : [],
      )
      expect(failures).toEqual([])
      expect(await linkTargets(a)).toEqual([b])
      expect(await linkTargets(b)).toEqual([a])
    })
  }, 30_000)

  it('lets a language change and a save that links to another entry both finish', async () => {
    await withTestSite(async (ctx) => {
      const { a, b } = await seed(ctx)
      // The save holds its entry row and pauses at its link insert. The
      // manifest push then takes the site row and reaches the same entry row
      // in its index rebuild. The save's insert needs KEY SHARE on the site
      // row for its foreign key, which the manifest push's lock blocks.
      await pauseInsertsOf([a])
      const versionA = (await getEntry(a))!.draftVersion
      const save = updateDraft(
        a,
        { title: 'Alpha', slug: 'alpha', body: bodyOf('Lees', b) },
        ctx.actor.id,
        versionA,
      )
      await waitForPausedInserts(1)
      // Only the save's own insert pauses, so the manifest's rebuild runs freely.
      await clearPauses()
      const language = syncManifest(ctx.site.id, LANGUAGE_MANIFEST)
      const [saved, changed] = await Promise.allSettled([save, language])
      expect(
        [saved, changed].flatMap((result) =>
          result.status === 'rejected' ? [errorText(result.reason)] : [],
        ),
      ).toEqual([])
      expect(await linkTargets(a)).toEqual([b])
    })
  }, 30_000)
})
