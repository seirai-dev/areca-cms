import { camelCollectionKeys, camelGlobalKeys } from './camel-case.js'
import { assertSafeIdentifier } from './identifiers.js'
import type {
  AssetsConfig,
  CollectionConfig,
  GlobalConfig,
  SiteContentConfig,
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
  fields: readonly FieldInput<CollectionKeys, Collection, false>[]
}

type GlobalInput<CollectionKeys extends string, Global> = {
  label?: string
  seo?: boolean
  previewPath?: `/${string}`
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
  collections: TCollections
  globals?: TGlobals
  assets?: AssetsConfig
}): {
  siteKey: string
  collections: TCollections
  globals?: TGlobals
  assets?: AssetsConfig
} {
  return config
}

export function manifestFromConfig(config: SiteContentConfig): SiteManifest {
  const collections: SiteManifest['collections'] = {}
  // Throws on reserved, colliding and case-only names, like the pull does.
  camelCollectionKeys(Object.keys(config.collections))

  for (const [key, collection] of Object.entries(config.collections)) {
    assertSafeIdentifier(key)
    checkFields(collection.fields, `collection "${key}"`, false)
    collections[key] = {
      route: collection.route,
      fields: collection.fields,
      ...(collection.label !== undefined ? { label: collection.label } : {}),
    }
  }

  const globals = globalsManifest(config.globals ?? {})
  return {
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
    }
  }
  return result
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
