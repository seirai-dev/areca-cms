import * as React from 'react'

import { NotFoundCard } from '#/components/shell/not-found'

import { rememberSite } from './last-site'

/**
 * Wraps every `/sites/$siteId/**` page: remembers the site for the `/`
 * resolver (cookie) and the switcher's Recent list (localStorage).
 */
export function SiteWorkspace({
  siteId,
  children,
}: {
  siteId: string
  children: React.ReactNode
}) {
  React.useEffect(() => {
    rememberSite(siteId)
  }, [siteId])
  return <>{children}</>
}

/** A site id that does not exist or that you cannot open. */
export function SiteNotFound() {
  return <NotFoundCard />
}
