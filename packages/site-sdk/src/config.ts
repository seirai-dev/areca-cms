import { camelCollectionKeys, camelGlobalKeys } from './camel-case.js'
import { assertSafeIdentifier } from './identifiers.js'
import type {
  AssetsConfig,
  CollectionConfig,
  GlobalConfig,
  I18nConfig,
  SiteContentConfig,
  SiteLanguages,
  SiteManifest,
} from './types.js'

type SimpleFieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'image'
  | 'slug'
  | 'boolean'
  | 'number'
  | 'url'

type FieldAuthorBase = {
  key: string
  label: string
  required?: boolean
  description?: string
  /** Stored per language. Default: on for text, textarea, richtext and url; off for the rest. */
  translatable?: boolean
}

/** Keys of the date and datetime fields in a collection's `fields` tuple. */
type DateFieldKey<Owner> = Owner extends { fields: readonly (infer F)[] }
  ? F extends { type: 'date' | 'datetime'; key: infer K extends string }
    ? K
    : never
  : never

/** Site content fields may use `group`; collection fields may not. */
type GroupOption<IsGlobal extends boolean> = IsGlobal extends true
  ? { group?: string }
  : { group?: never }

/** Site content has no slug: its single entry is never addressed by one. */
type SimpleTypeFor<IsGlobal extends boolean> = IsGlobal extends true
  ? Exclude<SimpleFieldType, 'slug'>
  : SimpleFieldType

/**
 * One field as written in `defineSiteContent`, discriminated on `type`. The
 * keys a variant does not allow are `never`, so extra keys are rejected in
 * the constraint check (which has no excess-property check of its own).
 * `Owner` is the collection or global the field belongs to (for `after`).
 */
type FieldInput<CollectionKeys extends string, Owner, IsGlobal extends boolean> =
  | (FieldAuthorBase &
      GroupOption<IsGlobal> & {
        type: SimpleTypeFor<IsGlobal>
        options?: never
        collection?: never
        after?: never
      })
  | (FieldAuthorBase &
      GroupOption<IsGlobal> & {
        type: 'select'
        options?: readonly string[]
        collection?: never
        after?: never
      })
  | (FieldAuthorBase &
      GroupOption<IsGlobal> & {
        type: 'reference'
        collection: CollectionKeys
        options?: never
        after?: never
      })
  | (FieldAuthorBase &
      GroupOption<IsGlobal> & {
        type: 'date' | 'datetime'
        after?: DateFieldKey<Owner>
        options?: never
        collection?: never
      })

type CollectionInput<CollectionKeys extends string, Collection> = {
  label?: string
  route: `${string}$slug${string}`
  /** Per-language route patterns. Each must contain `$slug`; keys must be in `languages.all`. */
  routes?: { readonly [locale: string]: `${string}$slug${string}` }
  /** Languages besides main that must be complete before going live. */
  requiredLanguages?: readonly string[]
  fields: readonly FieldInput<CollectionKeys, Collection, false>[]
}

type GlobalInput<CollectionKeys extends string, Global> = {
  label?: string
  seo?: boolean
  previewPath?: `/${string}`
  /** Languages besides main that must be complete before going live. */
  requiredLanguages?: readonly string[]
  fields: readonly FieldInput<CollectionKeys, Global, true>[]
}

/**
 * Declares the site's content model. Collection keys, reference targets and
 * `after` keys are checked against this config; the result is still a
 * `SiteContentConfig`.
 */
export function defineSiteContent<
  const TCollections extends {
    [K in keyof TCollections]: CollectionInput<keyof TCollections & string, TCollections[K]>
  },
  const TGlobals extends {
    [K in keyof TGlobals]: GlobalInput<keyof TCollections & string, TGlobals[K]>
  } = {},
>(config: {
  siteKey: string
  /** Content languages. Omit for a single-language site. */
  languages?: SiteLanguages
  collections: TCollections
  globals?: TGlobals
  assets?: AssetsConfig
  /** SDK-only settings, such as the Paraglide runtime. Never sent to the CMS. */
  i18n?: I18nConfig
}): {
  siteKey: string
  languages?: SiteLanguages
  collections: TCollections
  globals?: TGlobals
  assets?: AssetsConfig
  i18n?: I18nConfig
} {
  return config
}

/**
 * The manifest the CMS receives: collections, site content sections and
 * languages. `i18n` and `assets` stay local. Throws on invalid languages,
 * routes and required languages, like the pull does for names.
 */
