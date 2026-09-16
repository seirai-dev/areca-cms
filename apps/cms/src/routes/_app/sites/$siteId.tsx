import {
  Link,
  Outlet,
  createFileRoute,
  notFound,
  useRouterState,
} from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'

import { EmptyState } from '#/components/empty-state'
import { PageHeader } from '#/components/page-header'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import {
  isEntryEditorPath,
  isSectionActive,
  siteSections,
  type SiteSection,
} from '#/lib/site-nav'
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

function siteSectionLabel(key: SiteSection['key']) {
  switch (key) {
    case 'content':
      return m.sites_nav_content()
    case 'media':
      return m.sites_nav_media()
    case 'releases':
      return m.sites_nav_releases()
    case 'team':
      return m.sites_nav_team()
    case 'activity':
      return m.sites_nav_activity()
    case 'settings':
      return m.sites_nav_settings()
  }
}

function SiteLayout() {
  const { site, me } = Route.useRouteContext()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const sections = siteSections(me, site)

  // The entry editor gets the full page: breadcrumbs carry the context and the
  // editor has its own back link, so the site header and tabs are hidden.
  if (isEntryEditorPath(pathname)) {
    return <Outlet />
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4">
        <PageHeader
          title={site.name}
          description={site.organizationName}
          actions={
            <Button asChild variant="outline" size="sm">
              <a href={site.productionUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
                {m.sites_open_live_site()}
              </a>
            </Button>
          }
        />
        <nav
          aria-label={m.sites_sections_label()}
          data-testid="site-tabs"
          className="-mx-4 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <ul className="-mb-px flex gap-1 text-sm">
            {sections.map((section) => {
              const active = isSectionActive(section, pathname)
              return (
                <li key={section.key} className="shrink-0">
                  <Link
                    to={section.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'inline-flex h-10 items-center gap-2 border-b-2 px-3 font-medium whitespace-nowrap no-underline transition-colors hover:no-underline',
                      active
                        ? 'border-fern-400 text-foreground'
                        : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                    )}
                  >
                    <section.icon className="size-4" />
                    {siteSectionLabel(section.key)}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </div>
      <Outlet />
    </div>
  )
}
