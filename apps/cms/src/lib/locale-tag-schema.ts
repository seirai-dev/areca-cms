// Kept apart from content-locale.ts, which every page loads, so Zod stays out
// of the startup bundle. Route search params use the zod/mini version in
// lib/search-params.ts.
import { z } from '#/lib/zod'

import { LOCALE_TAG_MAX_LENGTH } from './content-limits.ts'
import { isValidLocaleTag } from './content-locale.ts'

/** A language code as accepted in manifests and settings. */
export const localeTagSchema = z
  .string()
  .min(1)
  .max(LOCALE_TAG_MAX_LENGTH)
  .refine(isValidLocaleTag, 'Invalid language code')
