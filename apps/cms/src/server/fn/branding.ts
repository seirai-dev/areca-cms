import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireAgencyAdmin } from '#/lib/session.server'
import { BRAND_COLOR_KEYS, loginTaglinesSchema } from '#/lib/branding'
import {
  clearBrandingImage,
  getBranding,
  resetBranding,
  updateBranding,
} from '#/server/admin/branding'

const brandingFn = { strict: { output: false } as const }
const brandColorSchema = z.partialRecord(
  z.enum(BRAND_COLOR_KEYS),
  z.string().max(7),
)

/** Public: the login, setup, and invite pages render the brand before sign-in. */
export const getBrandingFn = createServerFn({
  method: 'GET',
  ...brandingFn,
}).handler(async () => getBranding())

export const updateBrandingFn = createServerFn({
  method: 'POST',
  ...brandingFn,
})
  .validator(
    z.object({
      appName: z.string().max(60).nullable().optional(),
      accentColor: z.string().max(7).nullable().optional(),
      advancedColorsEnabled: z.boolean().optional(),
      advancedColors: z
        .object({ light: brandColorSchema, dark: brandColorSchema })
        .nullable()
        .optional(),
      font: z.string().max(40).nullable().optional(),
      emailFromName: z.string().max(80).nullable().optional(),
      loginTagline: loginTaglinesSchema,
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    return updateBranding(data, session.user.id)
  })

export const clearBrandingImageFn = createServerFn({
  method: 'POST',
  ...brandingFn,
})
  .validator(z.object({ kind: z.enum(['logo', 'favicon']) }))
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    return clearBrandingImage(data.kind, session.user.id)
  })

export const resetBrandingFn = createServerFn({
  method: 'POST',
  ...brandingFn,
}).handler(async () => {
  const session = await requireAgencyAdmin()
  return resetBranding(session.user.id)
})
