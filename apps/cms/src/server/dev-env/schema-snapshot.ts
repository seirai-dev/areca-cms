import { asc, eq } from 'drizzle-orm'

import type { db } from '#/db'
import { collection, site } from '#/db/schema'
import type { SchemaSnapshot } from '#/lib/types'

/**
 * Schema and languages of a site, enabled and disabled collections and
 * sections alike, with every column a fork copies. Used for
 * `site.schema_baseline`, the push plan, and "schema matches" checks.
 */
export async function schemaSnapshot(
  connection: Pick<typeof db, 'select'>,
  siteId: string,
): Promise<SchemaSnapshot> {
  const siteRow = (
    await connection
      .select({ languages: site.languages })
      .from(site)
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
  const rows = await connection
    .select()
    .from(collection)
    .where(eq(collection.siteId, siteId))
    .orderBy(asc(collection.key))

  return {
    languages: siteRow?.languages ?? null,
    collections: rows.map((row) => ({
      key: row.key,
      label: row.label,
      routePattern: row.routePattern,
      fields: row.fields,
      enabled: row.enabled,
      kind: row.kind,
      seoEnabled: row.seoEnabled,
      previewPath: row.previewPath,
      requiredLanguages: row.requiredLanguages,
      localizedRoutes: row.localizedRoutes,
    })),
  }
}
