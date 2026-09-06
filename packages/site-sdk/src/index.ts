import type { SiteContentConfig } from './types.js'

export type { Field, FieldType, SiteContentConfig } from './types.js'

export function defineSiteContent<T extends SiteContentConfig>(config: T): T {
  return config
}
