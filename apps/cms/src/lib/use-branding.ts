import { useLoaderData } from '@tanstack/react-router'

import type { BrandingView } from './branding.ts'

/** Instance branding loaded once by the root route. */
export function useBranding(): BrandingView {
  return useLoaderData({ from: '__root__' })
}
