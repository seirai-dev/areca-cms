import { createFileRoute } from '@tanstack/react-router'

import { BrandingScreen } from '#/features/agency/branding-screen'

/** `/agency/branding`: instance name, logo, favicon, accent, font, sender. */
export const Route = createFileRoute('/_app/agency/branding')({
  component: BrandingScreen,
})
