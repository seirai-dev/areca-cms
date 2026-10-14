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
  }[],
): SnapshotSchema {
  const schema: SnapshotSchema = {}
  for (const col of collections) {
    schema[col.key] = {
      route: col.routePattern,
      label: col.label,
      fields: structuredClone(col.fields),
    }
  }
  return schema
}