export function manifestFromConfig(config: SiteContentConfig): SiteManifest {
  const collections: SiteManifest['collections'] = {}
  // Throws on reserved, colliding and case-only names, like the pull does.
  camelCollectionKeys(Object.keys(config.collections))
  checkLanguages(config)

  for (const [key, collection] of Object.entries(config.collections)) {
    assertSafeIdentifier(key)
    checkFields(collection.fields, `collection "${key}"`, false)
    collections[key] = {
      route: collection.route,
      fields: collection.fields,
      ...(collection.label !== undefined ? { label: collection.label } : {}),
      ...(collection.routes !== undefined ? { routes: { ...collection.routes } } : {}),
      ...(collection.requiredLanguages !== undefined
        ? { requiredLanguages: [...collection.requiredLanguages] }
        : {}),
    }
  }

  const globals = globalsManifest(config.globals ?? {})
  return {
    ...(config.languages !== undefined
      ? { languages: { main: config.languages.main, all: [...config.languages.all] } }
      : {}),
    collections,
    ...(Object.keys(globals).length > 0 ? { globals } : {}),
  }
}

function globalsManifest(globals: Record<string, GlobalConfig>): Record<string, GlobalConfig> {
  // Throws on reserved, colliding and case-only names, like the pull does.
  camelGlobalKeys(Object.keys(globals))
  const result: Record<string, GlobalConfig> = {}
  for (const [key, global] of Object.entries(globals)) {
    assertSafeIdentifier(key)
    checkFields(global.fields, `site content "${key}"`, true)
    result[key] = {
      fields: global.fields,
      ...(global.label !== undefined ? { label: global.label } : {}),
      ...(global.seo !== undefined ? { seo: global.seo } : {}),
      ...(global.previewPath !== undefined ? { previewPath: global.previewPath } : {}),
      ...(global.requiredLanguages !== undefined
        ? { requiredLanguages: [...global.requiredLanguages] }
        : {}),
    }
  }
  return result
}

/**
 * Canonical form of a BCP 47 tag (`nl-be` becomes `nl-BE`). Throws for a
 * tag the platform does not accept.
 */
function canonicalTag(tag: string, owner: string): string {
  try {
    return Intl.getCanonicalLocales(tag)[0]!
  } catch {
    throw new Error(`Invalid language tag "${tag}" in ${owner}`)
  }
}

/**
 * Validates `languages` and every per-language setting that refers to it.
 * Tags are compared in canonical form, so `NL` and `nl` count as one language.
 */
function checkLanguages(config: SiteContentConfig): void {
  const { languages } = config
  const all = languages ? languages.all.map((tag) => canonicalTag(tag, 'languages.all')) : []
  if (languages) {
    const main = canonicalTag(languages.main, 'languages.main')
    if (all.length === 0) throw new Error('languages.all must list at least one language')
    const seen = new Set<string>()
    for (const tag of all) {
      if (seen.has(tag)) throw new Error(`languages.all has a duplicate language: ${tag}`)
      seen.add(tag)
    }
    if (!seen.has(main)) {
      throw new Error(`The main language "${languages.main}" must be listed in languages.all`)
    }
  }

  const check = (tag: string, owner: string) => {
    if (!languages) {
      throw new Error(`${owner} needs languages. Set languages in the config first.`)
    }
    const canonical = canonicalTag(tag, owner)
    if (!all.includes(canonical)) {
      throw new Error(`${owner} language "${tag}" is not in languages.all`)
    }
  }

  for (const [key, collection] of Object.entries(config.collections)) {
    for (const [tag, pattern] of Object.entries(collection.routes ?? {})) {
      check(tag, `routes of collection "${key}"`)
      if (!pattern.includes('$slug')) {
        throw new Error(`The route for "${tag}" in collection "${key}" must contain $slug`)
      }
    }
    for (const tag of collection.requiredLanguages ?? []) {
      check(tag, `requiredLanguages of collection "${key}"`)
    }
  }
  for (const [key, global] of Object.entries(config.globals ?? {})) {
    for (const tag of global.requiredLanguages ?? []) {
      check(tag, `requiredLanguages of site content "${key}"`)
    }
  }
}

function checkFields(
  fields: GlobalConfig['fields'],
  owner: string,
  isGlobal: boolean,
): void {
  const keys = new Set<string>()
  for (const field of fields) {
    assertSafeIdentifier(field.key)
    if (keys.has(field.key)) throw new Error(`Duplicate field identifier: ${field.key}`)
    keys.add(field.key)
    if (isGlobal && field.type === 'slug') {
      throw new Error(`Field "${field.key}" in ${owner} cannot be a slug: site content has no slug`)
    }
    if (!isGlobal && field.group !== undefined) {
      throw new Error(`Field "${field.key}" in ${owner} cannot have a group: only site content fields can`)
    }
    if ('collection' in field && field.collection) assertSafeIdentifier(field.collection)
    if ('after' in field && field.after) assertSafeIdentifier(field.after)
  }
}
