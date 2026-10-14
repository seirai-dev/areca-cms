import { toCamelKey } from './camel-case.js'
import {
  assertSafeIdentifier,
  assertUniqueCollectionIdentifiers,
  isReservedCollectionKey,
} from './identifiers.js'
import type { AssetsConfig, SiteContentConfig, SiteManifest } from './types.js'

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
type DateFieldKey<Collection> = Collection extends { fields: readonly (infer F)[] }
  ? F extends { type: 'date' | 'datetime'; key: infer K extends string }
    ? K
    : never
  : never

/**
 * One field as written in `defineSiteContent`, discriminated on `type`. The
 * keys a variant does not allow are `never`, so extra keys are rejected in
 * the constraint check (which has no excess-property check of its own).
 */
type FieldInput<CollectionKeys extends string, Collection> =
  | (FieldAuthorBase & {
      type: SimpleFieldType
      options?: never
      collection?: never
      after?: never
    })
  | (FieldAuthorBase & {
      type: 'select'
      options?: readonly string[]
      collection?: never
      after?: never
    })
  | (FieldAuthorBase & {
      type: 'reference'
      collection: CollectionKeys
      options?: never
      after?: never
    })
  | (FieldAuthorBase & {
      type: 'date' | 'datetime'
      after?: DateFieldKey<Collection>
      options?: never
      collection?: never
    })

type CollectionInput<CollectionKeys extends string, Collection> = {
  label?: string
  route: `${string}$slug${string}`
  fields: readonly FieldInput<CollectionKeys, Collection>[]
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
>(config: {
  siteKey: string
  collections: TCollections
  assets?: AssetsConfig
}): {
  siteKey: string
  collections: TCollections
  assets?: AssetsConfig
} {
  return config
}

export function manifestFromConfig(config: SiteContentConfig): SiteManifest {
  const collections: SiteManifest['collections'] = {}
  assertUniqueCollectionIdentifiers(Object.keys(config.collections))

  for (const [key, collection] of Object.entries(config.collections)) {
    assertSafeIdentifier(key)
    if (isReservedCollectionKey(toCamelKey(key))) {
      throw new Error(
        `Collection key "${key}" is reserved: resolve, href and preview cannot be collection keys`,
      )
    }
    const keys = new Set<string>()
    for (const field of collection.fields) {
      assertSafeIdentifier(field.key)
      if (keys.has(field.key))
        throw new Error(`Duplicate field identifier: ${field.key}`)
      keys.add(field.key)
      if ('collection' in field && field.collection) assertSafeIdentifier(field.collection)
      if ('after' in field && field.after) assertSafeIdentifier(field.after)
    }
    collections[key] = {
      route: collection.route,
      fields: collection.fields,
      ...(collection.label !== undefined ? { label: collection.label } : {}),
    }
  }

  return { collections }
}
