import {
  assertSafeIdentifier,
  assertUniqueCollectionIdentifiers,
  isReservedCollectionKey,
} from './identifiers.js'
import type {
  CollectionConfig,
  Field,
  GlobalConfig,
  LocalizedValues,
  Snapshot,
  SnapshotEntry,
  SnapshotGlobal,
} from './types.js'

/**
 * camelCase for CMS keys (spec section 2). `blog-posts` and `cover_image`
 * become `blogPosts` and `coverImage`; existing camel keys are unchanged.
 */
export function toCamelKey(raw: string): string {
  const [first = '', ...rest] = raw.split(/[-_]/).filter((part) => part.length > 0)
  return first + rest.map((part) => part[0]!.toUpperCase() + part.slice(1)).join('')
}

export type CamelField = {
  /** Raw CMS field key. */
  raw: string
  camel: string
  type: string
}

export type CamelCollection = {
  raw: string
  camel: string
  config: CollectionConfig
  fields: Array<CamelField & { field: Field }>
}

export type CamelGlobal = Omit<CamelCollection, 'config'> & { config: GlobalConfig }

/**
 * Camel names for every collection and field in a schema. Throws on
 * collisions (naming both raw keys), case-only collisions and reserved
 * collection names. Entries keep the schema's order.
 */
export function camelCollections(
  schema: Record<string, CollectionConfig>,
): CamelCollection[] {
  const camelByRaw = camelCollectionKeys(Object.keys(schema))
  return Object.entries(schema).map(([raw, config]) => ({
    raw,
    camel: camelByRaw.get(raw)!,
    config,
    fields: camelFields(raw, config.fields),
  }))
}

/** Camel names for every site content section and field. Same rules as collections. */
export function camelGlobals(
  schema: Record<string, GlobalConfig>,
): CamelGlobal[] {
  const camelByRaw = camelGlobalKeys(Object.keys(schema))
  return Object.entries(schema).map(([raw, config]) => ({
    raw,
    camel: camelByRaw.get(raw)!,
    config,
    fields: camelFields(raw, config.fields),
  }))
}

/** Camel name per raw collection key. Throws on collisions and reserved names. */
export function camelCollectionKeys(rawKeys: string[]): Map<string, string> {
  return camelKeys(rawKeys, 'Collection')
}

/** Camel name per raw site content key. Throws on collisions and reserved names. */
export function camelGlobalKeys(rawKeys: string[]): Map<string, string> {
  return camelKeys(rawKeys, 'Global')
}

function camelKeys(rawKeys: string[], noun: 'Collection' | 'Global'): Map<string, string> {
  const rawByCamel = new Map<string, string>()
  const camelByRaw = new Map<string, string>()
  for (const raw of rawKeys) {
    assertSafeIdentifier(raw)
    const camel = toCamelKey(raw)
    assertSafeIdentifier(camel)
    if (isReservedCollectionKey(camel)) {
      throw new Error(
        `${noun} "${raw}" uses the reserved name "${camel}". resolve, href, preview, globals, previewGlobals, in, languages and matchLocale are reserved.`,
      )
    }
    const previous = rawByCamel.get(camel)
    if (previous !== undefined) {
      throw new Error(
        `${noun} keys ${previous} and ${raw} both map to "${camel}". Rename one of them.`,
      )
    }
    rawByCamel.set(camel, raw)
    camelByRaw.set(raw, camel)
  }
  assertUniqueCollectionIdentifiers(camelByRaw.values(), noun)
  return camelByRaw
}

function camelFields(
  collection: string,
  fields: readonly Field[],
): CamelCollection['fields'] {
  const rawByCamel = new Map<string, string>()
  return fields.map((field) => {
    assertSafeIdentifier(field.key)
    const camel = toCamelKey(field.key)
    assertSafeIdentifier(camel)
    const previous = rawByCamel.get(camel)
    if (previous !== undefined) {
      throw new Error(
        `Field keys ${previous} and ${field.key} in ${collection} both map to "${camel}". Rename one of them.`,
      )
    }
    rawByCamel.set(camel, field.key)
    return { raw: field.key, camel, type: field.type, field }
  })
}

/**
 * Re-keys one entry: `data` keys and reference targets become camel, and
 * `collection` is set. Per-language values are re-keyed the same way. Other
 * fields are shared with the input, not copied.
 */
export function camelizeEntry(
  entry: SnapshotEntry,
  collection: string,
  fields: readonly CamelField[],
): SnapshotEntry {
  return {
    ...entry,
    collection,
    data: camelizeData(entry.data, fields),
    ...(entry.locales !== undefined ? { locales: camelizeLocales(entry.locales, fields) } : {}),
  }
}

/** Re-keys the `data` of every language; slugs and SEO are unchanged. */
export function camelizeLocales(
  locales: Record<string, LocalizedValues>,
  fields: readonly CamelField[],
): Record<string, LocalizedValues> {
  const result: Record<string, LocalizedValues> = {}
  for (const [tag, values] of Object.entries(locales)) {
    result[tag] = { ...values, data: camelizeData(values.data, fields) }
  }
  return result
}

/** Re-keys one `data` object: camel field keys, camel reference targets. */
export function camelizeData(
  source: Record<string, unknown>,
  fields: readonly CamelField[],
): Record<string, unknown> {
  const byRaw = new Map(fields.map((field) => [field.raw, field]))
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    const field = byRaw.get(key)
    data[field?.camel ?? toCamelKey(key)] =
      field?.type === 'reference' ? camelReference(value) : value
  }
  return data
}

function camelReference(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const reference = value as { collection?: unknown }
    if (typeof reference.collection === 'string') {
      return { ...value, collection: toCamelKey(reference.collection) }
    }
  }
  return value
}

/**
 * Rewrites a publication for the SDK: camel collection and data keys, a
 * `collection` tag on every entry, and camel site content keys. Returns a new
 * snapshot; the input is not changed. Every snapshot collection must be in
 * `schema`, and every global in `snapshot.globalSchema`.
 */
export function camelizeSnapshot(
  snapshot: Snapshot,
  schema: Record<string, CollectionConfig>,
): Snapshot {
  const plans = new Map(camelCollections(schema).map((plan) => [plan.raw, plan]))
  const collections: Record<string, SnapshotEntry[]> = {}
  for (const [raw, entries] of Object.entries(snapshot.collections)) {
    const plan = plans.get(raw)
    if (!plan) throw new Error(`Collection "${raw}" has no schema`)
    collections[plan.camel] = entries.map((entry) =>
      camelizeEntry(entry, plan.camel, plan.fields),
    )
  }
  if (snapshot.globals === undefined) return { ...snapshot, collections }
  return {
    ...snapshot,
    collections,
    globals: camelizeGlobals(snapshot.globals, snapshot.globalSchema ?? {}),
  }
}

function camelizeGlobals(
  globals: Record<string, SnapshotGlobal>,
  schema: Record<string, GlobalConfig>,
): Record<string, SnapshotGlobal> {
  const plans = new Map(camelGlobals(schema).map((plan) => [plan.raw, plan]))
  const result: Record<string, SnapshotGlobal> = {}
  for (const [raw, global] of Object.entries(globals)) {
    const plan = plans.get(raw)
    if (!plan) throw new Error(`Global "${raw}" has no schema`)
    result[plan.camel] = {
      ...global,
      data: camelizeData(global.data, plan.fields),
      ...(global.locales !== undefined
        ? { locales: camelizeLocales(global.locales, plan.fields) }
        : {}),
    }
  }
  return result
}
