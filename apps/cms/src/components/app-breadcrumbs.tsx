import { Link, useRouterState } from '@tanstack/react-router'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '#/components/ui/breadcrumb'
import type { Me } from '#/server/fn/me'

export function AppBreadcrumbs({ me }: { me: Me }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const siteMatch = pathname.match(/^\/sites\/([^/]+)/)
  const site = siteMatch
    ? me.sites.find((item) => item.id === siteMatch[1])
    : undefined
  const isAdmin = pathname.startsWith('/admin')

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {pathname === '/' ? (
            <BreadcrumbPage>Dashboard</BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <Link to="/">Dashboard</Link>
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {site ? (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{site.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : null}
        {isAdmin ? (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Agency</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : null}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
