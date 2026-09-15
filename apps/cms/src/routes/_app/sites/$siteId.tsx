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
} from '#/lib/site-nav'

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
      title="Site not found"
      description="This site does not exist or you no longer have access to it."
      action={
        <Button asChild variant="outline">
          <Link to="/">Back to dashboard</Link>
        </Button>
      }
    />
  ),
  component: SiteLayout,
})

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
                Open live site
              </a>
            </Button>
          }
        />
        <nav
          aria-label="Site sections"
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
                    {section.label}
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
