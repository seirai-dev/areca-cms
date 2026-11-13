// Kept apart from branding.ts, which every page loads, so Zod stays out of the
// startup bundle.
import { z } from '#/lib/zod'

import { LOGIN_TAGLINE_MAX_LENGTH } from './branding'

/** One tagline: trimmed, at most 80 characters, a single line. Empty → null. */
const loginTaglineValue = z
  .string()
  .trim()
  .max(LOGIN_TAGLINE_MAX_LENGTH)
  .refine((value) => !/[\r\n]/.test(value), 'Use a single line')
  .transform((value) => value || null)
  .nullable()
  .optional()

/** Request body for the sign-in taglines, per language. */
export const loginTaglinesSchema = z
  .object({
    en: loginTaglineValue,
    nl: loginTaglineValue,
    tr: loginTaglineValue,
  })
  .nullable()
  .optional()
