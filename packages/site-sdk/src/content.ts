import { resolve } from 'node:path'
import { camelizeData, camelizeEntry, toCamelKey } from './camel-case.js'
import { createArecaClient, type ArecaClient } from './client.js'
import { isReservedCollectionKey } from './identifiers.js'
import { getPreviewEntry } from './preview.js'
import { readContent, readContentManifest, readGlobalsFile } from './pull.js'
import type {
  CollectionKey,
  Content,
  ContentSchema,
  GlobalSchema,
  Globals,
  PreviewEntry,
} from './schema-types.js'
import type {
  Field,
  PreviewResult,
  PulledContentManifest,
  SnapshotEntry,
  SnapshotGlobal,
} from './types.js'
import { entryIssues } from './validate-snapshot.js'

/** What the generated schema says about one field, read without type parameters. */
type LooseField = {
  key: string
  type: string
  label?: string
  required?: boolean
  options?: readonly string[]
  collection?: string
}

/** What the generated schema says about one collection, read without type parameters. */
type LooseCollection = {
  key: string
  label?: string
  route: string
  fields: Record<string, LooseField>
}

/** What the generated `globalSchema` says about one site content section. */
type LooseGlobal = {
  key: string
  label?: string
  seo: boolean
  previewPath?: string
  fields: Record<string, LooseField>
}

type Row = SnapshotEntry
type Condition = Record<string, unknown>
type Criteria = Array<[string, 'asc' | 'desc']>

/** Cache slot for the site content of a generation. Collection keys never start with `_`. */
const GLOBALS_SLOT = '_globals'

/**
 * Typed content object bound to a pulled content directory (Node only).
 * `schema` and `globalSchema` come from the generated `areca.gen.ts`. Reads
 * happen per call, so a new `areca pull` is picked up without restarting the
 * process.
 */
export function createContent<
  const S extends ContentSchema,
  const G extends GlobalSchema = GlobalSchema,
