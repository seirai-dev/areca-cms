import { resolve } from 'node:path'
import { camelizeData, camelizeEntry, toCamelKey } from './camel-case.js'
import { createArecaClient, type ArecaClient } from './client.js'
import { defaultLocalizePath, localizeEntryLinks, type LocalizePath } from './entry-links.js'
import { isReservedCollectionKey } from './identifiers.js'
import { chooseLocale, matchLocale } from './locale.js'
import { getPreviewEntry } from './preview.js'
import { readContent, readContentManifest, readGlobalsFile } from './pull.js'
import type {
  CollectionKey,
  Content,
  ContentSchema,
  GlobalSchema,
  GlobalKey,
  Globals,
  GlobalsPreview,
  PreviewEntry,
} from './schema-types.js'
import type {
  Field,
  LocalizedValues,
  PreviewResult,
  PulledContentManifest,
  SiteLanguages,
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
  routes?: Readonly<Record<string, string>>
  requiredLanguages?: readonly string[]
  fields: Record<string, LooseField>
}

/** What the generated `globalSchema` says about one site content section. */
type LooseGlobal = {
  key: string
  label?: string
  seo: boolean
  previewPath?: string
  requiredLanguages?: readonly string[]
  fields: Record<string, LooseField>
}

/** One language of an entry or section: its slug (collections only), data and SEO. */
type View = LocalizedValues

/** An entry as the content object serves it: one language, plus the language fields. */
type LocalRow = Omit<SnapshotEntry, 'locale' | 'locales' | 'collection'> & {
  collection: string
  locale: string
  isFallback: boolean
  locales: string[]
  alternates: Partial<Record<string, string>>
}

type Condition = Record<string, unknown>
type Criteria = Array<[string, 'asc' | 'desc']>

/** Per-read language options, as plain strings. The public `LocaleOptions` narrows `locale` to the registered languages. */
type ReadOptions = { locale?: string; fallback?: boolean }

/** Cache slot for the site content of a generation. Collection keys never start with `_`. */
const GLOBALS_SLOT = '_globals'

/** Language used when the site has none configured. Entries on such sites carry it. */
const NO_LANGUAGE = 'und'

/**
 * Typed content object bound to a pulled content directory (Node only).
 * `schema` and `globalSchema` come from the generated `areca.gen.ts`. Reads
 * happen per call, so a new `areca pull` is picked up without restarting the
 * process.
 *
 * `locale` is the language to read: a string, or a function called per read
 * (for example a Paraglide `getLocale`). Per call `{ locale }` and `content.in()`
 * override it. With no locale at all, the site's main language is read.
 */
export function createContent<
  const S extends ContentSchema,
  const G extends GlobalSchema = GlobalSchema,
