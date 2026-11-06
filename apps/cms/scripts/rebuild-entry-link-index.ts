/**
 * Rebuilds the entry link index (rich text links between entries) for every
 * site, or for one site with `--site <id>`. The index follows content writes
 * on its own. Run this after a change that moves rich text between language
 * slots or changes a collection's fields outside the normal save paths, and
 * once after the `entry_link` migration on a database that already has
 * content. Idempotent.
 *
 *   pnpm tsx --env-file=.env.local --import ./scripts/lib/script-runtime.mjs scripts/rebuild-entry-link-index.ts
 *   pnpm tsx --env-file=.env.local --import ./scripts/lib/script-runtime.mjs scripts/rebuild-entry-link-index.ts --site <siteId>
 */
import { eq } from 'drizzle-orm'

import { db, pool } from '#/db'
import { site } from '#/db/schema'
import { rebuildEntryLinkIndex } from '#/server/content/entry-link-index'

async function main() {
  const flagIndex = process.argv.indexOf('--site')
  const onlySite =
    flagIndex === -1 ? null : (process.argv[flagIndex + 1] ?? null)
  const sites = onlySite
    ? await db
        .select({ id: site.id, slug: site.slug })
        .from(site)
        .where(eq(site.id, onlySite))
    : await db.select({ id: site.id, slug: site.slug }).from(site)
  if (onlySite && sites.length === 0) {
    throw new Error(`No site with id ${onlySite}`)
  }
  for (const row of sites) {
    const written = await db.transaction((tx) =>
      rebuildEntryLinkIndex(tx, row.id),
    )
    console.log(`${row.slug}: ${written} entry link rows`)
  }
  await pool.end()
}

main().catch(async (error: unknown) => {
  console.error(error)
  await pool.end()
  process.exitCode = 1
})
