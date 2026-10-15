import type { Field, SnapshotSchema } from '#/lib/types'

/**
 * Collection schema embedded in a publication, keyed by raw collection key.
 * Same shape and field list as `GET /api/sites/manifest`. Kept free of
 * database imports so it can be unit tested on its own.
 */
export function buildSnapshotSchema(
  collections: {
    key: string
    label: string
    routePattern: string
    fields: Field[]
    /** Per-language route patterns. Omitted when unset. */
    localizedRoutes?: Record<string, string> | null
    /** Languages besides main that must be complete. */
    requiredLanguages?: string[]
  }[],
): SnapshotSchema {
  const schema: SnapshotSchema = {}
  for (const col of collections) {
    const routes = col.localizedRoutes ?? {}
    schema[col.key] = {
      route: col.routePattern,
      label: col.label,
      fields: structuredClone(col.fields),
      ...(Object.keys(routes).length > 0 ? { routes: { ...routes } } : {}),
      ...(col.requiredLanguages && col.requiredLanguages.length > 0
        ? { requiredLanguages: [...col.requiredLanguages] }
        : {}),
    }
  }
  return schema
}
