import { createFileRoute } from '@tanstack/react-router'

import { LegacyBranding } from '#/features/agency/legacy-branding'

/** `/agency/branding`: instance name, logo, accent and font. */
export const Route = createFileRoute('/_app/agency/branding')({
  component: LegacyBranding,
})
