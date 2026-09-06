import type { SiteContentConfig, SiteManifest } from './types.js'

export function defineSiteContent<T extends SiteContentConfig>(config: T): T {
  return config
}

export function manifestFromConfig(config: SiteContentConfig): SiteManifest {
  const collections: SiteManifest['collections'] = {}

  for (const [key, collection] of Object.entries(config.collections)) {
    collections[key] = {
      route: collection.route,
      fields: collection.fields,
      ...(collection.label !== undefined ? { label: collection.label } : {}),
    }
  }

  return { collections }
}