>(options: {
  schema: S
  globalSchema?: G
  dir: string
}): Content<S, G> {
  const schema = options.schema as unknown as Record<string, LooseCollection>
  const globalSchema = (options.globalSchema ?? {}) as unknown as Record<string, LooseGlobal>
  for (const name of Object.keys(schema)) {
    if (isReservedCollectionKey(name)) {
      throw new Error(
        `Collection "${name}" uses a reserved name (resolve, href, preview, globals)`,
      )
    }
  }

  // Parsed files for one generation. A new generation drops them all.
  let cachedGeneration: string | undefined
  let cache = new Map<string, unknown>()

  /** The cache for the generation of `manifest`; a new generation starts empty. */
  function cacheFor(manifest: PulledContentManifest): Map<string, unknown> {
    const generation = manifest.generation ?? ''
    if (generation !== cachedGeneration) {
      cache = new Map()
      cachedGeneration = generation
    }
    return cache
  }

  function rows(collection: string): Row[] {
    const dir = resolve(options.dir)
    const manifest = readManifest(dir)
    if (!Object.hasOwn(manifest.collections, collection)) return []
    const memo = cacheFor(manifest)
    let entries = memo.get(collection) as Row[] | undefined
    if (entries === undefined) {
      // The collection is in the schema, so it is a registered key.
      entries = readContent(dir, collection as CollectionKey, manifest) as unknown as Row[]
      memo.set(collection, entries)
    }
    return entries
  }

  /** The published site content of the current generation, keyed by raw key. */
  function globalRecords(): Record<string, SnapshotGlobal> {
    const dir = resolve(options.dir)
    const manifest = readManifest(dir)
    const memo = cacheFor(manifest)
    let records = memo.get(GLOBALS_SLOT) as Record<string, SnapshotGlobal> | undefined
    if (records === undefined) {
      records = readGlobalsFile(dir, manifest)
      memo.set(GLOBALS_SLOT, records)
    }
    return records
  }

  /** One section as the SDK returns it: its field values, plus `$seo` when SEO is on. */
  function globalValue(definition: LooseGlobal, record: SnapshotGlobal): Record<string, unknown> {
    return definition.seo ? { ...record.data, $seo: record.seo } : { ...record.data }
  }

  function publishedGlobals(): Record<string, Record<string, unknown>> {
    const values: Record<string, Record<string, unknown>> = {}
    for (const [camel, record] of Object.entries(globalRecords())) {
      values[camel] = globalValue(globalSchema[camel] ?? { key: '', seo: false, fields: {} }, record)
    }
    return values
  }

  function findById(collection: string, id: string): Row | null {
    if (!Object.hasOwn(schema, collection)) return null
    return rows(collection).find((row) => row.id === id) ?? null
  }

  function resolveRef(ref: unknown): Row | null {
    if (!isReferenceLike(ref)) return null
    return findById(ref.collection, ref.id)
  }

  function hrefFor(collection: string, slug: string): string {
    const definition = schema[collection]
    if (!definition) throw new Error(`Unknown collection "${collection}"`)
    return definition.route.split('$slug').join(encodeURIComponent(slug))
  }

  function query(collection: string, options: QueryOptions): Row[] {
    const definition = schema[collection]!
    let result = rows(collection).filter((row) =>
      matchesWhere(row.data, options.where, definition),
    )
    if (options.orderBy !== undefined) {
      const criteria = sortCriteria(options.orderBy)
      result.sort((a, b) => compareRows(a, b, criteria, definition))
    }
    const offset = options.offset ?? 0
    result = result.slice(
      offset,
      options.limit === undefined ? undefined : offset + options.limit,
    )
    if (options.with !== undefined) {
      const expand = Object.keys(options.with).filter((field) => options.with![field])
      result = result.map((row) => expandRow(row, expand))
    }
    return result
  }

  /** Copies the row, so cached data is never changed. */
  function expandRow(row: Row, fields: string[]): Row {
    const data: Record<string, unknown> = { ...row.data }
    for (const field of fields) {
      const value = row.data[field]
      if (value === undefined) continue
      data[field] = resolveRef(value)
    }
    return { ...row, data }
  }

  function collectionApi(collection: string) {
    return {
      all: (options?: QueryOptions) => query(collection, options ?? {}),
      first: (options?: QueryOptions) => query(collection, options ?? {})[0],
      get: (slug: string) => rows(collection).find((row) => row.slug === slug),
      byId: (id: string) => rows(collection).find((row) => row.id === id),
      href: (entryOrSlug: Row | string) =>
        hrefFor(collection, typeof entryOrSlug === 'string' ? entryOrSlug : entryOrSlug.slug),
    }
  }

  async function preview(
    token: string,
    previewOptions?: { client?: ArecaClient },
  ): Promise<PreviewEntry<S>> {
    const client = previewOptions?.client ?? createArecaClient()
    const result = await getPreviewEntry({ token, client })
    if (result.kind === 'global') {
      throw new Error(
        `Preview token is for site content "${result.global}". Use previewGlobals() for it.`,
      )
    }
    const collection = Object.keys(schema).find(
      (name) => schema[name]!.key === result.collection,
    )
    if (collection === undefined) {
      throw new Error(
        `Preview collection "${result.collection}" is not in the generated schema. Run \`areca pull\` to refresh the types.`,
      )
    }
    const definition = schema[collection]!
    const camelByRaw = new Map(
      Object.entries(definition.fields).map(([camel, field]) => [field.key, camel]),
    )
    // Validate the raw draft, as the pull validates a publication, before camelising it.
    const issues = entryIssues(result.entry.data, wireFields(schema, definition)).map(
      (issue) => `${camelByRaw.get(issue.field) ?? toCamelKey(issue.field)}: ${issue.problem}`,
    )
    const fields = Object.entries(definition.fields).map(([camel, field]) => ({
      raw: field.key,
      camel,
      type: field.type,
    }))
    const entry = camelizeEntry(result.entry, collection, fields)
    if (issues.length === 0) {
      return {
        collection,
        slug: result.slug,
        complete: true,
        issues: [],
        entry,
      } as unknown as PreviewEntry<S>
    }
    return {
      collection,
      slug: result.slug,
      complete: false,
      issues,
      entry,
    } as unknown as PreviewEntry<S>
  }

  async function previewGlobals(
    source: string | PreviewResult | null | undefined,
    previewOptions?: { client?: ArecaClient },
  ): Promise<Globals<G>> {
    const published = publishedGlobals()
    if (!source) return published as unknown as Globals<G>
    // A PreviewResult from getPreviewEntry / client.fetchPreview is used as is, so the CMS is asked once.
    const result =
      typeof source === 'string'
        ? await getPreviewEntry({
            token: source,
            client: previewOptions?.client ?? createArecaClient(),
          })
        : source
    if (result.kind !== 'global') return published as unknown as Globals<G>
    const camel = Object.keys(globalSchema).find(
      (name) => globalSchema[name]!.key === result.global,
    )
    if (camel === undefined) {
      throw new Error(
        `Preview section "${result.global}" is not in the generated schema. Run \`areca pull\` to refresh the types.`,
      )
    }
    const definition = globalSchema[camel]!
    const fields = Object.entries(definition.fields).map(([name, field]) => ({
      raw: field.key,
      camel: name,
      type: field.type,
    }))
    const draft: SnapshotGlobal = {
      ...result.entry,
      data: camelizeData(result.entry.data, fields),
    }
    return {
      ...published,
      [camel]: globalValue(definition, draft),
    } as unknown as Globals<G>
  }

  const content: Record<string, unknown> = {
    resolve: resolveRef,
    href: (ref: { collection: string; slug: string }) => hrefFor(ref.collection, ref.slug),
    preview,
    previewGlobals,
    get globals() {
      return publishedGlobals()
    },
  }
  for (const collection of Object.keys(schema)) {
    content[collection] = collectionApi(collection)
  }
  return content as unknown as Content<S, G>
}

