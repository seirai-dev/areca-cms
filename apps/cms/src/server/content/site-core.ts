import { getTableColumns } from 'drizzle-orm'

import { site } from '#/db/schema'

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
