import { eq, getTableColumns } from 'drizzle-orm'

import { db } from '#/db'
import type { DbReader } from '#/db'
import { site } from '#/db/schema'
import { m } from '#/paraglide/messages'

import { NotFoundError } from './errors.ts'

const {
  lastManifest: _lastManifest,
  schemaBaseline: _schemaBaseline,
  ...siteCoreColumns
} = getTableColumns(site)

/**
 * The site columns guards and content paths read: all but the synced manifest
 * and the dev-env schema baseline, the two large documents. Those are read
 * only where they are used (manifest sync, site settings, dev env).
 */
export { siteCoreColumns }

export type SiteCore = Omit<
  typeof site.$inferSelect,
  'lastManifest' | 'schemaBaseline'
>

/** A site's core columns, or undefined when there is no such site. */
export async function findSite(
  siteId: string,
  connection: DbReader = db,
): Promise<SiteCore | undefined> {
  return (
    await connection
      .select(siteCoreColumns)
      .from(site)
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
}

/** A site's core columns; NotFoundError when there is no such site. */
export async function getSiteOrThrow(
  siteId: string,
  connection: DbReader = db,
): Promise<SiteCore> {
  const row = await findSite(siteId, connection)
  if (!row) throw new NotFoundError(m.server_site_not_found())
  return row
}