type QueryOptions = {
  where?: Condition
  orderBy?: Record<string, 'asc' | 'desc' | undefined> | Array<Record<string, 'asc' | 'desc' | undefined>>
  limit?: number
  offset?: number
  with?: Record<string, boolean | undefined>
}

/**
 * The raw field list of one generated collection, as the pull validates it:
 * raw keys, and reference targets mapped back from camel to the raw key.
 */
function wireFields(schema: Record<string, LooseCollection>, definition: LooseCollection): Field[] {
  return Object.values(definition.fields).map((field) => {
    const target =
      field.collection === undefined
        ? undefined
        : (schema[field.collection]?.key ?? field.collection)
    return {
      key: field.key,
      label: field.label ?? field.key,
      type: field.type,
      required: field.required,
      options: field.options,
      collection: target,
    } as Field
  })
}

function readManifest(dir: string): PulledContentManifest {
  try {
    return readContentManifest(dir)
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`No content in ${dir}. Run \`areca pull\` first.`)
    }
    throw error
  }
}

function isReferenceLike(value: unknown): value is { collection: string; id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { collection?: unknown }).collection === 'string' &&
    typeof (value as { id?: unknown }).id === 'string'
  )
}

/** Null, empty string and missing all count as empty. */
function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function matchesWhere(
  data: Record<string, unknown>,
  where: Condition | undefined,
  definition: LooseCollection,
): boolean {
  if (where === undefined) return true
  return Object.entries(where).every(([field, condition]) => {
    if (condition === undefined) return true
    return matchesCondition(data[field], condition, definition.fields[field]?.type)
  })
}

function matchesCondition(value: unknown, condition: unknown, type: string | undefined): boolean {
  if (!isOperatorObject(condition)) return equal(value, condition, type)
  return Object.entries(condition).every(([operator, argument]) => {
    if (argument === undefined) return true
    switch (operator) {
      case 'eq':
        return equal(value, argument, type)
      case 'ne':
        return !equal(value, argument, type)
      case 'in':
        return Array.isArray(argument) && argument.some((item) => equal(value, item, type))
      case 'notIn':
        return !Array.isArray(argument) || !argument.some((item) => equal(value, item, type))
      case 'gt':
        return !isEmpty(value) && compareValues(value, argument, type) > 0
      case 'gte':
        return !isEmpty(value) && compareValues(value, argument, type) >= 0
      case 'lt':
        return !isEmpty(value) && compareValues(value, argument, type) < 0
      case 'lte':
        return !isEmpty(value) && compareValues(value, argument, type) <= 0
      case 'contains':
        return (
          typeof value === 'string' &&
          value.toLowerCase().includes(String(argument).toLowerCase())
        )
      case 'isNull':
        return isEmpty(value) === Boolean(argument)
      default:
        throw new Error(`Unknown where operator "${operator}"`)
    }
  })
}

function isOperatorObject(value: unknown): value is Condition {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Datetimes compare as instants, so offsets do not matter. */
function equal(value: unknown, target: unknown, type: string | undefined): boolean {
  if (type === 'datetime' && typeof value === 'string' && typeof target === 'string') {
    return Date.parse(value) === Date.parse(target)
  }
  return value === target
}

/** Negative, zero or positive; NaN when the values cannot be compared. */
function compareValues(a: unknown, b: unknown, type: string | undefined): number {
  if (type === 'number' || typeof a === 'number') return Number(a) - Number(b)
  if (type === 'boolean' || typeof a === 'boolean') return Number(a) - Number(b)
  if (type === 'datetime') return Date.parse(String(a)) - Date.parse(String(b))
  if (typeof a === 'string' && typeof b === 'string') {
    if (type === 'date') return a < b ? -1 : a > b ? 1 : 0
    const lowerA = a.toLowerCase()
    const lowerB = b.toLowerCase()
    if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1
    return a < b ? -1 : a > b ? 1 : 0
  }
  return Number.NaN
}

function sortCriteria(orderBy: NonNullable<QueryOptions['orderBy']>): Criteria {
  const list = Array.isArray(orderBy) ? orderBy : [orderBy]
  return list.flatMap((item) =>
    Object.entries(item).flatMap(([field, direction]): Criteria =>
      direction === undefined ? [] : [[field, direction]],
    ),
  )
}

/** Empty values sort last in both directions; ties keep the pulled order. */
function compareRows(a: Row, b: Row, criteria: Criteria, definition: LooseCollection): number {
  for (const [field, direction] of criteria) {
    const left = a.data[field]
    const right = b.data[field]
    const leftEmpty = isEmpty(left)
    const rightEmpty = isEmpty(right)
    if (leftEmpty || rightEmpty) {
      if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1
      continue
    }
    const result = compareValues(left, right, definition.fields[field]?.type)
    if (Number.isNaN(result) || result === 0) continue
    return direction === 'desc' ? -result : result
  }
  return 0
}
