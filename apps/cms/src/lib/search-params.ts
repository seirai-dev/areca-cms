import { config, z } from 'zod/mini'

import { LOCALE_TAG_MAX_LENGTH } from './content-limits.ts'
import { isValidLocaleTag } from './content-locale.ts'

// Route search params are validated in the route tree, which every page
// loads, so they use the tree-shakable zod/mini instead of lib/zod. Same CSP
// reason as lib/zod for `jitless`.
config({ jitless: true })

export { z }

/** A search param that reads as absent when it is missing or invalid. */
export function optionalParam<T extends z.core.SomeType>(schema: T) {
  return z.catch(z.optional(schema), undefined)
}

/** `?lang=`: a language code, as `localeTagSchema` accepts it. */
export const localeTagParam = z
  .string()
  .check(
    z.minLength(1),
    z.maxLength(LOCALE_TAG_MAX_LENGTH),
    z.refine(isValidLocaleTag, 'Invalid language code'),
  )
