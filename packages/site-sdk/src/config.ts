import { assertSafeIdentifier } from './identifiers.js'
import type { SiteContentConfig, SiteManifest } from './types.js'

export function defineSiteContent<T extends SiteContentConfig>(config: T): T {
  return config
}

export function manifestFromConfig(config: SiteContentConfig): SiteManifest {
  const collections: SiteManifest['collections'] = {}

  for (const [key, collection] of Object.entries(config.collections)) {
    assertSafeIdentifier(key)
    const keys = new Set<string>()
    for (const field of collection.fields) {
      assertSafeIdentifier(field.key)
      if (keys.has(field.key)) throw new Error(`Duplicate field identifier: ${field.key}`)
      keys.add(field.key)
      if (field.collection) assertSafeIdentifier(field.collection)
      if (field.after) assertSafeIdentifier(field.after)
    }
    collections[key] = {
      route: collection.route,
      fields: collection.fields,
      ...(collection.label !== undefined ? { label: collection.label } : {}),
    }
  }

  return { collections }
}