>(options: {
  schema: S
  globalSchema?: G
  dir: string
  locale?: string | (() => string | undefined)
  /**
   * `i18n.localizePath` of the site config: the path an entry link goes to in
   * one language. Default: `defaultLocalizePath` of the main language. Drafts
   * from `preview` and `previewFrom` are localized with it, as `areca pull`
   * localizes published content.
   */
  localizePath?: LocalizePath | undefined
}): Content<S, G> {
  const schema = options.schema as unknown as Record<string, LooseCollection>
  const globalSchema = (options.globalSchema ?? {}) as unknown as Record<string, LooseGlobal>
  /** The entry link paths rule of a site with these languages. */
  function localizerFor(languages: SiteLanguages): LocalizePath {
    return options.localizePath ?? defaultLocalizePath(languages.main)
  }
  for (const name of Object.keys(schema)) {
    if (isReservedCollectionKey(name)) {
      throw new Error(
        `Collection "${name}" uses a reserved name (resolve, href, preview, globals, previewGlobals, previewFrom, in, languages, matchLocale)`,
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

  function rows(collection: string): SnapshotEntry[] {
    const dir = resolve(options.dir)
    const manifest = readManifest(dir)
    if (!Object.hasOwn(manifest.collections, collection)) return []
    const memo = cacheFor(manifest)
    let entries = memo.get(collection) as SnapshotEntry[] | undefined
    if (entries === undefined) {
      // The collection is in the schema, so it is a registered key.
      entries = readContent(dir, collection as CollectionKey, manifest) as unknown as SnapshotEntry[]
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

  /**
   * The site's languages from the current generation, or null on a single-language
   * site. Before the first pull there are none, so previews still work.
   */
  function languagesOf(): SiteLanguages | null {
    try {
      return readManifest(resolve(options.dir)).languages ?? null
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('No content in')) return null
      throw error
    }
  }

  /** The language set by the resolver function or string, if any. */
  function resolverLocale(): string | undefined {
    const value = typeof options.locale === 'function' ? options.locale() : options.locale
    return value || undefined
  }

  /** The language a read asks for: per call, then the scope, then the resolver. Undefined when none is set. */
  function activeLocale(scope: string | undefined, perCall: string | undefined): string | undefined {
    return perCall ?? scope ?? resolverLocale()
  }

  /** The language a read serves: the active one, or the main language. */
  function requestedLocale(scope: string | undefined, perCall: string | undefined): string | undefined {
    return activeLocale(scope, perCall) ?? languagesOf()?.main
  }

  /** The route pattern for one language: `routes[locale]`, else `route`. Keys match case-insensitively. */
  function routeFor(definition: LooseCollection, locale: string | undefined): string {
    if (locale === undefined || definition.routes === undefined) return definition.route
    if (definition.routes[locale] !== undefined) return definition.routes[locale]!
    const key = Object.keys(definition.routes).find(
      (candidate) => candidate.toLowerCase() === locale.toLowerCase(),
    )
    return key === undefined ? definition.route : definition.routes[key]!
  }

  function pathFor(pattern: string, slug: string): string {
    return pattern.split('$slug').join(encodeURIComponent(slug))
  }

  function hrefFor(collection: string, slug: string, locale: string | undefined): string {
    const definition = schema[collection]
    if (!definition) throw new Error(`Unknown collection "${collection}"`)
    return pathFor(routeFor(definition, locale), slug)
  }

  /**
   * Picks the view an entry or section is served in. `available` is the set of
   * complete languages. Without any, the stored base values are served. With
   * `fallback` false, a request the chain cannot match exactly excludes it.
   */
  function pickView(
    base: string,
    baseView: View,
    views: Record<string, View>,
    requested: string | undefined,
    fallback: boolean,
    languages: SiteLanguages | null,
  ): { locale: string; isFallback: boolean; view: View; available: string[] } | undefined {
    const available = Object.keys(views)
    if (available.length === 0) {
      if (!fallback && requested !== undefined) return undefined
      return { locale: base, isFallback: requested !== undefined, view: baseView, available }
    }
    const chosen = chooseLocale(available, requested, languages)!
    if (!fallback && requested !== undefined && !chosen.exact) return undefined
    return {
      locale: chosen.locale,
      isFallback: requested !== undefined && !chosen.exact,
      view: views[chosen.locale]!,
      available,
    }
  }

  /** Views of one stored record: its complete languages, or its base values on a site without translations. */
  function viewsOf(
    base: string,
    baseView: View,
    locales: Record<string, View> | undefined,
    languages: SiteLanguages | null,
  ): Record<string, View> {
    if (locales !== undefined) return { ...locales }
    return languages ? { [base]: baseView } : {}
  }

  /**
   * One stored entry as the content object serves it: the view for `requested`
   * (through the fallback chain unless `fallback` is false), with the language
   * fields. Undefined when `fallback` is false and the language is missing.
   */
  function localizeRow(
    collection: string,
    row: SnapshotEntry,
    requested: string | undefined,
    fallback: boolean,
    languages: SiteLanguages | null,
  ): LocalRow | undefined {
    const definition = schema[collection]!
    const base = row.locale ?? languages?.main ?? NO_LANGUAGE
    const baseView: View = { slug: row.slug, data: row.data, seo: row.seo }
    const views = viewsOf(base, baseView, row.locales, languages)
    const picked = pickView(base, baseView, views, requested, fallback, languages)
    if (picked === undefined) return undefined
    const alternates: Partial<Record<string, string>> = {}
    for (const tag of picked.available) {
      alternates[tag] = pathFor(routeFor(definition, tag), views[tag]!.slug ?? row.slug)
    }
    return {
      id: row.id,
      slug: picked.view.slug ?? row.slug,
      publishedAt: row.publishedAt,
      collection,
      data: picked.view.data,
      ...(picked.view.seo !== undefined ? { seo: picked.view.seo } : {}),
      locale: picked.locale,
      isFallback: picked.isFallback,
      locales: picked.available,
      alternates,
    }
  }

  /** Every entry of a collection in one language, in pulled order. Excluded entries are left out. */
  function localizedRows(collection: string, options: ReadOptions | undefined): LocalRow[] {
    const languages = languagesOf()
    const requested = requestedLocale(undefined, options?.locale)
    const fallback = options?.fallback !== false
    const result: LocalRow[] = []
    for (const row of rows(collection)) {
      const localized = localizeRow(collection, row, requested, fallback, languages)
      if (localized !== undefined) result.push(localized)
    }
    return result
  }

  /** One section as the SDK returns it: its field values, plus `$seo` when SEO is on, and the language meta. */
  function sectionValue(
    definition: LooseGlobal,
    view: View,
    locale: string,
    isFallback: boolean,
  ): Record<string, unknown> {
    const value: Record<string, unknown> = definition.seo
      ? { ...view.data, $seo: view.seo }
      : { ...view.data }
    value.$locale = locale
    value.$isFallback = isFallback
    return value
  }

  /** Every published section in one language. Sections always fall back: they have no `fallback` option. */
  function publishedGlobals(requested: string | undefined): Record<string, Record<string, unknown>> {
    const languages = languagesOf()
    const values: Record<string, Record<string, unknown>> = {}
    for (const [camel, record] of Object.entries(globalRecords())) {
      const definition = globalSchema[camel] ?? { key: '', seo: false, fields: {} }
      const base = record.locale ?? languages?.main ?? NO_LANGUAGE
      const baseView: View = { data: record.data, seo: record.seo }
      const views = viewsOf(base, baseView, record.locales, languages)
      const picked = pickView(base, baseView, views, requested, true, languages)!
      values[camel] = sectionValue(definition, picked.view, picked.locale, picked.isFallback)
    }
    return values
  }

  function findById(collection: string, id: string, options: ReadOptions | undefined): LocalRow | null {
    if (!Object.hasOwn(schema, collection)) return null
    return localizedRows(collection, options).find((row) => row.id === id) ?? null
  }

  function resolveRef(ref: unknown, options: ReadOptions | undefined): LocalRow | null {
    if (!isReferenceLike(ref)) return null
    return findById(ref.collection, ref.id, options)
  }

  function query(collection: string, options: QueryOptions & ReadOptions): LocalRow[] {
    const definition = schema[collection]!
    let result = localizedRows(collection, options).filter((row) =>
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
      // References expand in the same language as the entries.
      const readAs: ReadOptions = { locale: requestedLocale(undefined, options.locale), fallback: options.fallback }
      const expand = Object.keys(options.with).filter((field) => options.with![field])
      result = result.map((row) => expandRow(row, expand, readAs))
    }
    return result
  }

  /** Copies the row, so cached data is never changed. */
  function expandRow(row: LocalRow, fields: string[], readAs: ReadOptions): LocalRow {
    const data: Record<string, unknown> = { ...row.data }
    for (const field of fields) {
      const value = row.data[field]
      if (value === undefined) continue
      data[field] = resolveRef(value, readAs)
    }
    return { ...row, data }
  }

  /**
   * The entry whose slug in the requested language is `slug`. With fallback on,
   * an entry whose main-language slug is `slug` also matches.
   */
  function getBySlug(collection: string, slug: string, options: ReadOptions | undefined): LocalRow | undefined {
    const languages = languagesOf()
    const requested = requestedLocale(undefined, options?.locale)
    const fallback = options?.fallback !== false
    const served = localizedRows(collection, options)
    const own = served.find((row) => row.slug === slug)
    if (own !== undefined || !fallback) return own
    const mainTag = languages?.main
    for (const row of rows(collection)) {
      const mainSlug = (mainTag !== undefined ? row.locales?.[mainTag]?.slug : undefined) ?? row.slug
      if (mainSlug !== slug) continue
      const localized = localizeRow(collection, row, requested, true, languages)
      if (localized !== undefined) return localized
    }
    return undefined
  }

  /** The collection methods of one scope. A per-call locale still wins over the scope. */
  function collectionApi(collection: string, scope: string | undefined) {
    const at = <O extends ReadOptions | undefined>(options: O): ReadOptions => ({
      ...options,
      locale: options?.locale ?? scope,
    })
    return {
      all: (options?: QueryOptions & ReadOptions) => query(collection, { ...options, ...at(options) }),
      first: (options?: QueryOptions & ReadOptions) =>
        query(collection, { ...options, ...at(options) })[0],
      get: (slug: string, options?: ReadOptions) => getBySlug(collection, slug, at(options)),
      byId: (id: string, options?: ReadOptions) =>
        localizedRows(collection, at(options)).find((row) => row.id === id),
      href: (entryOrSlug: LocalRow | string) =>
        typeof entryOrSlug === 'string'
          ? hrefFor(collection, entryOrSlug, requestedLocale(scope, undefined))
          : hrefFor(collection, entryOrSlug.slug, entryOrSlug.locale),
    }
  }

  /** The content object for one language scope. `in()` returns a new one. */
  function buildContent(scope: string | undefined): Content<S, G> {
    async function preview(
      token: string,
      previewOptions?: { client?: ArecaClient; locale?: string },
    ): Promise<PreviewEntry<S>> {
      const client = previewOptions?.client ?? createArecaClient()
      const explicit = activeLocale(scope, previewOptions?.locale)
      const result = await getPreviewEntry({
        token,
        client,
        ...(explicit !== undefined ? { locale: explicit } : {}),
      })
      return previewFrom(result, previewOptions)
    }

    /** Validates and camelises a preview result the CMS already returned, without a request. */
    function previewFrom(
      result: PreviewResult,
      previewOptions?: { locale?: string },
    ): PreviewEntry<S> {
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
      const camelized = camelizeEntry(result.entry, collection, fields)
      // The draft is served in the language asked for: per call, then the scope, then the
      // language the CMS says the draft is in, then the resolver or the main language.
      const languages = languagesOf()
      // Entry links get the path of their language, as pull gives them (see `localizePath`).
      const linked =
        languages === null
          ? camelized
          : localizeEntryLinks(camelized, languages, localizerFor(languages))
      const draftLocale =
        languages !== null && typeof result.entry.locale === 'string' && result.entry.locale !== ''
          ? result.entry.locale
          : undefined
      const requested =
        previewOptions?.locale ?? scope ?? draftLocale ?? requestedLocale(undefined, undefined)
      const entry = localizeRow(collection, linked, requested, true, languages)!
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
      previewOptions?: { client?: ArecaClient; locale?: string },
    ): Promise<GlobalsPreview<G>> {
      const requested = requestedLocale(scope, previewOptions?.locale)
      const published = publishedGlobals(requested) as unknown as Globals<G>
      const unchanged: GlobalsPreview<G> = {
        globals: published,
        previewing: null,
        complete: true,
        issues: [],
      }
      if (!source) return unchanged
      // A PreviewResult from getPreviewEntry / client.fetchPreview is used as is, so the CMS is asked once.
      const explicit = activeLocale(scope, previewOptions?.locale)
      const result =
        typeof source === 'string'
          ? await getPreviewEntry({
              token: source,
              client: previewOptions?.client ?? createArecaClient(),
              ...(explicit !== undefined ? { locale: explicit } : {}),
            })
          : source
      if (result.kind !== 'global') return unchanged
      const camel = Object.keys(globalSchema).find(
        (name) => globalSchema[name]!.key === result.global,
      )
      if (camel === undefined) {
        throw new Error(
          `Preview section "${result.global}" is not in the generated schema. Run \`areca pull\` to refresh the types.`,
        )
      }
      const definition = globalSchema[camel]!
      const previewing = camel as GlobalKey<G>
      // Validate the raw draft, as the pull validates a publication, before camelising it.
      const camelByRaw = new Map(
        Object.entries(definition.fields).map(([name, field]) => [field.key, name]),
      )
      const issues = entryIssues(result.entry.data, wireFields(schema, definition)).map(
        (issue) => `${camelByRaw.get(issue.field) ?? toCamelKey(issue.field)}: ${issue.problem}`,
      )
      if (issues.length > 0) {
        // An incomplete draft never reaches typed code: the published section stays.
        return { globals: published, previewing, complete: false, issues }
      }
      const fields = Object.entries(definition.fields).map(([name, field]) => ({
        raw: field.key,
        camel: name,
        type: field.type,
      }))
      const draftData = camelizeData(result.entry.data, fields)
      const languages = languagesOf()
      // Entry links get the path of their language, as pull gives them (see `localizePath`).
      const linkedData =
        languages === null
          ? draftData
          : localizeEntryLinks(
              { data: draftData, locale: result.entry.locale ?? languages.main },
              languages,
              localizerFor(languages),
            ).data
      const draftLocale = result.entry.locale ?? requested ?? NO_LANGUAGE
      const values = {
        ...published,
        [camel]: sectionValue(definition, { data: linkedData, seo: result.entry.seo }, draftLocale, false),
      }
      return {
        globals: values as unknown as Globals<G>,
        previewing,
        complete: true,
        issues: [],
      }
    }

    const content: Record<string, unknown> = {
      resolve: (ref: unknown) => resolveRef(ref, { locale: requestedLocale(scope, undefined) }),
      href: (ref: { collection: string; slug: string; id?: string; locale?: string }) => {
        // An entry is served as it is. A reference is looked up by id first.
        if (typeof ref.locale === 'string') return hrefFor(ref.collection, ref.slug, ref.locale)
        const target = ref.id === undefined ? null : findById(ref.collection, ref.id, { locale: requestedLocale(scope, undefined) })
        return target !== null
          ? hrefFor(target.collection, target.slug, target.locale)
          : hrefFor(ref.collection, ref.slug, requestedLocale(scope, undefined))
      },
      preview,
      previewFrom,
      previewGlobals,
      in: (locale: string) => buildContent(locale),
      matchLocale: (input: string | readonly string[] | null | undefined) =>
        matchLocale(input, languagesOf()),
      get languages() {
        return languagesOf()
      },
      get globals() {
        return publishedGlobals(requestedLocale(scope, undefined))
      },
    }
    for (const collection of Object.keys(schema)) {
      content[collection] = collectionApi(collection, scope)
    }
    return content as unknown as Content<S, G>
  }

  return buildContent(undefined)
}

type QueryOptions = {
  where?: Condition
  orderBy?: Record<string, 'asc' | 'desc' | undefined> | Array<Record<string, 'asc' | 'desc' | undefined>>
  limit?: number
  offset?: number
  with?: Record<string, boolean | undefined>
}

/**
 * The raw field list of one generated collection or site content section, as the pull validates it:
 * raw keys, and reference targets mapped back from camel to the raw key.
 */
function wireFields(
  schema: Record<string, LooseCollection>,
  definition: Pick<LooseCollection, 'fields'>,
): Field[] {
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
function compareRows(a: LocalRow, b: LocalRow, criteria: Criteria, definition: LooseCollection): number {
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
