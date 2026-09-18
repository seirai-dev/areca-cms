import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  notFound,
  useRouterState,
} from '@tanstack/react-router'
import { EmptyState } from '#/components/empty-state'
import { SiteIdentityStrip } from '#/components/identity-strip'
import { rememberRecentSite } from '#/components/site-switcher'
import { Button } from '#/components/ui/button'
import { isEntryEditorPath, siteSections } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/sites/$siteId')({
  beforeLoad: ({ context, params }) => {
    const site = context.me.sites.find((item) => item.id === params.siteId)
    if (!site) {
      throw notFound()
    }
    return { site }
  },
  notFoundComponent: () => (
    <EmptyState
      title={m.sites_not_found_title()}
      description={m.sites_not_found_description()}
      action={
        <Button asChild variant="outline">
          <Link to="/">{m.sites_back_to_dashboard()}</Link>
        </Button>
      }
    />
  ),
  component: SiteLayout,
})

type SiteFrameValue = {
  /** True while the identity strip is hidden (the editor toolbar replaces it). */
  stripHidden: boolean
  setStripHidden: (hidden: boolean) => void
}

const SiteFrameContext = createContext<SiteFrameValue | null>(null)

/**
 * Lets a child route take over the identity strip row. The entry editor calls
 * `useHideSiteStrip()`; every other route leaves the strip in place.
 */
export function useSiteFrame() {
  return useContext(SiteFrameContext)
}

export function useHideSiteStrip() {
  const frame = useSiteFrame()
  useEffect(() => {
    frame?.setStripHidden(true)
    return () => frame?.setStripHidden(false)
  }, [frame])
}

/**
 * Site frame: the identity strip (name, live dot, slug, section tabs) and the
 * section route below it. Entry editor routes render without the strip.
 */
function SiteLayout() {
  const { site, me } = Route.useRouteContext()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const sections = siteSections(me, site)
  const [optedOut, setOptedOut] = useState(false)

  useEffect(() => {
    rememberRecentSite(site.id)
  }, [site.id])

  const frame = useMemo<SiteFrameValue>(
    () => ({
      stripHidden: optedOut || isEntryEditorPath(pathname),
      setStripHidden: setOptedOut,
    }),
    [optedOut, pathname],
  )

  return (
    <SiteFrameContext.Provider value={frame}>
      {frame.stripHidden ? null : (
        <SiteIdentityStrip
          site={site}
          sections={sections}
          pathname={pathname}
        />
      )}
      <Outlet />
    </SiteFrameContext.Provider>
  )
}
